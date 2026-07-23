import { config } from "../config.js";
import { getStore } from "../db/index.js";
import { getOverview } from "../services/overview.js";
import { getRecentHits } from "../data/parasite.js";
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

/** Current pot age in hours, for the bot presence line. */
export async function currentPotHours(): Promise<number> {
  const o = await getOverview();
  return o.potAge.hours;
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
}
