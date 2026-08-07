import { config } from "../config.js";
import { getStore } from "../db/index.js";
import { getOverview } from "../services/overview.js";
import { potMathFromOverview } from "../services/potmath.js";
import { getRecentHits, getUserStats, getRouterOrders, getRounds } from "../data/parasite.js";
import { getBlockTimestamp } from "../data/mempool.js";
import { PHD_TO_DIFF } from "../math/constants.js";
import { getCadoWinnerAddresses } from "../services/winners.js";
import { estimateCurrentPotPhd } from "../services/pot.js";
import { bus } from "../events.js";
import { checkWatches } from "./watchdog.js";
import type { PollSample } from "../db/types.js";

let lastSeenFoundHeight: number | null = null;
let cycleStartHeight: number | null = null;
let lastHitCheck: number | null = null;

/** Wrap an async task so a throw never escapes (pollers must never crash). */
function safe(label: string, fn: () => Promise<void>): () => void {
  return () => {
    fn().catch((err) => console.error(`[poller:${label}]`, (err as Error).message));
  };
}

/** Persist a sample of pool + chain state. */
async function collect(): Promise<void> {
  const store = getStore();
  const o = await getOverview();
  // Reuse the Pot Math snapshot so the stored W/D are byte-for-byte the numbers
  // the Calculator card shows — the 24h-trend baseline must match today's view.
  const pm = potMathFromOverview(o);
  const sample: PollSample = {
    ts: o.generatedAt,
    poolHashrate: o.pool.poolHashratePhs,
    hashprice: o.pool.hashpriceSatsPerPhd,
    users: o.pool.users,
    workers: o.pool.workers,
    chainHeight: o.chain.height,
    lastFoundHeight: o.pool.lastFoundHeight,
    bestDiffSinceBlock: o.pool.highestDiffSinceBlock,
    btcPrice: o.pool.btcPriceUsd,
    workSinceBlockT: pm.W,
    minNeededDiffT: pm.D,
  };
  await store.insertSample(sample);
}

/** Detect a new found block and emit an alert + record the completed cycle. */
async function checkBlock(): Promise<void> {
  const store = getStore();
  const o = await getOverview();
  const height = o.pool.lastFoundHeight;

  if (lastSeenFoundHeight === null) {
    // initialise from persistent store so we don't re-alert across restarts
    lastSeenFoundHeight = (await store.getLastSeenFoundHeight()) ?? height;
    cycleStartHeight = lastSeenFoundHeight;
    return;
  }

  if (height > lastSeenFoundHeight) {
    const prev = cycleStartHeight ?? lastSeenFoundHeight;
    const cycleDurationBlocks = Math.max(1, height - prev);
    const estCyclePhd = await estimateCurrentPotPhd(store, o);

    await store.recordBlockFound({
      height,
      foundAt: Date.now(),
      cycleDurationBlocks,
      estCyclePhd,
    });

    bus.emitBlockFound({
      height,
      prevHeight: prev,
      cycleDurationBlocks,
      estCyclePhd,
      poolHashratePhs: o.pool.poolHashratePhs,
      hashpriceSatsPerPhd: o.pool.hashpriceSatsPerPhd,
    });

    lastSeenFoundHeight = height;
    cycleStartHeight = height;
  }
}

/** Collect newly-seen 10T+ hits into the store, deduped by id. */
async function collectHits(): Promise<void> {
  const store = getStore();
  const since = lastHitCheck ?? Date.now() - 6 * 60 * 60 * 1000;
  const hits = await getRecentHits(since);
  if (hits.length > 0) {
    await store.insertHits(
      hits.map((h) => ({
        id: h.id,
        ts: h.ts,
        address: h.address,
        difficulty: h.difficulty,
        tier: h.tier,
        orderId: h.orderId,
        worker: h.worker,
      })),
    );
  }
  lastHitCheck = Date.now();
}

/** How many tracked addresses to refresh per index cycle (each = ~4 upstream
 *  calls, so keep it modest to stay gentle on Parasite). */
const INDEX_BATCH = 40;

/**
 * Register the pool's identifiable contributors so Parahawk indexes them itself
 * (rather than waiting for someone to search each one): every FULL address in
 * the Refinery order book, plus every matched cado winner. Masked-only miners
 * who never rented can't be resolved to a full address, so they can't be
 * enumerated — the honest limit.
 */
