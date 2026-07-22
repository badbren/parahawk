import {
  RATE_10T_PHD,
  RATE_21T_PHD,
  RATE_BLOCK_PHD,
  PLEB_SHARE_EXPECTED_RETURN,
} from "./constants.js";

/**
 * Probability of at least one hit in `workPhd` of work, for a process that
 * produces one hit per `ratePhd` on average. Poisson: 1 − e^(−W/rate).
 */
export function probabilityAtLeastOne(workPhd: number, ratePhd: number): number {
  if (workPhd <= 0) return 0;
  if (ratePhd <= 0) return 1;
  return 1 - Math.exp(-workPhd / ratePhd);
}

/** Expected number of hits in `workPhd` of work at the given rate. */
export function expectedHits(workPhd: number, ratePhd: number): number {
  if (workPhd <= 0 || ratePhd <= 0) return 0;
  return workPhd / ratePhd;
}

/** Work accumulated (PHd) by a miner running at `hashratePhs` for `days` days. */
export function phdFromHashrate(hashratePhs: number, days: number): number {
  return hashratePhs * days;
}

/**
 * Days for a miner at `hashratePhs` to accumulate one expected hit of a tier
 * whose rate is `ratePhd`. e.g. 75 PH/s, RATE_10T_PHD=500 → ~6.67 days.
 */
export function daysToExpectedHit(hashratePhs: number, ratePhd: number): number {
  if (hashratePhs <= 0) return Infinity;
  return ratePhd / hashratePhs;
}

export interface OddsResult {
  workPhd: number;
  /** P(≥1 share of 10T+ difficulty). */
  tenTChance: number;
  /** P(≥1 share of 21T+ difficulty). */
  twentyOneTChance: number;
  /** P(≥1 block found). */
  blockChance: number;
  /** Expected long-run pleb-share return as a fraction of rental cost. */
  expectedPlebReturn: number;
}

/** Full odds breakdown for a given amount of work in PHd. */
export function oddsForWork(workPhd: number): OddsResult {
  return {
    workPhd,
    tenTChance: probabilityAtLeastOne(workPhd, RATE_10T_PHD),
    twentyOneTChance: probabilityAtLeastOne(workPhd, RATE_21T_PHD),
    blockChance: probabilityAtLeastOne(workPhd, RATE_BLOCK_PHD),
    expectedPlebReturn: PLEB_SHARE_EXPECTED_RETURN,
  };
}
