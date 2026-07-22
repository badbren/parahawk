import {
  PHD_TO_DIFF,
  BEST_DIFF_WORK_MULTIPLIER_MIN,
  BEST_DIFF_WORK_MULTIPLIER_MAX,
  CALIBRATION_NETWORK_DIFF,
} from "./constants.js";

/** Convert accumulated total work (difficulty units) into lifetime PHd. */
export function diffToPhd(totalWorkDiff: number): number {
  return totalWorkDiff / PHD_TO_DIFF;
}

/** Convert PHd of work into difficulty units. */
export function phdToDiff(phd: number): number {
  return phd * PHD_TO_DIFF;
}

/**
 * Expected best-difficulty range for a miner with `totalWorkDiff` of work.
 * Best diff ≈ 1–1.5× total work in difficulty units.
 */
export function expectedBestDiffRange(totalWorkDiff: number): {
  min: number;
  max: number;
} {
  return {
    min: totalWorkDiff * BEST_DIFF_WORK_MULTIPLIER_MIN,
    max: totalWorkDiff * BEST_DIFF_WORK_MULTIPLIER_MAX,
  };
}

/**
 * A best difficulty expressed as a percentage of what is needed to solve a
 * block at the given network difficulty. 100% = a block was found.
 */
export function bestDiffAsBlockPercent(
  bestDiff: number,
  networkDiff: number = CALIBRATION_NETWORK_DIFF,
): number {
  if (networkDiff <= 0) return 0;
  return (bestDiff / networkDiff) * 100;
}

export interface Odometer {
  totalWorkDiff: number;
  lifetimePhd: number;
  bestDiff: number;
  bestDiffBlockPercent: number;
  expectedBestDiffMin: number;
  expectedBestDiffMax: number;
  /** How the observed best diff compares to expectation: <1 unlucky, >1 lucky. */
  luckRatio: number;
}

/** Full odometer readout for a public address. */
export function computeOdometer(
  totalWorkDiff: number,
  bestDiff: number,
  networkDiff: number = CALIBRATION_NETWORK_DIFF,
): Odometer {
  const range = expectedBestDiffRange(totalWorkDiff);
  const expectedMid = (range.min + range.max) / 2;
  return {
    totalWorkDiff,
    lifetimePhd: diffToPhd(totalWorkDiff),
    bestDiff,
    bestDiffBlockPercent: bestDiffAsBlockPercent(bestDiff, networkDiff),
    expectedBestDiffMin: range.min,
    expectedBestDiffMax: range.max,
    luckRatio: expectedMid > 0 ? bestDiff / expectedMid : 0,
  };
}
