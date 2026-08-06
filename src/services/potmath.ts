import { getOverview, type OverviewSnapshot } from "./overview.js";
import { computePotMath, expectedWaitDays, type PotMathResult } from "../math/potmath.js";

/**
 * Everything the Pot Math views need, assembled once from the live overview so
 * the website, /calc defaults, and the Discord bot all read the SAME numbers.
 *
 * The headline expected-wait uses the live hashrate gauge, which reproduces the
 * dashboard's "63d 10h". `expectedDays1d` recomputes it on the 1-day-average
 * hashrate — the smoother, rental-adjusted view (rentals spike the gauge). Both
 * are surfaced so the reader can see the spread.
 */
export interface PotMathSnapshot extends PotMathResult {
  /** projected network difficulty at the next retarget, in T. */
  nextD: number;
  /** hashrates in PH/s: live gauge + trailing averages. */
  hGauge: number;
  h1d: number;
  h6d: number;
  h9d: number;
  /** expected wait on the 1-day-average hashrate (smoother than the gauge). */
  expectedDays1d: number;
  /** highest share difficulty since the last block, in T. */
  highestDiffSinceBlockT: number;
  /** bitcoin height Parasite last found a block at. */
  lastBlockFoundHeight: number;
  btcPriceUsd: number;
  /** pot age verdict + hours, reused for the bot's 🟢/🟡/🔴. */
  potVerdict: OverviewSnapshot["potAge"]["verdict"];
  potHours: number;
  /** freshness for the "stale since <ts>" banner. */
  stale: boolean;
  lastSuccess: number | null;
  generatedAt: number;
}

function toT(diffUnits: number | undefined, fallbackT: number): number {
  return diffUnits && diffUnits > 0 ? diffUnits / 1e12 : fallbackT;
}

export function potMathFromOverview(o: OverviewSnapshot): PotMathSnapshot {
  const p = o.pool;
  const W = p.totalWorkSinceBlockT ?? toT(p.workSinceLastBlockDiff, 0);
  const D = p.minNeededDiffT ?? toT(p.networkDifficulty, 127);
  const nextD = p.nextDiffT ?? D;
  const hGauge = p.poolHashratePhs;
  const h1d = p.avg1dPhs;

  const core = computePotMath(W, D, hGauge);

  return {
    ...core,
    nextD,
    hGauge,
    h1d,
    h6d: p.avg6dPhs,
    h9d: p.avg9dPhs,
    expectedDays1d: expectedWaitDays(D, h1d),
    highestDiffSinceBlockT: p.highestDiffSinceBlockT ?? toT(p.highestDiffSinceBlock, 0),
    lastBlockFoundHeight: p.lastBlockFoundHeight ?? p.lastFoundHeight,
    btcPriceUsd: p.btcPriceUsd,
    potVerdict: o.potAge.verdict,
    potHours: o.potAge.hours,
    stale: o.freshness.stale,
    lastSuccess: o.freshness.pool.lastSuccess,
    generatedAt: o.generatedAt,
  };
}

/** Convenience: fetch the overview and derive the Pot Math snapshot. */
export async function getPotMath(): Promise<PotMathSnapshot> {
  return potMathFromOverview(await getOverview());
}
