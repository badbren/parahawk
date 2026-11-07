/**
 * /api/inscribe — the same-origin help the Inscribe window needs.
 *
 *   GET /api/inscribe/fees    recommended fee rates (sat/vB), mempool.space via
 *                             the server, because the site's CSP (connect-src
 *                             'self') keeps the browser from asking it directly.
 *
 * Mainnet only: Xverse's inscription flow (src/inscribe/payload.ts) supports
 * nothing else. There is no broadcast route: Xverse builds, signs and
 * broadcasts the inscription itself, and Parahawk never handles a transaction.
 *
 * Mounted behind the tighter /api limiter in server.ts (it calls upstream), and
 * the answer is cached here for 30 s and at the edge, so the window's refreshes
 * cost mempool.space almost nothing.
 */
import express from "express";
import { config } from "../config.js";
import { fetchJson } from "../data/cache.js";
import { parseRecommendedFees, type FeeRates } from "../inscribe/fees.js";

export interface InscribeRouterOptions {
  /** mempool.space's raw recommended-fees JSON. Injected in tests. */
  fetchRecommended?: () => Promise<unknown>;
  now?: () => number;
}

/** How long one upstream answer is served before asking again. */
export const FEES_TTL_MS = 30_000;
/** How old an answer may get while upstream is down before we stop serving it. */
export const FEES_STALE_MAX_MS = 10 * 60_000;

export function inscribeRouter(opts: InscribeRouterOptions = {}): express.Router {
  const router = express.Router();
  const now = opts.now ?? Date.now;
  const fetchRecommended =
    opts.fetchRecommended ??
    (() => fetchJson<unknown>(`${config.mempool.baseUrl.replace(/\/$/, "")}/v1/fees/recommended`, 5000));

  let cached: { rates: FeeRates; at: number } | null = null;
  /** One upstream request at a time, however many windows ask at once. */
  let inflight: Promise<FeeRates> | null = null;

  router.get("/fees", async (req, res) => {
    const network = typeof req.query.network === "string" ? req.query.network : "mainnet";
    if (network !== "mainnet") {
      res.status(400).set("Cache-Control", "no-store").json({ error: "Inscribing through Xverse works on mainnet only." });
      return;
    }

    if (!cached || now() - cached.at >= FEES_TTL_MS) {
      try {
        inflight ??= fetchRecommended()
          .then(parseRecommendedFees)
          .finally(() => { inflight = null; });
        cached = { rates: await inflight, at: now() };
      } catch (err) {
        // Upstream detail stays in the server log; the browser gets a plain sentence.
        console.error("[/api/inscribe/fees] upstream failed:", err instanceof Error ? err.message : err);
        if (!cached || now() - cached.at > FEES_STALE_MAX_MS) {
          res.status(503).set("Cache-Control", "no-store").json({ error: "Fee rates are unavailable right now — set one by hand." });
          return;
        }
      }
    }

    const stale = now() - cached.at >= FEES_TTL_MS;
    res.set("Cache-Control", stale ? "no-store" : "public, max-age=15, s-maxage=30, stale-while-revalidate=60");
    res.json({ network: "mainnet", source: "mempool.space", ...cached.rates, fetchedAt: new Date(cached.at).toISOString(), stale });
  });

  return router;
}
