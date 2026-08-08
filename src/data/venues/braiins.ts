import { config } from "../../config.js";
import type { VenueContext, VenueQuote } from "./types.js";

/**
 * Braiins Hashpower IS a real hashrate rental marketplace (pay-as-you-hash) — but
 * it only routes to a fixed list of supported pools (Braiins Pool/Solo, AntPool,
 * F2Pool, ViaBTC, …), NOT an arbitrary custom stratum. Parasite is not on that
 * list, so rented Braiins hash can't be pointed at the pot today. Kept on the
 * board for price comparison and excluded from the Parasite buy flow until/unless
 * they add Parasite (or open custom stratums). See braiins.com/blog/buy-bitcoin-
 * hashrate-introducing-braiins-hashpower.
 */
const MOCK_SATS_PER_PHD = 59_500; // typically a premium vs the rentable venues

export async function fetchBraiinsQuote(_ctx: VenueContext): Promise<VenueQuote> {
  if (config.mockData) {
    return {
      venue: "Braiins",
      slug: "braiins",
      satsPerPhd: MOCK_SATS_PER_PHD,
      source: "scraped",
      url: "https://braiins.com/hashpower",
      note: "⚠ marketplace, but routes only to its own pool list — Parasite not supported yet",
      fetchedAt: Date.now(),
      live: true,
    };
  }
  // No public rental price feed for Braiins. Show it honestly as unpriced
  // rather than fabricate a number — it stays on the board for the solo
  // comparison, and an admin can supply a manual figure later.
  return {
    venue: "Braiins",
    slug: "braiins",
    satsPerPhd: 0,
    source: "manual",
    url: "https://braiins.com",
    note: "⚠ Braiins solo pool only · no public price feed",
    fetchedAt: 0,
    live: false,
  };
}
