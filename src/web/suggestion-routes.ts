/**
 * Suggestions API — a title and some notes for the owner, and the owner's inbox.
 *
 *   POST   /api/suggestions          { title, notes }          anyone (guests too)
 *   GET    /api/suggestions          ?limit=200                owner only: newest first + new count
 *   GET    /api/suggestions/count    { new }                   owner only: for the icon badge
 *   PATCH  /api/suggestions/:id      { status: new|read|done } owner only
 *   DELETE /api/suggestions/:id                                owner only
 *
 * Who sent it comes from the server session (a signed-in Xverse wallet), never
 * from the body: a guest's suggestion simply has no address. Spam is kept down
 * by a hidden honeypot field (filled → quietly dropped, the bot sees success),
 * the same-origin check, a 16 kb body, a per-IP cap (express-rate-limit, keyed
 * the same way as server.ts's limiters) and a per-address daily cap counted in
 * the store, so it holds across serverless instances.
 *
 * Where the rows live is src/suggestions/store.ts's call (never the live
 * database when running locally).
 */
import { randomUUID } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { recordActivity } from "../activity/record.js";
import { displayNamesFor } from "../profile/names.js";
import { getSession, type Session } from "../services/auth.js";
import { checkSuggestion, isStatus, type InboxItem, type InboxPage, type SuggestionRecord } from "../suggestions/rules.js";
import { createSuggestionStore, type SuggestionStore } from "../suggestions/store.js";
import { isAdmin as ownerCheck } from "./pages/admin.js";

export interface Limit { windowMs: number; limit: number }

export interface SuggestionsRouterOptions {
  store?: SuggestionStore;
  session?: (req: express.Request) => Session | null;
  isAdmin?: (session: Session | null) => boolean;
  now?: () => number;
  namesFor?: (addresses: readonly string[]) => Promise<Map<string, string>>;
  record?: (address: string, kind: "suggestion") => Promise<void>;
  /** Sends per IP. Default 5 an hour; null switches it off (tests). Only accepted sends count. */
  ipLimit?: Limit | null;
  /** Sends per signed-in address. Default 10 a day. */
  addressLimit?: Limit;
}

const HOUR = 3_600_000;
const DEFAULT_IP_LIMIT: Limit = { windowMs: HOUR, limit: 5 };
const DEFAULT_ADDRESS_LIMIT: Limit = { windowMs: 24 * HOUR, limit: 10 };
const INBOX_DEFAULT = 200;
const INBOX_MAX = 500;

/** Cross-site posts are refused outright; same-origin fetches (or an absent / "null" Origin under no-referrer) pass. */
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

