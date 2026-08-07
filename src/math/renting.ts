/**
 * Renting & block-timing math — the "is it worth it, and how likely is it?"
 * layer that sits on top of the four Pot Math headline numbers.
 *
 * Two independent ideas live here:
 *   1. Break-even hashprice — the raw hashvalue of pool work, so you can hold
 *      the live Refinery price up against what the work is actually worth.
 *   2. Block-timing probability — turning an expected-wait into an honest
 *      P(≥1 block within t), memoryless and framed as odds, never a forecast.
 *
 * Nothing here is a promise. It is scorekeeping and long-run probability.
 */

import { phdNeededForBlock } from "./potmath.js";

/**
 * Block subsidy in sats at the current halving epoch (post-2024, 3.125 BTC).
 * Subsidy only — transaction fees are on top and vary block to block.
 */
export const BLOCK_SUBSIDY_SATS = 3.125e8;

/**
 * Raw expected mining value of one PHd of pool work, in sats:
 *   hashValue = blockRewardSats / phdNeededForBlock(D).
 * This is the honest "what is a PHd of work worth right now" number — the
 * amount a block's reward, spread across the work it takes to find one, assigns
 * to each PHd. It ignores variance and pot-sharing; it is the hashvalue floor.
 *
 * At D=126.4T (≈6,283 PHd/block) and a subsidy of 3.125 BTC → ~49,700 sats/PHd,
 * which is why the Refinery hashprice hovers near 50k: it IS this number.
 */
export function hashValuePerPhd(dT: number, blockRewardSats: number): number {
  const phd = phdNeededForBlock(dT);
  if (phd <= 0 || blockRewardSats <= 0) return 0;
  return blockRewardSats / phd;
}

export type RentVerdict = "cheap" | "parity" | "expensive";

export interface BreakEvenEval {
  /** what a PHd of work is worth (sats), the break-even you should pay. */
  breakEvenSatsPerPhd: number;
  /** what the Refinery is charging per PHd right now (sats). */
  liveSatsPerPhd: number;
  /** live / break-even. <1 you pay less than the work is worth. */
  ratio: number;
  verdict: RentVerdict;
}

/**
 * Compare the live hashprice to the break-even hashvalue and bucket it.
 *   ratio = live / break-even.
 *   ≤ 1−band  → "cheap"     (renting is +EV on raw hashvalue)
 *   ≥ 1+band  → "expensive" (you're overpaying vs the work's worth)
 *   otherwise → "parity"    (near fair value)
 * `band` is the neutral zone half-width (default 2%). Ignores variance and
 * pot-sharing — this is purely price vs raw hashvalue.
 */
export function breakEvenVerdict(
  liveSatsPerPhd: number,
  breakEvenSatsPerPhd: number,
  band = 0.02,
): BreakEvenEval {
  const ratio = breakEvenSatsPerPhd > 0 ? liveSatsPerPhd / breakEvenSatsPerPhd : Infinity;
  let verdict: RentVerdict;
  if (ratio <= 1 - band) verdict = "cheap";
  else if (ratio >= 1 + band) verdict = "expensive";
  else verdict = "parity";
  return { breakEvenSatsPerPhd, liveSatsPerPhd, ratio, verdict };
}

/**
 * Probability the pool finds at least one block within `days`, given the
 * expected days-per-block. Mining is memoryless, so block arrivals are a
 * Poisson process and the wait is exponential:
 *   P(≥1 within t) = 1 − e^(−t / expectedDays).
 * These are probabilities, not predictions — a deep pot does not "come due".
 *
 * At expectedDays≈63.5 (D=126.4T, H=99): P within 1 day ≈ 1.6%, 7 days ≈ 10.4%.
 */
export function blockProbWithin(days: number, expectedDays: number): number {
  if (days <= 0) return 0;
  if (!Number.isFinite(expectedDays) || expectedDays <= 0) return 0;
  return 1 - Math.exp(-days / expectedDays);
}
