import { config } from "../../config.js";
import type { VenueContext, VenueQuote } from "./types.js";

const SATS_PER_BTC = 100_000_000;
const MRR_ALGOS = "https://www.miningrigrentals.com/api/v2/info/algos";

/** MRR quotes prices as BTC per <unit> per day (gh/th/ph). Normalize to sats/PHd. */
export function mrrAlgoPriceToSatsPerPhd(amountBtc: number, unit: string): number {
  const perPh: Record<string, number> = { "gh*day": 1e6, "th*day": 1e3, "ph*day": 1 };
  const factor = perPh[unit];
  if (!factor || !(amountBtc > 0)) return 0;
  return amountBtc * factor * SATS_PER_BTC;
}

/** Convert MRR's capacity ("ph"/"th"/"gh") to PH. */
function mrrHashToPh(hash: number, unit: string): number {
  const toPh: Record<string, number> = { gh: 1e-6, th: 1e-3, ph: 1 };
  return hash * (toPh[unit] ?? 0);
}

/**
 * MiningRigRentals is a P2P rig market: each rig is priced in BTC/day for a
 * given speed in PH/s. Effective price for one PHd is therefore:
 *   sats/PHd = (pricePerDayBtc / speedPhs) × 100,000,000.
 */
export function mrrRigToSatsPerPhd(pricePerDayBtc: number, speedPhs: number): number {
  if (speedPhs <= 0) return 0;
  return (pricePerDayBtc / speedPhs) * SATS_PER_BTC;
}

/**
 * A P2P market has scam-priced outliers, so the venue price is the average of
 * the cheapest three rigs — a robust "what can I actually rent right now"
 * number rather than the single lowest (often a stale or fake listing).
 */
export function mrrBestThreeAverageSatsPerPhd(
  rigs: Array<{ pricePerDayBtc: number; speedPhs: number }>,
): number {
  const priced = rigs
    .map((r) => mrrRigToSatsPerPhd(r.pricePerDayBtc, r.speedPhs))
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  if (priced.length === 0) return 0;
  const best = priced.slice(0, 3);
  return best.reduce((a, b) => a + b, 0) / best.length;
}

/** Mock rig book — best-3 average lands at ~54.2k sats/PHd. */
const MOCK_RIGS = [
  { pricePerDayBtc: 0.000535, speedPhs: 1.0 }, // 53,500
  { pricePerDayBtc: 0.000542, speedPhs: 1.0 }, // 54,200
  { pricePerDayBtc: 0.001098, speedPhs: 2.0 }, // 54,900
  { pricePerDayBtc: 0.000630, speedPhs: 1.0 }, // 63,000 (outlier, excluded)
];

export async function fetchMrrQuote(_ctx: VenueContext): Promise<VenueQuote> {
  if (config.mockData) {
    const capacityPhd = MOCK_RIGS.reduce((a, r) => a + r.speedPhs, 0);
    return {
      venue: "MiningRigRentals",
      slug: "miningrigrentals",
      satsPerPhd: mrrBestThreeAverageSatsPerPhd(MOCK_RIGS),
      capacityPhd,
      minOrderPhd: 0.1,
      source: "api",
      url: "https://www.miningrigrentals.com/rigs/sha256",
      note: "best-3-rigs avg · custom pool supported",
      fetchedAt: Date.now(),
      live: true,
    };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(MRR_ALGOS, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`MRR algos ${res.status}`);
    const j = (await res.json()) as { data?: any[] };
    const sha = (j.data ?? []).find((a) => /sha-?256/i.test(a?.name) || /sha-?256/i.test(a?.display));
    const low = sha?.stats?.prices?.lowest;
    if (!low) throw new Error("MRR: no SHA-256 price");
    const sats = mrrAlgoPriceToSatsPerPhd(Number(low.amount), String(low.unit));
    if (sats <= 0) throw new Error("MRR: unpriced");
    const avail = sha?.stats?.available?.hash;
    const capacityPhd = avail ? mrrHashToPh(Number(avail.hash), String(avail.unit)) : undefined;
    return {
      venue: "MiningRigRentals",
      slug: "miningrigrentals",
      satsPerPhd: sats,
      capacityPhd: capacityPhd && capacityPhd > 0 ? capacityPhd : undefined,
      minOrderPhd: 0.1,
      source: "api",
      url: "https://www.miningrigrentals.com/rigs/sha256",
      note: "lowest available ask · custom pool supported",
      fetchedAt: Date.now(),
      live: true,
    };
  } finally {
    clearTimeout(t);
  }
}