export function suggestionsRouter(opts: SuggestionsRouterOptions = {}): express.Router {
  let store = opts.store ?? null;
  const getStore = (): SuggestionStore => (store ??= createSuggestionStore());
  const session = opts.session ?? getSession;
  const isAdmin = opts.isAdmin ?? ownerCheck;
  const now = opts.now ?? Date.now;
  const namesFor = opts.namesFor ?? displayNamesFor;
  const record = opts.record ?? recordActivity;
  const ipLimit = opts.ipLimit === undefined ? DEFAULT_IP_LIMIT : opts.ipLimit;
  const addressLimit = opts.addressLimit ?? DEFAULT_ADDRESS_LIMIT;

  const r = express.Router();
  const json = express.json({ limit: "16kb" });

  // Per IP, per instance — the same shape as server.ts's limiters (default key:
  // req.ip). Failed sends (a typo'd form, a 429) don't use up the allowance.
  const perIp: express.RequestHandler = ipLimit
    ? rateLimit({
        windowMs: ipLimit.windowMs,
        limit: ipLimit.limit,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        skipFailedRequests: true,
        handler: (_req, res) => {
          res.status(429).set("Cache-Control", "no-store")
            .json({ error: "that's a lot of suggestions from here — try again in an hour" });
        },
      })
    : (_req, _res, next) => next();

  /** The owner's routes: no caching, same origin, and the session must be the owner's. */
  const owner = (req: express.Request, res: express.Response): boolean => {
    res.set("Cache-Control", "private, no-store");
    if (!sameOrigin(req)) { res.status(403).json({ error: "cross-site request refused" }); return false; }
    const s = session(req);
    if (!s) { res.status(401).json({ error: "sign in as the owner to read suggestions" }); return false; }
    if (!isAdmin(s)) { res.status(403).json({ error: "only the owner can read suggestions" }); return false; }
    return true;
  };

  // ── Send ───────────────────────────────────────────────────────────────────
  r.post("/", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!sameOrigin(req)) { res.status(403).json({ error: "cross-site request refused" }); return; }
    if (!req.is("application/json")) { res.status(415).json({ error: "send JSON" }); return; }
    next();
  }, perIp, json, async (req, res) => {
    const body = req.body as Record<string, unknown> | null;
    // The honeypot: a field people never see. Whatever filled it gets a thank-you and nothing is kept.
    if (body && typeof body === "object" && typeof body.website === "string" && body.website.trim() !== "") {
      res.status(201).json({ ok: true });
      return;
    }
    const checked = checkSuggestion(body);
    if (!checked.ok) { res.status(400).json({ error: checked.error, field: checked.field }); return; }

    const s = session(req);
    const t = now();
    try {
      if (s) {
        const sent = await getStore().countFromSince(s.address, t - addressLimit.windowMs);
        if (sent >= addressLimit.limit) {
          res.status(429).json({ error: `that's ${addressLimit.limit} today — thanks! Send more tomorrow.` });
          return;
        }
      }
      const suggestion: SuggestionRecord = { id: randomUUID(), at: t, ...checked.value, address: s?.address ?? null, status: "new" };
      await getStore().add(suggestion);
      if (s) void record(s.address, "suggestion").catch(() => {});
      res.status(201).json({ ok: true, id: suggestion.id });
    } catch (err) {
      console.error("[/api/suggestions] send failed:", err);
      res.status(500).json({ error: "couldn't save that — try again in a moment" });
    }
  });

  // ── The owner's inbox ──────────────────────────────────────────────────────
  r.get("/", async (req, res) => {
    if (!owner(req, res)) return;
    const raw = Number(req.query.limit ?? INBOX_DEFAULT);
    const limit = Number.isInteger(raw) ? Math.min(INBOX_MAX, Math.max(1, raw)) : INBOX_DEFAULT;
    try {
      const [list, newCount] = await Promise.all([getStore().list(limit), getStore().countNew()]);
      const senders = [...new Set(list.map((x) => x.address).filter((a): a is string => a !== null))];
      // A name lookup that fails costs the names, not the inbox.
      const names = senders.length ? await namesFor(senders).catch(() => new Map<string, string>()) : new Map<string, string>();
      const items: InboxItem[] = list.map((x) => ({ ...x, name: x.address ? names.get(x.address) ?? null : null }));
      const page: InboxPage = { items, newCount };
      res.json(page);
    } catch (err) {
      console.error("[/api/suggestions] inbox failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.get("/count", async (req, res) => {
    if (!owner(req, res)) return;
    try {
      res.json({ new: await getStore().countNew() });
    } catch (err) {
      console.error("[/api/suggestions/count] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.patch("/:id", (req, res, next) => {
    if (!owner(req, res)) return;
    if (!req.is("application/json")) { res.status(415).json({ error: "send JSON" }); return; }
    next();
  }, express.json({ limit: "1kb" }), async (req, res) => {
    const status = (req.body as { status?: unknown } | null)?.status;
    if (!isStatus(status)) { res.status(400).json({ error: "status must be new, read or done" }); return; }
    try {
      if (!(await getStore().setStatus(req.params.id, status))) { res.status(404).json({ error: "no such suggestion" }); return; }
      res.json({ ok: true, newCount: await getStore().countNew() });
    } catch (err) {
      console.error("[/api/suggestions/:id] update failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.delete("/:id", async (req, res) => {
    if (!owner(req, res)) return;
    try {
      if (!(await getStore().remove(req.params.id))) { res.status(404).json({ error: "no such suggestion" }); return; }
      res.json({ ok: true, newCount: await getStore().countNew() });
    } catch (err) {
      console.error("[/api/suggestions/:id] delete failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.use((_req, res) => { res.status(404).json({ error: "not found" }); });
  // A body that is not JSON, or too big, gets a JSON answer rather than Express's HTML page.
  r.use((err: { type?: string; status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      res.status(err.status ?? 400).set("Cache-Control", "no-store")
        .json({ error: err.type === "entity.too.large" ? "that's too long to send" : "bad JSON" });
      return;
    }
    next(err);
  });
  return r;
}
