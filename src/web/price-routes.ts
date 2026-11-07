/**
 * Hand-typed venue prices, updated from the Marketplace and moderated in /admin.
 *
 *   POST /api/prices/:venue               { usd, csrf } — a visitor with the "Trusted"
 *                                         badge (or the owner) updates a stale price
 *   GET  /api/prices/history?limit=50     owner — the change log and the blocked list (JSON)
 *   POST /api/prices/history/:id/revert   owner — put back the price a change replaced
 *   POST /api/prices/bans                 owner — { address } block it from editing prices
 *   POST /api/prices/bans/remove          owner — { address } unblock it
 *
 * Who may update: the owner, or anyone whose permissions (src/activity/
 * permissions.ts) include "edit_prices" and whom the owner hasn't blocked.
 * Visitors also pass the bounds and pace rules in src/services/price-updates.ts,
 * and their edit only counts if it is logged. The owner skips the rules — the
 * same as the /admin form, which this doesn't replace.
 *
 * The owner's actions come from /admin's plain forms (urlencoded + csrf) and
 * redirect back there with a message; JSON callers get JSON. Where the prices,
 * log and blocks live is src/services/manual-prices.ts's call (never the live
 * database when running locally).
 */
import express from "express";
import { checkCsrf, getSession, type Session } from "../services/auth.js";
import { getOverview } from "../services/overview.js";
import { getMarketBoard } from "../data/venues/index.js";
import { permissionsFor, type Permission, type PermissionQuery } from "../activity/permissions.js";
import {
  banPriceEditor,
  changeManualPrice,
  getManualPrice,
  getPriceChanges,
  getPriceEditorBans,
  isPriceEditorBanned,
  revertPriceChange,
  unbanPriceEditor,
} from "../services/manual-prices.js";
import {
  COMMUNITY_VENUES,
  MARKET_VENUES,
  checkBounds,
  checkPace,
  checkUsd,
  isOwnerAddress,
  median,
} from "../services/price-updates.js";
import { MANUAL_VENUES, isAdmin, usdPerPhdToSatsPerPhd } from "./pages/admin.js";

const DAY_MS = 24 * 60 * 60_000;

export interface PriceRouterOptions {
  session?: (req: express.Request) => Session | null;
  isAdmin?: (session: Session | null) => boolean;
  permissions?: (address: string, q: PermissionQuery) => Promise<Set<Permission>>;
  /** The live BTC price the USD box converts at. */
  btcPriceUsd?: () => Promise<number>;
  /** Median sats/PHd of the live API venues, or null when none are up. */
  marketSats?: () => Promise<number | null>;
  checkCsrf?: (address: string, token: string | undefined) => boolean;
  now?: () => number;
}

/** Cross-site posts are refused outright; same-origin (or an absent / "null" Origin under no-referrer) passes — the csrf token does the rest. */
function sameOrigin(req: express.Request): boolean {
  const origin = req.get("origin");
  if (!origin || origin === "null") return true;
  try {
    const host = new URL(origin).host;
    return host === req.get("host") || host === req.get("x-forwarded-host");
  } catch {
    return false;
  }
}

async function liveBtcPriceUsd(): Promise<number> {
  return (await getOverview()).pool.btcPriceUsd;
}

async function liveMarketSats(): Promise<number | null> {
  const board = await getMarketBoard();
  return median(
    board.rows
      .filter((r) => MARKET_VENUES.has(r.slug) && r.source === "api" && !r.error && r.satsPerPhd > 0)
      .map((r) => r.satsPerPhd),
  );
}

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const venueNamed = (slug: string) => MANUAL_VENUES.find((v) => v.slug === slug);

