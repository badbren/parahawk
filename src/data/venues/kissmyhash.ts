import { config } from "../../config.js";
import { getManualPrice } from "../../services/manual-prices.js";
import type { VenueContext, VenueQuote } from "./types.js";

/**
 * Kiss My Hash is a reseller sourcing from NiceHash, with its quotes gated behind
 * Discord login (verified: /api/quote returns 401 without a session) — so we
 * can't fetch a live price. The honest treatment is an admin-set *manual* figure
 * (via the /admin page, stored in manual_prices), carrying its own timestamp —
 * the board renders it as "manual · Xm ago", never dressed up as live. Pool
 * targets are KMH's own list, which DOES include Parasite (verified in their UI).
 */
const MOCK_SATS_PER_PHD = 56_300;
const MOCK_AGE_MS = 40 * 60_000;
const NOTE = "reseller (NiceHash-sourced) · Parasite supported";

export async function fetchKissMyHashQuote(_ctx: VenueContext): Promise<VenueQuote> {
  // Prefer an admin-set manual price; fall back to the mock fixture in dev.
  const manual = await getManualPrice("kissmyhash").catch(() => null);
  const satsPerPhd = manual?.satsPerPhd ?? (config.mockData ? MOCK_SATS_PER_PHD : 0);
  const fetchedAt = manual?.updatedAt ?? (config.mockData ? Date.now() - MOCK_AGE_MS : 0);

  if (satsPerPhd <= 0) {
    return {
      venue: "Kiss My Hash",
      slug: "kissmyhash",
      satsPerPhd: 0,
      source: "manual",
      url: "https://app.kissmyhash.com",
      note: NOTE,
      fetchedAt: 0,
      live: false,
      error: "login-gated — set a manual price in /admin",
    };
  }

  return {
    venue: "Kiss My Hash",
    slug: "kissmyhash",
    satsPerPhd,
    source: "manual",
    url: "https://app.kissmyhash.com",
    note: NOTE,
    fetchedAt,
    live: false, // manual entries are never "live" — freshness shown as age
  };
}
