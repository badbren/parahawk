import { config } from "../../config.js";
import type { VenueContext, VenueQuote } from "./types.js";

/**
 * Braiins sells hashrate that is locked to Braiins' own solo pool — it CANNOT be
 * pointed at Parasite. It's on the board only for the solo-yolo comparison, so a
 * user can see its (usually premium) price honestly against the rentable venues.
 * Always badged "Braiins solo only" via the note; never offered in the buy flow
 * for a Parasite target.
 */
const MOCK_SATS_PER_PHD = 59_500; // typically a premium vs the rentable venues

export async function fetchBraiinsQuote(_ctx: VenueContext): Promise<VenueQuote> {
  if (config.mockData) {
    return {
      venue: "Braiins",
      slug: "braiins",
      satsPerPhd: MOCK_SATS_PER_PHD,
      source: "scraped",
      url: "https://braiins.com",
      note: "⚠ Braiins solo pool only — cannot point at Parasite",
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