export function priceRouter(opts: PriceRouterOptions = {}): express.Router {
  const session = opts.session ?? getSession;
  const owner = opts.isAdmin ?? isAdmin;
  const permissions = opts.permissions ?? permissionsFor;
  const btcPriceUsd = opts.btcPriceUsd ?? liveBtcPriceUsd;
  const marketSats = opts.marketSats ?? liveMarketSats;
  const csrfOk = opts.checkCsrf ?? checkCsrf;
  const now = opts.now ?? Date.now;

  const router = express.Router();
  const body = [express.json({ limit: "2kb" }), express.urlencoded({ extended: false, limit: "2kb" })];

  const fail = (res: express.Response, status: number, error: string, retryAfterMs?: number) => {
    if (retryAfterMs != null) res.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
    res.status(status).json({ error });
  };

  const fromForm = (req: express.Request) => Boolean(req.is("application/x-www-form-urlencoded"));

  /** Owner actions: back to /admin with a message for the forms, JSON otherwise. */
  const done = (req: express.Request, res: express.Response, status: number, message: string) => {
    if (fromForm(req)) return res.redirect(303, `/admin?msg=${encodeURIComponent(message)}`);
    if (status >= 400) return res.status(status).json({ error: message });
    return res.json({ ok: true, message });
  };

  /** The owner, from Parahawk, with a good csrf token — else answered and null. */
  const ownerFrom = (req: express.Request, res: express.Response): Session | null => {
    const s = session(req);
    const token = typeof req.body?.csrf === "string" ? req.body.csrf : undefined;
    if (!s || !owner(s) || !sameOrigin(req) || !csrfOk(s.address, token)) {
      done(req, res, 403, "Owner only — reload /admin and try again.");
      return null;
    }
    return s;
  };

  router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });

  // ── Owner: the log ─────────────────────────────────────────────────────────
  router.get("/history", async (req, res) => {
    const s = session(req);
    if (!s || !owner(s)) return fail(res, 403, "Owner only.");
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    try {
      const [changes, bans] = await Promise.all([getPriceChanges({ limit }), getPriceEditorBans()]);
      res.json({ changes, bans });
    } catch (err) {
      console.error("[/api/prices/history] failed:", err);
      fail(res, 503, "Couldn't read the price log right now.");
    }
  });

  router.post("/history/:id/revert", ...body, async (req, res) => {
    const s = ownerFrom(req, res);
    if (!s) return;
    try {
      const change = await revertPriceChange(String(req.params.id), s.address, now());
      if (!change) return done(req, res, 404, "That change isn't in the log any more.");
      const name = venueNamed(change.venue)?.name ?? change.venue;
      done(req, res, 200, change.newSats > 0
        ? `Put back: ${name} is ${int(change.newSats)} sats/PHd again.`
        : `Put back: ${name} has no hand-typed price again.`);
    } catch (err) {
      console.error("[/api/prices/revert] failed:", err);
      done(req, res, 503, "Couldn't put that back right now — try again.");
    }
  });

  // ── Owner: blocks ──────────────────────────────────────────────────────────
  const addressFrom = (req: express.Request): string | null => {
    const a = typeof req.body?.address === "string" ? req.body.address.trim() : "";
    return a.length >= 14 && a.length <= 120 && /^[A-Za-z0-9]+$/.test(a) ? a : null;
  };

  router.post("/bans", ...body, async (req, res) => {
    const s = ownerFrom(req, res);
    if (!s) return;
    const address = addressFrom(req);
    if (!address) return done(req, res, 400, "That doesn't look like a wallet address.");
    if (isOwnerAddress(address) || owner({ address, issuedAt: 0, expiresAt: 0 })) return done(req, res, 400, "That's your own wallet.");
    try {
      await banPriceEditor(address, s.address, now());
      done(req, res, 200, `Blocked ${address.slice(0, 10)}… from editing prices.`);
    } catch (err) {
      console.error("[/api/prices/bans] failed:", err);
      done(req, res, 503, "Couldn't block that wallet right now — try again.");
    }
  });

  router.post("/bans/remove", ...body, async (req, res) => {
    const s = ownerFrom(req, res);
    if (!s) return;
    const address = addressFrom(req);
    if (!address) return done(req, res, 400, "That doesn't look like a wallet address.");
    try {
      await unbanPriceEditor(address);
      done(req, res, 200, `Unblocked ${address.slice(0, 10)}… — it can edit prices again if it has the badge.`);
    } catch (err) {
      console.error("[/api/prices/bans/remove] failed:", err);
      done(req, res, 503, "Couldn't unblock that wallet right now — try again.");
    }
  });

  // ── Anyone allowed: update a stale price ───────────────────────────────────
  router.post("/:venue", ...body, async (req, res) => {
    const s = session(req);
    if (!s) return fail(res, 401, "Sign in with Xverse first.");
    const token = typeof req.body?.csrf === "string" ? req.body.csrf : undefined;
    if (!sameOrigin(req) || !csrfOk(s.address, token)) {
      return fail(res, 403, "That didn't come from Parahawk — reload the page and try again.");
    }
    const isOwner = owner(s);
    const venue = venueNamed(String(req.params.venue));
    if (!venue || (!isOwner && !COMMUNITY_VENUES.has(venue.slug))) {
      return fail(res, 404, "That venue doesn't take a hand-typed price.");
    }
    const usdOk = checkUsd(req.body?.usd);
    if (!usdOk.ok) return fail(res, usdOk.status, usdOk.error);
    const usd = Number(req.body.usd);

    try {
      if (!isOwner) {
        if (await isPriceEditorBanned(s.address)) return fail(res, 403, "Price updates are switched off for your wallet.");
        if (!(await permissions(s.address, { admin: false })).has("edit_prices")) {
          return fail(res, 403, "Updating prices comes with the Trusted badge — see Profile → Parahawk.");
        }
      }
      const btc = await btcPriceUsd().catch(() => 0);
      const sats = Math.round(usdPerPhdToSatsPerPhd(usd, btc));
      if (!(sats > 0)) return fail(res, 503, "No live BTC price right now — try again in a minute.");

      const t = now();
      if (!isOwner) {
        const recent = await getPriceChanges({ by: s.address, since: t - DAY_MS, limit: 100 });
        const pace = checkPace({ venue: venue.slug, venueName: venue.name, recent, now: t });
        if (!pace.ok) return fail(res, pace.status, pace.error, pace.retryAfterMs);
        const [current, market] = await Promise.all([
          getManualPrice(venue.slug).catch(() => null),
          marketSats().catch(() => null),
        ]);
        const bounds = checkBounds({ newSats: sats, currentSats: current?.satsPerPhd ?? null, marketSats: market, venueName: venue.name });
        if (!bounds.ok) return fail(res, bounds.status, bounds.error);
      }

      const change = await changeManualPrice({
        venue: venue.slug,
        satsPerPhd: sats,
        by: s.address,
        usd,
        note: `$${usd.toFixed(2)}/PHd @ BTC ${Math.round(btc)}`,
        now: t,
        mustLog: !isOwner,
      });
      res.json({ ok: true, venue: venue.slug, satsPerPhd: sats, usd, at: change.at });
    } catch (err) {
      console.error("[/api/prices] update failed:", err);
      fail(res, 503, "Couldn't save that right now — try again in a minute.");
    }
  });

  return router;
}
