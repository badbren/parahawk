import { config, hasSupabase } from "../config.js";
import { MemoryStore } from "./memory.js";
import { SupabaseStore } from "./supabase.js";
import { mockPoolStats, mockChainHeight, mockLastFoundHeight, mockHitsInRange } from "../data/mock.js";
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
  if (!config.mockData) return;
  // Only seed when the store is empty, so we don't duplicate samples in a
  // persistent (Supabase) DB across restarts. Memory is always empty on boot.
  const existing = await s.getRecentSamples(1).catch(() => []);
  if (existing.length > 0) {
    console.log("🌱 seed skipped (store already has samples)");
    return;
  }

  const now = Date.now();
  const HOUR = 3_600_000;
  const days = 7;
  const start = now - days * 24 * HOUR;

  let prevFound = mockLastFoundHeight(start);
  let cycleStart = start;
  const samples = [];
  // Mock pool stats are pinned to a fixed "today", so W and D would be flat and
  // the 24h Pot Math trend would show nothing. Add a small deterministic drift
  // (a few T of W, a fraction of a T of D) so the trend arrows have something to
  // point at in mock/dev mode. Live (Supabase) mode stores the real values.
  const baseW = mockPoolStats(now).totalWorkSinceBlockT ?? 0;
  const baseD = mockPoolStats(now).minNeededDiffT ?? mockPoolStats(now).networkDifficulty / 1e12;
  for (let t = start; t <= now; t += HOUR) {
    const p = mockPoolStats(t);
    const driftW = 6 * Math.sin((t / (34 * HOUR)) * 2 * Math.PI);
    const driftD = 0.7 * Math.sin((t / (52 * HOUR)) * 2 * Math.PI);
    samples.push({
      ts: t,
      poolHashrate: p.poolHashratePhs,
      hashprice: p.hashpriceSatsPerPhd,
      users: p.users,
      workers: p.workers,
      chainHeight: mockChainHeight(t),
      lastFoundHeight: p.lastFoundHeight,
      bestDiffSinceBlock: p.highestDiffSinceBlock,
      btcPrice: p.btcPriceUsd,
      workSinceBlockT: Math.max(1, baseW + driftW),
      minNeededDiffT: Math.max(1, baseD + driftD),
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

  await s.insertSamples(samples);

  // Seed the 10T+ hit board so the chart + table are populated immediately.
  const hits = mockHitsInRange(start, now);
  await s.insertHits(
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
