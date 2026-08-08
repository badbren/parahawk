import { config } from "../../config.js";
import type { VenueContext, VenueQuote } from "./types.js";

const SATS_PER_BTC = 100_000_000;
// The real SHA-256 marketplace liquidity is on SHA256ASICBOOST — the plain
// SHA256 book is nearly empty (~1-2 PH). Verified live: ASICBOOST carries
// ~12,000 PH vs ~1.6 PH on SHA256.
export const NH_ALGO = "SHA256ASICBOOST";
const NH_ORDERBOOK = `https://api2.nicehash.com/main/api/v2/hashpower/orderBook?algorithm=${NH_ALGO}&size=100`;

/**
 * NiceHash quotes its SHA-256 marketplace in BTC per PH per day. One PH/s for
 * one day is exactly one PHd, so the conversion is a straight unit change:
 *   sats/PHd = (BTC/PH/day) × 100,000,000.
 * Pure + exported so the normalization is unit-tested independent of the API.
 */
export function nicehashBtcPerPhDayToSatsPerPhd(btcPerPhDay: number): number {
  return btcPerPhDay * SATS_PER_BTC;
}

/**
 * Normalize an order-book price (BTC per displayMarketFactor-unit per day) to
 * sats/PHd. `marketFactor` is hashes per display unit (e.g. 1e18 = one EH), so
 * dividing by marketFactor/1e15 rescales to per-PH. Pure + tested.
 */
export function nicehashOrderPriceToSatsPerPhd(price: number, marketFactor: number): number {
  if (marketFactor <= 0) return 0;
  return (price * SATS_PER_BTC) / (marketFactor / 1e15);
}

/**
 * The live market price is the volume-weighted average price across orders
 * actually receiving hashrate (alive with acceptedSpeed > 0) — the honest
 * "what buyers are paying right now" number, not a single lowball ask.
 */
export function nicehashVwapSatsPerPhd(stats: {
  marketFactor: string | number;
  orders?: Array<{ price: string | number; acceptedSpeed: string | number; alive?: boolean }>;
}): number {
  const mf = Number(stats.marketFactor);
  let num = 0;
  let den = 0;
  for (const o of stats.orders ?? []) {
    const p = Number(o.price);
    const acc = Number(o.acceptedSpeed);
    if (o.alive && acc > 0 && p > 0) {
      num += p * acc;
      den += acc;
    }
  }
  if (den <= 0) return 0;
  return nicehashOrderPriceToSatsPerPhd(num / den, mf);
}

/** Mock fixture: NiceHash ~51.8k sats/PHd, the usual liquidity-king price. */
const MOCK_BTC_PER_PH_DAY = 0.000518; // → 51,800 sats/PHd

/**
 * NiceHash SHA-256 spot price. Public order-book endpoint needs no auth (order
 * placement, later, uses the user's own key). In mock mode we serve the fixture
 * so the board works with zero credentials.
 */
export async function fetchNiceHashQuote(_ctx: VenueContext): Promise<VenueQuote> {
  if (config.mockData) {
    return {
      venue: "NiceHash",
      slug: "nicehash",
      satsPerPhd: nicehashBtcPerPhDayToSatsPerPhd(MOCK_BTC_PER_PH_DAY),
      capacityPhd: 140,
      minOrderPhd: 0.5,
      source: "api",
      url: "https://www.nicehash.com/my/marketplace/SHA256",
      note: "spot marketplace · custom stratum supported",
      fetchedAt: Date.now(),
      live: true,
    };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(NH_ORDERBOOK, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`NiceHash orderBook ${res.status}`);
    const j = (await res.json()) as { stats?: { BTC?: { marketFactor: string; totalSpeed?: string; orders?: any[] } } };
    const m = j.stats?.BTC;
    if (!m) throw new Error("NiceHash orderBook: no BTC stats");
    const sats = nicehashVwapSatsPerPhd(m);
    if (sats <= 0) throw new Error("NiceHash orderBook: no filled orders");
    const capacityPhd = m.totalSpeed ? Number(m.totalSpeed) * 1000 : undefined; // EH → PH
    return {
      venue: "NiceHash",
      slug: "nicehash",
      satsPerPhd: sats,
      capacityPhd,
      minOrderPhd: 0.005,
      source: "api",
      url: "https://www.nicehash.com/my/marketplace/SHA256",
      note: "spot marketplace · avg fill price · custom stratum",
      fetchedAt: Date.now(),
      live: true,
    };
  } finally {
    clearTimeout(t);
  }
}
