import { MINUTES_PER_BLOCK } from "./constants.js";

export type PotVerdict = "fresh" | "aging" | "stale";

export interface PotAge {
  blocks: number;
  minutes: number;
  hours: number;
  days: number;
  verdict: PotVerdict;
}

/**
 * Pot age from chain heights.
 * age = (current chain height − Parasite's last-found height) × 10 min.
 * Verdict: 🟢 fresh (<1d) / 🟡 aging (1–2d) / 🔴 stale (>2d).
 */
export function computePotAge(
  currentChainHeight: number,
  lastFoundHeight: number,
): PotAge {
  const blocks = Math.max(0, currentChainHeight - lastFoundHeight);
  const minutes = blocks * MINUTES_PER_BLOCK;
  const hours = minutes / 60;
  const days = hours / 24;
  let verdict: PotVerdict;
  if (days < 1) verdict = "fresh";
  else if (days <= 2) verdict = "aging";
  else verdict = "stale";
  return { blocks, minutes, hours, days, verdict };
}

export interface HashrateSample {
  /** Unix ms timestamp. */
  ts: number;
  /** Pool hashrate in PH/s at that time. */
  hashratePhs: number;
}

/**
 * Estimate PHd of work banked in a pot by integrating hashrate samples over
 * time (trapezoidal). Samples must be sorted ascending by ts.
 * PHd = ∫ hashrate(PH/s) dt(days).
 */
export function integratePhd(samples: HashrateSample[]): number {
  if (samples.length < 2) return 0;
  const MS_PER_DAY = 86_400_000;
  let phd = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const dtDays = (b.ts - a.ts) / MS_PER_DAY;
    if (dtDays <= 0) continue;
    const avgHashrate = (a.hashratePhs + b.hashratePhs) / 2;
    phd += avgHashrate * dtDays;
  }
  return phd;
}