async function seedContributorUniverse(): Promise<void> {
  const store = getStore();
  const [orders, winners, rounds] = await Promise.all([
    getRouterOrders().catch(() => []),
    getCadoWinnerAddresses().catch(() => [] as string[]),
    getRounds().catch(() => []),
  ]);
  const universe = new Set<string>();
  for (const o of orders) if (o.address && o.address.startsWith("bc1")) universe.add(o.address);
  for (const a of winners) universe.add(a);
  // Block finders (winner_username on completed rounds) are the one other place
  // Parasite exposes a full address — index them too.
  for (const r of rounds) if (r.winner && r.winner.startsWith("bc1")) universe.add(r.winner);
  for (const address of universe) await store.trackAddress(address);
}

/**
 * Index a batch of tracked wallets (least-recently-snapshotted first): refresh
 * their badges and record a hashrate snapshot so per-wallet 14-day timelines
 * build up. Parasite has no historical per-address hashrate endpoint, so this
 * round-robin is the only way to accumulate one. Runs sequentially, bounded to
 * INDEX_BATCH, so a large registry never hammers upstream in one tick.
 */
async function indexTrackedAddresses(): Promise<void> {
  const store = getStore();
  await seedContributorUniverse();
  const batch = await store.getStaleTrackedAddresses(INDEX_BATCH).catch(() => []);
  for (const { address } of batch) {
    try {
      const u = await getUserStats(address);
      await store.insertAddressSnapshot({
        address,
        ts: Date.now(),
        hashrate: u.hashratePhs,
        bestDifficulty: u.bestDifficulty,
        totalWork: u.totalWorkDiff,
      });
      if (u.badges && Object.keys(u.badges).length > 0) {
        await store.upsertAccountBadges({ address, badges: u.badges, updatedAt: Date.now() });
      }
      await store.markAddressSnapshotted(address);
    } catch {
      // Don't let one bad address stop the batch; it stays stale and retries.
    }
  }
}

/**
 * Backfill completed pot cycles from Parasite's `/api/rounds` (found blocks with
 * their total work) so the Pool page's luck index / pot-length / hall of fame
 * have real history immediately, instead of waiting for Parahawk to observe
 * blocks itself. Dedupes by height (recordBlockFound upserts). Only ~6 rounds
 * are available, but Parahawk extends the record as it sees new blocks.
 */
async function backfillRounds(): Promise<void> {
  const store = getStore();
  const rounds = await getRounds().catch(() => []);
  if (rounds.length === 0) return;
  const sorted = rounds.slice().sort((a, b) => a.height - b.height);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!;
    const prevHeight = i > 0 ? sorted[i - 1]!.height : r.height - 1;
    const cycleDurationBlocks = Math.max(1, r.height - prevHeight);
    const estCyclePhd = r.totalWorkDiff / PHD_TO_DIFF;
    const foundAt = (await getBlockTimestamp(r.height).catch(() => null)) ?? Date.now();
    await store.recordBlockFound({ height: r.height, foundAt, cycleDurationBlocks, estCyclePhd });
  }
}

/** Current pot age in hours, for the bot presence line. */
export async function currentPotHours(): Promise<number> {
  const o = await getOverview();
  return o.potAge.hours;
}

/**
 * Run ONE poll cycle (collect + block-check + hits). Used by the Vercel Cron
 * endpoint on serverless, where there's no long-lived process for setInterval.
 * Module state resets between invocations, but checkBlock re-inits from the
 * store and insertHits dedupes by id, so a stateless per-tick run is correct.
 */
export async function runPollOnce(): Promise<void> {
  await Promise.allSettled([collect(), checkBlock(), collectHits(), indexTrackedAddresses(), backfillRounds()]);
}

export function startPollers(): void {
  const store = getStore();
  console.log(`🗄  store=${store.kind}  poll=${config.pollIntervalSeconds}s  block=${config.blockPollIntervalSeconds}s`);

  // prime immediately, then on interval
  safe("collect", collect)();
  safe("block", checkBlock)();
  safe("hits", collectHits)();
  safe("rounds", backfillRounds)();
  setInterval(safe("rounds", backfillRounds), 10 * 60 * 1000);

  setInterval(safe("collect", collect), config.pollIntervalSeconds * 1000);
  setInterval(safe("block", checkBlock), config.blockPollIntervalSeconds * 1000);
  setInterval(safe("hits", collectHits), config.pollIntervalSeconds * 1000);
  setInterval(safe("watchdog", () => checkWatches(store)), 5 * 60 * 1000);
  setInterval(safe("maintenance", () => store.runMaintenance()), 60 * 60 * 1000);
  // Index tracked wallets (contributors + searched) on a rolling basis to build
  // their 14-day hashrate timelines and refresh badges.
  safe("index", indexTrackedAddresses)();
  setInterval(safe("index", indexTrackedAddresses), 10 * 60 * 1000);
}
