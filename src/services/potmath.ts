import { getOverview, type OverviewSnapshot } from "./overview.js";
import { computePotMath, expectedWaitDays, type PotMathResult } from "../math/potmath.js";
import { getStore } from "../db/index.js";

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

// ── 24h trend ────────────────────────────────────────────────────────────────

/** One metric's movement over the trend window. */
export interface MetricTrend {
  /** value at the baseline (~24h ago). */
  prev: number;
  /** current − prev. */
  delta: number;
  /** delta as a percent of prev (0 when prev is 0). */
  pct: number;
}

/**
 * How every equation-derived Pot Math number has moved over the last ~24h.
 * `null` fields mean the number couldn't be compared (non-finite). The whole
 * object is null when there isn't yet a usable ~24h-old baseline sample.
 */
export interface PotMathTrend {
  /** actual hours between the baseline sample and now (~24). */
  spanHours: number;
  /** the pool found a block inside the window, so the pot reset — W-scoped
   *  numbers (W, depth, luck, rarity, share price) aren't comparable. */
  potReset: boolean;
  W: MetricTrend | null;
  D: MetricTrend | null;
  H: MetricTrend | null;
  depth: MetricTrend | null;
  luckPct: MetricTrend | null;
  /** rarity as a fraction 0–1 (render the delta as percentage points). */
  rarity: MetricTrend | null;
  satsPerG: MetricTrend | null;
  expectedDays: MetricTrend | null;
}

function mkTrend(cur: number, prev: number): MetricTrend | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  return { prev, delta: cur - prev, pct: prev !== 0 ? ((cur - prev) / prev) * 100 : 0 };
}

/**
 * Compare the current Pot Math snapshot against the poll sample nearest to 24h
 * ago. Returns null until at least ~12h of samples carrying W & D exist (the
 * feature only started storing them recently, so there's a warm-up period).
 */
export async function getPotMathTrend(current: PotMathSnapshot): Promise<PotMathTrend | null> {
  const now = Date.now();
  const targetMs = now - 24 * 3_600_000;
  const store = getStore();
  // Pull a generous window around the 24h mark and pick the closest usable row.
  const samples = await store.getSamplesSince(now - 30 * 3_600_000).catch(() => []);
  const usable = samples.filter(
    (s) =>
      typeof s.workSinceBlockT === "number" &&
      s.workSinceBlockT > 0 &&
      typeof s.minNeededDiffT === "number" &&
      s.minNeededDiffT > 0,
  );
  if (usable.length === 0) return null;

  let base = usable[0]!;
  for (const s of usable) {
    if (Math.abs(s.ts - targetMs) < Math.abs(base.ts - targetMs)) base = s;
  }
  const spanHours = (now - base.ts) / 3_600_000;
  // Need a real day-ish of separation, else the "24h" label would be a lie.
  if (spanHours < 12) return null;

  const prev = computePotMath(base.workSinceBlockT!, base.minNeededDiffT!, base.poolHashrate);
  const potReset = base.lastFoundHeight !== current.lastBlockFoundHeight;

  return {
    spanHours,
    potReset,
    W: mkTrend(current.W, prev.W),
    D: mkTrend(current.D, prev.D),
    H: mkTrend(current.hGauge, base.poolHashrate),
    depth: mkTrend(current.depth, prev.depth),
    luckPct: mkTrend(current.luckPct, prev.luckPct),
    rarity: mkTrend(current.rarity, prev.rarity),
    satsPerG: mkTrend(current.satsPerG, prev.satsPerG),
    expectedDays: mkTrend(current.expectedDays, prev.expectedDays),
  };
}
