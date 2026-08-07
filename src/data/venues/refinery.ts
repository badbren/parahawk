import type { VenueContext, VenueQuote } from "./types.js";

/**
 * Refinery is Parasite-native and already integrated: its hashprice is the live
 * sats/PHd figure the overview derives from network difficulty + block subsidy.
 * We reuse that number rather than re-deriving it (single source of truth) — the
 * adapter is a thin wrapper so Refinery sits on the board next to the others.
 */
export async function fetchRefineryQuote(ctx: VenueContext): Promise<VenueQuote> {
  const sats = ctx.refineryHashpriceSatsPerPhd;
  return {
    venue: "Refinery",
    slug: "refinery",
    // Fall back to the fixture only if the live hashprice is unavailable.
    satsPerPhd: sats > 0 ? sats : 52_500,
    source: "api",
    url: "https://parasite.space",
    note: "Parasite-native · routes straight into the pot",
    fetchedAt: Date.now(),
    live: sats > 0,
  };
}
