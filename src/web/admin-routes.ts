/**
 * The owner's dashboard numbers, for the Admin window (src/shell/apps/admin.ts).
 *
 *   GET /api/admin/stats   overview, users, badges, traffic — src/admin/stats.ts
 *
 * Owner-only on every route: no session → 401, anyone else → 403. Never cached.
 *
 * Reads each feature's own store. Local file stores are read fresh on every
 * request (the feature's router keeps its own copy in memory and rewrites the
 * file on each change, so a copy made once here would go stale); database-backed
 * ones are made once.
 */
import express from "express";
import { getSession, type Session } from "../services/auth.js";
import { isAdmin as isOwnerSession } from "./pages/admin.js";
import { buildAdminStats, type AdminSources } from "../admin/stats.js";
import { isOwnerAddress } from "../activity/owner.js";
import { sharedActivityStore } from "../activity/store.js";
import { profilesFor } from "../profile/names.js";
import { getWizardOrders } from "../services/wizard-orders.js";
import { getTrafficSummary } from "../services/traffic.js";
import { createChatStore } from "../chat/store.js";
import { createSuggestionStore } from "../suggestions/store.js";
import { createGameStore } from "../game/store.js";

export interface AdminRouterOptions {
  session?: (req: express.Request) => Session | null;
  /** Is this session the owner's. */
  isAdmin?: (session: Session | null) => boolean;
  /** Where the numbers come from (tests). */
  sources?: () => AdminSources;
}

/** A store read fresh each time when it's a local file; made once otherwise. */
function fresh<T extends { kind: string }>(make: () => T): () => T {
  let kept: T | null = null;
  return () => {
    if (kept) return kept;
    const s = make();
    if (s.kind !== "file") kept = s;
    return s;
  };
}

/** Order-log answers change rarely; one lookup per wallet per few minutes is plenty. */
const ORDERS_MS = 5 * 60_000;
const orderCache = new Map<string, { at: number; v: Array<{ status: string; placedAt: number }> }>();

export function defaultAdminSources(): AdminSources {
  const chat = fresh(() => createChatStore());
  const suggestions = fresh(() => createSuggestionStore());
  const game = fresh(() => createGameStore());
  return {
    activity: () => sharedActivityStore().all(5_000),
    stampEarned: (address, stamps) => sharedActivityStore().stampEarned(address, stamps),
    profiles: (addresses) => profilesFor(addresses),
    orders: async (address) => {
      const hit = orderCache.get(address);
      if (hit && Date.now() - hit.at < ORDERS_MS) return hit.v;
      const v = (await getWizardOrders(address, 100)).map((o) => ({ status: o.status, placedAt: o.placedAt }));
      if (orderCache.size > 5_000) orderCache.clear();
      orderCache.set(address, { at: Date.now(), v });
      return v;
    },
    chatRecent: async () => (await chat().list(null, 2_000)).map((m) => ({ address: m.address, at: m.at })),
    chatTotal: () => chat().latestId(),
    suggestions: async () => (await suggestions().list(1_000)).map((s) => ({ at: s.at, status: s.status })),
    runs: async (since) => {
      const b = await game().leaderboard(since, 1);
      return { totalRuns: b.totalRuns, players: b.players };
    },
    traffic: () => getTrafficSummary(30),
    isOwner: isOwnerAddress,
    now: Date.now,
  };
}

export function adminRouter(opts: AdminRouterOptions = {}): express.Router {
  const session = opts.session ?? getSession;
  const isAdmin = opts.isAdmin ?? isOwnerSession;
  let sources: AdminSources | null = null;
  const getSources = (): AdminSources => (sources ??= (opts.sources ?? defaultAdminSources)());

  const r = express.Router();

  // Owner-only, all of it.
  r.use((req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    const s = session(req);
    if (!s) { res.status(401).json({ error: "sign in with the owner wallet" }); return; }
    if (!isAdmin(s)) { res.status(403).json({ error: "owner only" }); return; }
    next();
  });

  r.get("/stats", async (_req, res) => {
    try {
      res.json(await buildAdminStats(getSources()));
    } catch (err) {
      console.error("[/api/admin/stats] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.use((_req, res) => { res.status(404).json({ error: "not found" }); });
  return r;
}
