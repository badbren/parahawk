import { HASHPRICE_FAIR_VALUE_SATS } from "./constants.js";

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
