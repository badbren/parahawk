import { config } from "../../config.js";
import type { VenueContext, VenueQuote } from "./types.js";

/**
 * Kiss My Hash is a reseller with no known public price API and a login gate, so
 * we can't fetch a live quote. The honest treatment is a *manual* entry an admin
 * updates, carrying its own timestamp — the board renders it as "manual · Xm
 * ago" and never dresses it up as live. Pool targets are limited to KMH's own
 * list (Parasite / Ocean / Atlas), noted on the row.
 *
 * KMH_SATS_PER_PHD / KMH_UPDATED_AT env vars let an admin refresh it without a
 * deploy; absent those, the mock fixture stands in.
 */
const MOCK_SATS_PER_PHD = 56_300;
/** Fixture timestamp: ~40 min old, to demonstrate honest staleness on the board. */
const MOCK_AGE_MS = 40 * 60_000;

function envNumber(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function fetchKissMyHashQuote(_ctx: VenueContext): Promise<VenueQuote> {
  const adminSats = envNumber("KMH_SATS_PER_PHD");
  const adminUpdated = envNumber("KMH_UPDATED_AT"); // epoch ms

  const satsPerPhd = adminSats ?? (config.mockData ? MOCK_SATS_PER_PHD : 0);
  const fetchedAt = adminUpdated ?? (config.mockData ? Date.now() - MOCK_AGE_MS : 0);

  if (satsPerPhd <= 0) {
    // No admin figure and not in mock mode → be honest: no current price.
    return {
      venue: "Kiss My Hash",
      slug: "kissmyhash",
      satsPerPhd: 0,
      source: "manual",
      url: "https://app.kissmyhash.com",
      note: "reseller · pools limited to Parasite/Ocean/Atlas",
      fetchedAt: 0,
      live: false,
      error: "no manual price set (KMH_SATS_PER_PHD)",
    };
  }

  return {
    venue: "Kiss My Hash",
    slug: "kissmyhash",
    satsPerPhd,
    source: "manual",
    url: "https://app.kissmyhash.com",
    note: "reseller · pools limited to Parasite/Ocean/Atlas",
    fetchedAt,
    live: false, // manual entries are never "live" — freshness shown as age
  };
}
