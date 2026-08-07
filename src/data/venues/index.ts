import { satsPerPhdToUsd } from "../../math/hashprice.js";
import { getOverview } from "../../services/overview.js";
import { boardVerdict, type BoardVerdict, type VenueContext, type VenueQuote } from "./types.js";
import { fetchNiceHashQuote } from "./nicehash.js";
import { fetchMrrQuote } from "./miningrigrentals.js";
import { fetchRefineryQuote } from "./refinery.js";
import { fetchKissMyHashQuote } from "./kissmyhash.js";
import { fetchBraiinsQuote } from "./braiins.js";

export type { VenueQuote, VenueSource, BoardVerdict } from "./types.js";
export { boardVerdict } from "./types.js";

/** One rendered board row: a venue quote plus everything the page needs. */
export interface BoardRow extends VenueQuote {
  verdict: BoardVerdict;
  usdPerPhd: number;
  /** Can this venue's hashrate be pointed at the Parasite pool? (Braiins can't.) */
  canTargetParasite: boolean;
  /** Cheapest Parasite-capable priced venue on the board. */
  best: boolean;
  /** Sats/PHd cheaper (>0) or dearer (<0) than the Refinery baseline. */
  vsRefinerySats: number;
}

export interface MarketBoard {
  rows: BoardRow[];
  /** The Refinery baseline everyone is compared against. */
  refinerySatsPerPhd: number;
  /** Cheapest Parasite-capable venue, or null if none priced. */
  best: BoardRow | null;
  btcPriceUsd: number;
  generatedAt: number;
}

interface Adapter {
  slug: string;
  fetch: (ctx: VenueContext) => Promise<VenueQuote>;
  /** False for venues whose hashrate can't be routed to Parasite (Braiins). */
  canTargetParasite: boolean;
}

const ADAPTERS: Adapter[] = [
  { slug: "nicehash", fetch: fetchNiceHashQuote, canTargetParasite: true },
  { slug: "miningrigrentals", fetch: fetchMrrQuote, canTargetParasite: true },
  { slug: "refinery", fetch: fetchRefineryQuote, canTargetParasite: true },
  { slug: "kissmyhash", fetch: fetchKissMyHashQuote, canTargetParasite: true },
  { slug: "braiins", fetch: fetchBraiinsQuote, canTargetParasite: false },
];

/**
 * Last-good quote per venue. A venue that errors shows its last cached quote +
 * timestamp (marked not-live) rather than breaking the page — graceful
 * per-venue failure is a hard requirement of the board.
 */
const lastGood = new Map<string, VenueQuote>();

async function quoteFor(a: Adapter, ctx: VenueContext): Promise<VenueQuote> {
  try {
    const q = await a.fetch(ctx);
    if (q.satsPerPhd > 0) lastGood.set(a.slug, q);
    return q;
  } catch (err) {
    const cached = lastGood.get(a.slug);
    const msg = err instanceof Error ? err.message : "unreachable";
    if (cached) return { ...cached, live: false, error: msg };
    return {
      venue: a.slug,
      slug: a.slug,
      satsPerPhd: 0,
      source: "api",
      url: "#",
      fetchedAt: 0,
      live: false,
      error: msg,
    };
  }
}

// Short server-side cache so page loads / the 60s client refresh don't hammer
// the venue APIs on every hit (each serverless instance keeps its own).
let boardCache: { board: MarketBoard; at: number } | null = null;
const BOARD_TTL_MS = 45_000;

export async function getMarketBoard(): Promise<MarketBoard> {
  if (boardCache && Date.now() - boardCache.at < BOARD_TTL_MS) return boardCache.board;
  const board = await buildMarketBoard();
  boardCache = { board, at: Date.now() };
  return board;
}

/**
 * Assemble the live price board: every venue normalized to sats/PHd, verdict
 * chips vs the fair-value baseline, and the cheapest Parasite-capable venue
 * flagged so the page can show the savings-vs-Refinery headline.
 */
async function buildMarketBoard(): Promise<MarketBoard> {
  const overview = await getOverview();
  const btcPriceUsd = overview.pool.btcPriceUsd;
  const refineryHashprice = overview.pool.hashpriceSatsPerPhd;

  const ctx: VenueContext = {
    btcPriceUsd,
    refineryHashpriceSatsPerPhd: refineryHashprice,
  };

  const quotes = await Promise.all(ADAPTERS.map((a) => quoteFor(a, ctx)));
  const canTarget = new Map(ADAPTERS.map((a) => [a.slug, a.canTargetParasite]));

  // Baseline = the Refinery quote if we got one, else the derived hashprice.
  const refineryQuote = quotes.find((q) => q.slug === "refinery");
  const refinerySatsPerPhd =
    refineryQuote && refineryQuote.satsPerPhd > 0 ? refineryQuote.satsPerPhd : refineryHashprice;

  // Cheapest Parasite-capable venue with a real price is the "best".
  const priced = quotes.filter(
    (q) => q.satsPerPhd > 0 && canTarget.get(q.slug),
  );
  const bestSlug =
    priced.length > 0
      ? priced.reduce((lo, q) => (q.satsPerPhd < lo.satsPerPhd ? q : lo)).slug
      : null;

  const rows: BoardRow[] = quotes
    .map((q) => ({
      ...q,
      verdict: boardVerdict(q.satsPerPhd),
      usdPerPhd: q.satsPerPhd > 0 ? satsPerPhdToUsd(q.satsPerPhd, btcPriceUsd) : 0,
      canTargetParasite: canTarget.get(q.slug) ?? true,
      best: q.slug === bestSlug,
      vsRefinerySats: q.satsPerPhd > 0 ? refinerySatsPerPhd - q.satsPerPhd : 0,
    }))
    // Priced venues first (cheapest → dearest); unpriced/unreachable at the end.
    .sort((a, b) => {
      if (a.satsPerPhd <= 0) return 1;
      if (b.satsPerPhd <= 0) return -1;
      return a.satsPerPhd - b.satsPerPhd;
    });

  const best = rows.find((r) => r.best) ?? null;

  return { rows, refinerySatsPerPhd, best, btcPriceUsd, generatedAt: Date.now() };
}
