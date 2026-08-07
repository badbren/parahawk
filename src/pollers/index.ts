import { config } from "../config.js";
import { getStore } from "../db/index.js";
import { getOverview } from "../services/overview.js";
import { potMathFromOverview } from "../services/potmath.js";
import { getRecentHits, getUserStats } from "../data/parasite.js";
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

/**
 * Snapshot each matched cado-winner's live hashrate into address_snapshots, so
 * their wallet page can plot a 14-day hashrate timeline. Parasite has no
 * historical per-address hashrate endpoint, so this is the only way to build one
 * — it accumulates going forward. Runs sequentially to stay gentle upstream.
 */
async function snapshotWinners(): Promise<void> {
  const store = getStore();
  const addrs = await getCadoWinnerAddresses().catch(() => [] as string[]);
  for (const address of addrs) {
    try {
      const u = await getUserStats(address);
      await store.insertAddressSnapshot({
        address,
        ts: Date.now(),
        hashrate: u.hashratePhs,
        bestDifficulty: u.bestDifficulty,
        totalWork: u.totalWorkDiff,
      });
    } catch {
      /* one bad address shouldn't stop the rest */
    }
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
  await Promise.allSettled([collect(), checkBlock(), collectHits(), snapshotWinners()]);
}

export function startPollers(): void {
  const store = getStore();
  console.log(`🗄  store=${store.kind}  poll=${config.pollIntervalSeconds}s  block=${config.blockPollIntervalSeconds}s`);

  // prime immediately, then on interval
  safe("collect", collect)();
  safe("block", checkBlock)();
  safe("hits", collectHits)();

  setInterval(safe("collect", collect), config.pollIntervalSeconds * 1000);
  setInterval(safe("block", checkBlock), config.blockPollIntervalSeconds * 1000);
  setInterval(safe("hits", collectHits), config.pollIntervalSeconds * 1000);
  setInterval(safe("watchdog", () => checkWatches(store)), 5 * 60 * 1000);
  setInterval(safe("maintenance", () => store.runMaintenance()), 60 * 60 * 1000);
  // Snapshot cado-winner hashrates every 20 min to build their 14-day timelines.
  safe("winners", snapshotWinners)();
  setInterval(safe("winners", snapshotWinners), 20 * 60 * 1000);
}
