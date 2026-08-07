/**
 * Pool-health analytics — pure aggregations over completed pot cycles.
 *
 * Scorekeeping only, and deliberately memoryless: mining is a Poisson process,
 * so a "lucky" streak says nothing about the next block. These figures describe
 * the cycles we can see, not a trend you can lean on.
 *
 * Inputs are the `potLengths` rows from services/history (one per completed
 * cycle) plus the *current* network difficulty D (in T). We derive one expected
 * block size — phdNeededForBlock(D) — and compare each cycle's actual banked
 * work against it. Using current D for every historical cycle is an
 * approximation (D drifts between retargets), but it keeps the yardstick a
 * single, honest number.
 */

import { phdNeededForBlock } from "../math/potmath.js";

/** One completed pot cycle — mirrors services/history PotLength. */
export interface PotCycle {
  height: number;
  foundAt: number;
  durationBlocks: number;
  durationHours: number;
  estPhd: number;
}

/** Per-cycle luck: expected/actual work. >1 = found quicker than average. */
export interface CycleLuck {
  height: number;
  foundAt: number;
  expectedPhd: number;
  actualPhd: number;
  luck: number;
}

export interface HistoBin {
  start: number; // hours (inclusive)
  end: number; // hours (exclusive, except the last bin)
  count: number;
}

export interface PoolHealth {
  count: number;
  /** phdNeededForBlock(D) — the shared yardstick for an "average" block. */
  expectedPhd: number;
  cycles: CycleLuck[];
  /** Aggregate luck over the last N cycles (expected / mean actual). */
  rollingLuck: number | null;
  /** How many cycles the rolling figure actually covers. */
  rollingCount: number;
  /** Aggregate luck over every visible cycle. */
  allLuck: number | null;
  verdict: "lucky" | "unlucky" | "even" | "none";
  emoji: string;
  // pot-length distribution (hours)
  medianHours: number | null;
  shortestHours: number | null;
  longestHours: number | null;
  histogram: HistoBin[];
  // hall of fame
  longestDrought: PotCycle | null; // longest durationHours
  shortestPot: PotCycle | null; // shortest durationHours
  biggestPot: PotCycle | null; // largest estPhd (payout proxy)
}

function median(sortedAsc: number[]): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  const mid = n >> 1;
  return n % 2 ? sortedAsc[mid]! : (sortedAsc[mid - 1]! + sortedAsc[mid]!) / 2;
}

/**
 * Aggregate luck = expected / mean(actual) over the given cycles. Aggregating
 * on the sum rather than averaging per-cycle ratios keeps a single tiny cycle
 * from blowing the figure up (a ratio's tail is heavy).
 */
function aggregateLuck(actuals: number[], expectedPhd: number): number | null {
  const valid = actuals.filter((a) => a > 0);
  if (valid.length === 0) return null;
  const meanActual = valid.reduce((s, a) => s + a, 0) / valid.length;
  if (meanActual <= 0) return null;
  return expectedPhd / meanActual;
}

/**
 * Bin pot durations (hours) into a small histogram. Bin count scales with the
 * sample size (√n, clamped 4–10). Equal-width bins across [min, max]; a single
 * degenerate value lands in one bin.
 */
export function durationHistogram(hours: number[]): HistoBin[] {
  const vals = hours.filter((h) => Number.isFinite(h) && h >= 0);
  if (vals.length === 0) return [];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (max <= min) {
    return [{ start: min, end: min, count: vals.length }];
  }
  const bins = Math.max(4, Math.min(10, Math.ceil(Math.sqrt(vals.length))));
  const width = (max - min) / bins;
  const out: HistoBin[] = Array.from({ length: bins }, (_, i) => ({
    start: min + i * width,
    end: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of vals) {
    let idx = Math.floor((v - min) / width);
    if (idx >= bins) idx = bins - 1; // the max value falls in the last bin
    if (idx < 0) idx = 0;
    out[idx]!.count++;
  }
  return out;
}

/**
 * Compute the full pool-health snapshot for a set of completed cycles.
 *
 * @param cycles  completed pot cycles (any order; chronology by foundAt is used)
 * @param dT      current network difficulty, in T
 * @param rollingN size of the rolling window (default 10)
 */
export function computePoolHealth(
  cycles: PotCycle[],
  dT: number,
  rollingN = 10,
): PoolHealth {
  const expectedPhd = phdNeededForBlock(dT);

  const chrono = cycles.slice().sort((a, b) => a.foundAt - b.foundAt);

  const cycleLuck: CycleLuck[] = chrono.map((c) => ({
    height: c.height,
    foundAt: c.foundAt,
    expectedPhd,
    actualPhd: c.estPhd,
    luck: c.estPhd > 0 ? expectedPhd / c.estPhd : 0,
  }));

  const allActuals = chrono.map((c) => c.estPhd);
  const allLuck = aggregateLuck(allActuals, expectedPhd);

  const rollingSlice = chrono.slice(-rollingN);
  const rollingLuck = aggregateLuck(
    rollingSlice.map((c) => c.estPhd),
    expectedPhd,
  );

  let verdict: PoolHealth["verdict"] = "none";
  let emoji = "🍀";
  if (allLuck != null) {
    // Small deadband so a coin-flip pool doesn't get branded either way.
    if (allLuck >= 1.03) {
      verdict = "lucky";
      emoji = "🍀";
    } else if (allLuck <= 0.97) {
      verdict = "unlucky";
      emoji = "🥲";
    } else {
      verdict = "even";
      emoji = "🍀";
    }
  }

  const hoursSorted = chrono
    .map((c) => c.durationHours)
    .filter((h) => Number.isFinite(h))
    .sort((a, b) => a - b);

  const histogram = durationHistogram(chrono.map((c) => c.durationHours));

  let longestDrought: PotCycle | null = null;
  let shortestPot: PotCycle | null = null;
  let biggestPot: PotCycle | null = null;
  for (const c of chrono) {
    if (!longestDrought || c.durationHours > longestDrought.durationHours) longestDrought = c;
    if (!shortestPot || c.durationHours < shortestPot.durationHours) shortestPot = c;
    if (!biggestPot || c.estPhd > biggestPot.estPhd) biggestPot = c;
  }

  return {
    count: chrono.length,
    expectedPhd,
    cycles: cycleLuck,
    rollingLuck,
    rollingCount: rollingSlice.length,
    allLuck,
    verdict,
    emoji,
    medianHours: median(hoursSorted),
    shortestHours: hoursSorted[0] ?? null,
    longestHours: hoursSorted[hoursSorted.length - 1] ?? null,
    histogram,
    longestDrought,
    shortestPot,
    biggestPot,
  };
}
