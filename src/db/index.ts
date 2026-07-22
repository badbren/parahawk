import { config, hasSupabase } from "../config.js";
import { MemoryStore } from "./memory.js";
import { SupabaseStore } from "./supabase.js";
import { mockPoolStats, mockChainHeight, mockLastFoundHeight } from "../data/mock.js";
import { integratePhd } from "../math/pot.js";
import type { Store } from "./types.js";

let store: Store | null = null;

/** Singleton store: Supabase when credentials exist, else in-memory. */
export function getStore(): Store {
  if (store) return store;
  store = hasSupabase() ? new SupabaseStore() : new MemoryStore();
  return store;
}

/**
 * In mock mode with the in-memory store, backfill ~7 days of synthetic samples
 * (one per hour) so /history and /luck render immediately without waiting for
 * the pollers to accumulate data. Also derives block-found events at the mock
 * pot-cycle boundaries so the /history block markers and pot-length chart work.
 */
export async function seedMockHistory(): Promise<void> {
  const s = getStore();
  if (!config.mockData || s.kind !== "memory") return;

  const now = Date.now();
  const HOUR = 3_600_000;
  const days = 7;
  const start = now - days * 24 * HOUR;

  let prevFound = mockLastFoundHeight(start);
  let cycleStart = start;
  for (let t = start; t <= now; t += HOUR) {
    const p = mockPoolStats(t);
    await s.insertSample({
      ts: t,
      poolHashrate: p.poolHashratePhs,
      hashprice: p.hashpriceSatsPerPhd,
      users: p.users,
      workers: p.workers,
      chainHeight: mockChainHeight(t),
      lastFoundHeight: p.lastFoundHeight,
      bestDiffSinceBlock: p.highestDiffSinceBlock,
      btcPrice: p.btcPriceUsd,
    });

    // Detect a mock "block found": last-found height jumped up vs previous hour.
    const lf = p.lastFoundHeight;
    if (lf > prevFound) {
      const durationBlocks = mockChainHeight(t) - prevFound;
      // integrate PHd over the cycle using hourly samples
      const cycleSamples = [];
      for (let u = cycleStart; u <= t; u += HOUR) {
        cycleSamples.push({ ts: u, hashratePhs: mockPoolStats(u).poolHashratePhs });
      }
      await s.recordBlockFound({
        height: lf,
        foundAt: t,
        cycleDurationBlocks: Math.max(1, durationBlocks),
        estCyclePhd: integratePhd(cycleSamples),
      });
      prevFound = lf;
      cycleStart = t;
    }
  }
}
