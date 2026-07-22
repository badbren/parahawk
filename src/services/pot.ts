import type { Store } from "../db/types.js";
import { integratePhd, type HashrateSample } from "../math/pot.js";
import type { OverviewSnapshot } from "./overview.js";

/**
 * Estimate PHd banked in the CURRENT pot by integrating the pool hashrate
 * samples collected during this cycle (all samples whose last_found_height
 * matches the current one). Falls back to a rough rectangle estimate if we have
 * too few samples (e.g. right after startup).
 */
export async function estimateCurrentPotPhd(
  store: Store,
  o: OverviewSnapshot,
): Promise<number> {
  // look back generously (up to ~5 days) then filter to the current cycle
  const since = Date.now() - 5 * 86_400_000;
  const samples = await store.getSamplesSince(since);
  const cycle = samples.filter((s) => s.lastFoundHeight === o.pool.lastFoundHeight);

  if (cycle.length >= 2) {
    const hs: HashrateSample[] = cycle.map((s) => ({ ts: s.ts, hashratePhs: s.poolHashrate }));
    // extend to "now" with the latest hashrate so the estimate is current
    hs.push({ ts: o.generatedAt, hashratePhs: o.pool.poolHashratePhs });
    return integratePhd(hs);
  }

  // fallback: current hashrate × pot age in days
  return o.pool.poolHashratePhs * o.potAge.days;
}
