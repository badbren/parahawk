import { HASHPRICE_FAIR_VALUE_SATS } from "./constants.js";

const SATS_PER_BTC = 100_000_000;
const SECONDS_PER_DAY = 86_400;
const TWO_POW_32 = 4_294_967_296; // 2^32

/** Block subsidy (BTC) at a given height — halves every 210,000 blocks. */
export function blockSubsidyBtc(height: number): number {
  const halvings = Math.floor(height / 210_000);
  if (halvings >= 64) return 0;
  return 50 / 2 ** halvings;
}

/**
 * Bitcoin hashprice in sats per PHd (petahash-day) — the expected mining revenue
 * for one PH/s running for one day, from the block subsidy alone.
 *
 * Expected blocks for hashrate H over time t = H·t / (difficulty · 2^32).
 * For H = 1e15 H/s (1 PH/s) and t = 1 day: revenue = blocks · subsidy.
 * This is the market rate the Refinery rents hashrate at (~50k sats/PHd).
 */
export function hashpriceSatsPerPhd(difficulty: number, height: number): number {
  if (difficulty <= 0) return 0;
  const subsidySats = blockSubsidyBtc(height) * SATS_PER_BTC;
  const expectedBlocks = (1e15 * SECONDS_PER_DAY) / (difficulty * TWO_POW_32);
  return expectedBlocks * subsidySats;
}

export type HashpriceVerdict = "good" | "normal" | "expensive";

export interface HashpriceEval {
  satsPerPhd: number;
  usdPerPhd: number;
  fairValueSats: number;
  /** Ratio to fair value: <1 cheaper than baseline, >1 more expensive. */
  ratio: number;
  verdict: HashpriceVerdict;
}

/** Convert a sats/PHd hashprice into USD/PHd given the BTC price in USD. */
export function satsPerPhdToUsd(satsPerPhd: number, btcPriceUsd: number): number {
  return (satsPerPhd / 100_000_000) * btcPriceUsd;
}

/**
 * Evaluate Refinery hashprice against the ~50k sats/PHd fair-value baseline.
 * Renting is "good" when meaningfully below baseline (you get more work per sat),
 * "expensive" when meaningfully above it.
 */
export function evaluateHashprice(
  satsPerPhd: number,
  btcPriceUsd: number,
  fairValueSats: number = HASHPRICE_FAIR_VALUE_SATS,
): HashpriceEval {
  const ratio = fairValueSats > 0 ? satsPerPhd / fairValueSats : 1;
  let verdict: HashpriceVerdict;
  if (ratio <= 0.9) verdict = "good";
  else if (ratio >= 1.1) verdict = "expensive";
  else verdict = "normal";
  return {
    satsPerPhd,
    usdPerPhd: satsPerPhdToUsd(satsPerPhd, btcPriceUsd),
    fairValueSats,
    ratio,
    verdict,
  };
}
