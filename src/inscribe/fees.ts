/**
 * Recommended fee rates for the Inscribe window, from mempool.space's
 * /api/v1/fees/recommended, checked before they're trusted. Pure, so the route
 * (src/web/inscribe-routes.ts) and the tests share it.
 */

/** Whole sat/vB, each at least 1. Field names follow mempool.space. */
export interface FeeRates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

/** Anything above this is a broken feed, not a fee market. */
const SANE_MAX = 10_000;

function rate(raw: unknown, field: string): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0 || raw > SANE_MAX) {
    throw new Error(`fees: bad ${field}`);
  }
  // Round UP: Xverse takes whole sat/vB, and a rate rounded down can stall.
  return Math.max(1, Math.ceil(raw));
}

/** mempool.space's recommended-fees JSON → FeeRates, or throws when it isn't believable. */
export function parseRecommendedFees(raw: unknown): FeeRates {
  if (typeof raw !== "object" || raw === null) throw new Error("fees: not an object");
  const r = raw as Record<string, unknown>;
  const fastestFee = rate(r.fastestFee, "fastestFee");
  const halfHourFee = rate(r.halfHourFee, "halfHourFee");
  const hourFee = rate(r.hourFee, "hourFee");
  const economyFee = r.economyFee === undefined ? hourFee : rate(r.economyFee, "economyFee");
  const minimumFee = r.minimumFee === undefined ? 1 : rate(r.minimumFee, "minimumFee");
  return { fastestFee, halfHourFee, hourFee, economyFee, minimumFee };
}
