import { getStore } from "../db/index.js";
import { RATE_10T_PHD } from "../math/constants.js";

export interface LuckCell {
  dayOfWeek: number; // 0=Sun..6=Sat
  hourOfDay: number; // 0..23
  samples: number;
  /** Observed share quality: avg best-diff per unit of pool hashrate. */
  qualityIndex: number;
  /** qualityIndex relative to the global mean. ~1.0 = no method / expected. */
  ratio: number;
  /** True when too few samples to trust this cell. */
  lowConfidence: boolean;
}

export interface LuckAudit {
  cells: LuckCell[];
  globalMean: number;
  totalSamples: number;
  /** Rough total pool work observed, PHd. */
  totalPhd: number;
  /** Expected number of 10T hits over that work at the 1-in-500 baseline. */
  expected10t: number;
  minSamplesForConfidence: number;
  hasData: boolean;
}

const MIN_SAMPLES = 5;
/** Approx spacing between samples, in hours, used to turn samples → work. */
const SAMPLE_SPACING_HOURS = 1;

/**
 * The luck audit. For every hour-of-day × day-of-week bucket we compute a share
 * "quality index" = average best-diff-since-block per unit of pool hashrate, and
 * express it as a ratio to the global mean. Expectation is a flat ~1.0 across
 * every bucket: mining luck has no clock. If a bucket sustainedly glows above
 * the 1-in-500 baseline, that's evidence of a method — this page shows the live
 * data so anyone can judge. Low-sample buckets are flagged, not hidden.
 */
export async function getLuckAudit(): Promise<LuckAudit> {
  const buckets = await getStore().getLuckBuckets();
  const usable = buckets.filter((b) => b.samples > 0 && b.avgHashrate > 0);

  // weighted global mean of the quality index
  let wsum = 0;
  let n = 0;
  let totalPhd = 0;
  for (const b of usable) {
    const q = b.avgBestDiff / b.avgHashrate;
    wsum += q * b.samples;
    n += b.samples;
    // work in this bucket ≈ hashrate(PH/s) × time(days)
    totalPhd += b.avgHashrate * ((b.samples * SAMPLE_SPACING_HOURS) / 24);
  }
  const globalMean = n > 0 ? wsum / n : 0;

  const cells: LuckCell[] = usable.map((b) => {
    const q = b.avgBestDiff / b.avgHashrate;
    return {
      dayOfWeek: b.dayOfWeek,
      hourOfDay: b.hourOfDay,
      samples: b.samples,
      qualityIndex: q,
      ratio: globalMean > 0 ? q / globalMean : 0,
      lowConfidence: b.samples < MIN_SAMPLES,
    };
  });

  return {
    cells,
    globalMean,
    totalSamples: n,
    totalPhd,
    expected10t: totalPhd / RATE_10T_PHD,
    minSamplesForConfidence: MIN_SAMPLES,
    hasData: n > 0,
  };
}
