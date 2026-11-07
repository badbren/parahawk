/**
 * Site activity + the Parahawk badges, for the Profile's Parahawk section.
 *
 *   POST /api/activity/ping              heartbeat from a visible, signed-in desktop (time on site)
 *   GET  /api/activity/me[?pool=bc1…]    your counters, badges, rentals and pool headline
 *   PUT  /api/activity/me/pool-address   { address: "bc1…" | null } — the address you mine to
 *   GET  /api/activity/public/:ref       someone else's public card (their profile window)
 *
 * Signed in = the server session (an Xverse BIP-322 sign-in). Time on site is
 * the server's own measurement (src/activity/rules.ts): a ping only credits the
 * time since the previous one, capped, so nothing the client sends can add time.
 *
 * Pool numbers are public (anyone can open /address/<addr>), so the address
 * they're shown for needn't be the signed-in one: the saved mining address
 * first, then the sign-in address if it's a bc1 address, then the ?pool= hint
 * (the wallet's other address, sent by the Profile).
 *
 * Someone else's card (/public/:ref) keeps their privacy (Profile → "show my
 * name next to my wallet" off): looked up by WALLET, a private person's card
 * shows only the wallet's pool numbers — no badges, no time on Parahawk — so it
 * looks like any wallet that never used the site and nothing on it ties back to
 * the name they chat under. Looked up by ~uid (their name, e.g. from Chat), it
 * shows their badges and time but never the wallet or its pool numbers.
 */
import express from "express";
import { getSession, type Session } from "../services/auth.js";
import { getWizardOrders, type WizardOrder } from "../services/wizard-orders.js";
import { getLinkedAccounts } from "../services/linked.js";
import { PARAHAWK_BADGES, evaluateBadges, type BadgeView } from "../activity/badges.js";
import { isOwnerAddress } from "../activity/owner.js";
import { stampAfterActivity } from "../activity/earned.js";
import { addressForRef } from "../profile/names.js";
import { getPoolHeadline, type PoolHeadline } from "../activity/pool.js";
import { countersOf, isPoolAddress, type ActivityCounters, type ActivityRecord } from "../activity/rules.js";
import { sharedActivityStore, type ActivityStore } from "../activity/store.js";

export interface ActivityRouterOptions {
  store?: ActivityStore;
  session?: (req: express.Request) => Session | null;
  now?: () => number;
  /** The wallet page's headline numbers for an address. */
  pool?: (address: string) => Promise<PoolHeadline>;
  /** Marketplace orders placed through Parahawk by this (signed-in) address. */
  rentals?: (address: string) => Promise<Array<Pick<WizardOrder, "status" | "placedAt">>>;
  /** Venues with a linked API key. */
  linkedVenues?: (address: string) => Promise<string[]>;
  /** Give up on slow pool numbers after this long; the rest of the answer still goes out. */
  poolTimeoutMs?: number;
  /** A profile link's ref (wallet or "~uid") → the wallet and whether they're private. */
  resolveRef?: (ref: string) => Promise<{ address: string; isPrivate: boolean } | null>;
  /** The owner's wallet holds every badge. */
  isOwner?: (address: string) => boolean;
}

export interface ActivityMe {
  address: string;
  counters: ActivityCounters;
  badges: BadgeView[];
  earned: number;
  stats: {
    rentals: { count: number; lastAt: number | null } | null;
    linkedVenues: string[] | null;
    /** The address the pool numbers are for, and whether they saved it themselves. */
    poolAddress: string | null;
    poolAddressSaved: boolean;
    pool: PoolHeadline | null;
    poolError: string | null;
  };
}

/** An earned badge as someone else sees it — no progress numbers. */
export interface PublicBadge {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  perk?: string;
}

/** Someone else's public card. See the privacy note at the top. */
export interface ActivityPublic {
  ref: string;
  /** The wallet — only when they were looked up by it (or aren't private). */
  address: string | null;
  /** Looked up by ~uid and they keep their wallet private. */
  isPrivate: boolean;
  /** The site owner — holds every Parahawk badge. */
  owner: boolean;
  /** Their time on Parahawk; null when there's none to show. Hours are rounded. */
  activity: { memberSince: number | null; daysActive: number; hoursOnSite: number } | null;
  /** Earned Parahawk badges in table order; null when there are none to show. */
  badges: PublicBadge[] | null;
  /** How many Parahawk badges there are in all. */
  total: number;
  /** The wallet page's headline numbers — only alongside the wallet. */
  pool: PoolHeadline | null;
  poolError: string | null;
}

/** A profile link's ref: "~" + an opaque id, or something shaped like a bitcoin address. */
export function isProfileRef(ref: string): boolean {
  return /^~[A-Za-z0-9_-]{4,64}$/.test(ref) || /^[A-Za-z0-9]{14,100}$/.test(ref);
}

/** bech32 is case-insensitive and stored lower-case; base58 is case-sensitive. */
const canonicalWallet = (a: string): string => (/^(bc1|tb1|bcrt1)/i.test(a) ? a.toLowerCase() : a);

/** Faster than this per address (per instance), a ping is acknowledged and dropped. */
export const MIN_PING_GAP_MS = 20_000;

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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const SIGN_IN = "sign in with Xverse to see your Parahawk stats";

export function activityRouter(opts: ActivityRouterOptions = {}): express.Router {
  const getStore = (): ActivityStore => opts.store ?? sharedActivityStore();
  const session = opts.session ?? getSession;
  const now = opts.now ?? Date.now;
  const pool = opts.pool ?? ((a: string) => getPoolHeadline(a, now()));
  const rentals = opts.rentals ?? ((a: string) => getWizardOrders(a, 100));
  const linkedVenues = opts.linkedVenues ?? (async (a: string) => (await getLinkedAccounts(a)).map((l) => l.venue));
  const poolTimeoutMs = opts.poolTimeoutMs ?? 8_000;
  const resolveRef = opts.resolveRef ?? addressForRef;
  const isOwner = opts.isOwner ?? isOwnerAddress;
  /** Last accepted ping per address — a soft cap only; correctness lives in the store. */
  const lastPing = new Map<string, number>();

  const r = express.Router();
  const smallJson = express.json({ limit: "2kb" });

  /** The whole /me answer, from the record we already have. */
  const meFor = async (s: Session, rec: ActivityRecord | null, hint: string | null): Promise<ActivityMe> => {
    const saved = rec?.poolAddress ?? null;
    const poolAddress = saved ?? (isPoolAddress(s.address) ? s.address : null) ?? (hint && isPoolAddress(hint) ? hint : null);

    const [orders, venues, poolResult] = await Promise.all([
      rentals(s.address).catch(() => null),
      linkedVenues(s.address).catch(() => null),
      poolAddress
        ? withTimeout(pool(poolAddress), poolTimeoutMs).then(
            (v) => ({ v, err: null as string | null }),
            (e: Error) => {
              if (e.message !== "timeout") console.error("[/api/activity/me] pool numbers failed:", e.message);
              return { v: null, err: e.message === "timeout" ? "Pool numbers are slow right now — try again in a minute." : "Couldn't load pool numbers right now." };
            },
          )
        : Promise.resolve({ v: null, err: null }),
    ]);

    // A dry run never reached a venue, so it isn't a rental.
    const real = orders?.filter((o) => o.status !== "dryrun") ?? null;
    const counters = countersOf(rec);
    const badges = evaluateBadges({ counters, rentals: real?.length ?? 0, firstSeen: rec?.firstSeen ?? null, now: now(), owner: isOwner(s.address) });
    return {
      address: s.address,
      counters,
      badges,
      earned: badges.filter((b) => b.earned).length,
      stats: {
        rentals: real ? { count: real.length, lastAt: real.reduce<number | null>((m, o) => (m === null || o.placedAt > m ? o.placedAt : m), null) } : null,
        linkedVenues: venues,
        poolAddress,
        poolAddressSaved: saved !== null,
        pool: poolResult.v,
        poolError: poolResult.err,
      },
    };
  };

  r.post("/ping", smallJson, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!sameOrigin(req)) { res.status(403).json({ error: "cross-site request refused" }); return; }
    const s = session(req);
    if (!s) { res.status(401).json({ error: SIGN_IN }); return; }
    const t = now();
    if (t - (lastPing.get(s.address) ?? -Infinity) < MIN_PING_GAP_MS) { res.json({ ok: true, skipped: true }); return; }
    lastPing.set(s.address, t);
    if (lastPing.size > 10_000) lastPing.clear();
    try {
      const { record, credited } = await getStore().ping(s.address, t);
      // An hour on site or a new day can earn a badge: note when (never throws).
      await stampAfterActivity(getStore(), record, t, isOwner);
      res.json({ ok: true, credited, secondsOnSite: record.secondsOnSite });
    } catch (err) {
      console.error("[/api/activity/ping] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.get("/me", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const s = session(req);
    if (!s) { res.status(401).json({ error: SIGN_IN }); return; }
    const hint = typeof req.query.pool === "string" ? req.query.pool.trim() : null;
    try {
      res.json(await meFor(s, await getStore().get(s.address), hint));
    } catch (err) {
      console.error("[/api/activity/me] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.put("/me/pool-address", smallJson, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!sameOrigin(req)) { res.status(403).json({ error: "cross-site request refused" }); return; }
    if (!req.is("application/json")) { res.status(415).json({ error: "send JSON" }); return; }
    const s = session(req);
    if (!s) { res.status(401).json({ error: SIGN_IN }); return; }
    const raw = (req.body as { address?: unknown } | null)?.address;
    const cleared = raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
    const address = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!cleared && !isPoolAddress(address)) {
      res.status(400).json({ error: "That isn't a valid bc1 address — check for a typo and paste the full address you mine to." });
      return;
    }
    try {
      const rec = await getStore().setPoolAddress(s.address, cleared ? null : address, now());
      res.json(await meFor(s, rec, null));
    } catch (err) {
      console.error("[/api/activity/me/pool-address] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  /** Pool numbers within the time limit, or a short reason why not. */
  const poolFor = (address: string) =>
    withTimeout(pool(address), poolTimeoutMs).then(
      (v) => ({ v, err: null as string | null }),
      (e: Error) => {
        if (e.message !== "timeout") console.error("[/api/activity/public] pool numbers failed:", e.message);
        return { v: null, err: e.message === "timeout" ? "Pool numbers are slow right now — try again in a minute." : "Couldn't load pool numbers right now." };
      },
    );

  const publicFor = async (ref: string): Promise<ActivityPublic | null> => {
    const byUid = ref.startsWith("~");
    const found = await resolveRef(ref).catch(() => null);
    // A wallet with no Parahawk profile still has a card: its pool numbers.
    if (!found && byUid) return null;
    const address = found ? found.address : canonicalWallet(ref);
    const isPrivate = found?.isPrivate === true;
    // Never the wallet next to a private person's name, nor their name's badges next to their wallet.
    const showWallet = !byUid || !isPrivate;
    const showActivity = byUid || !isPrivate;
    const owner = isOwner(address);

    const [rec, orders, poolResult] = await Promise.all([
      showActivity ? getStore().get(address) : Promise.resolve(null),
      showActivity ? rentals(address).catch(() => null) : Promise.resolve(null),
      showWallet && isPoolAddress(address) ? poolFor(address) : Promise.resolve({ v: null, err: null as string | null }),
    ]);

    let badges: PublicBadge[] | null = null;
    let activity: ActivityPublic["activity"] = null;
    if (showActivity) {
      const counters = countersOf(rec);
      const real = orders?.filter((o) => o.status !== "dryrun").length ?? 0;
      const earned = evaluateBadges({ counters, rentals: real, firstSeen: rec?.firstSeen ?? null, now: now(), owner })
        .filter((b) => b.earned)
        .map((b) => ({ id: b.id, emoji: b.emoji, name: b.name, desc: b.desc, ...(b.perk ? { perk: b.perk } : {}) }));
      badges = earned.length > 0 ? earned : null;
      activity = rec
        ? { memberSince: rec.firstSeen > 0 ? rec.firstSeen : null, daysActive: counters.activeDays, hoursOnSite: Math.round(counters.secondsOnSite / 3_600) }
        : null;
    }
    return {
      ref,
      address: showWallet ? address : null,
      isPrivate: byUid && isPrivate,
      owner,
      activity,
      badges,
      total: PARAHAWK_BADGES.length,
      pool: poolResult.v,
      poolError: poolResult.err,
    };
  };

  r.get("/public/:ref", async (req, res) => {
    const ref = String(req.params.ref ?? "").trim();
    if (!isProfileRef(ref)) { res.status(400).set("Cache-Control", "no-store").json({ error: "not a profile link" }); return; }
    try {
      const card = await publicFor(ref);
      if (!card) { res.status(404).set("Cache-Control", "no-store").json({ error: "no such profile" }); return; }
      // Nothing per-viewer in it, so it can be shared briefly.
      res.set("Cache-Control", "public, max-age=30, s-maxage=30, stale-while-revalidate=60");
      res.json(card);
    } catch (err) {
      console.error("[/api/activity/public] failed:", err);
      res.status(500).set("Cache-Control", "no-store").json({ error: "internal error" });
    }
  });

  r.use((_req, res) => { res.status(404).json({ error: "not found" }); });
  // A body that is not JSON, or too big, gets a JSON answer rather than Express's HTML page.
  r.use((err: { type?: string; status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      res.status(err.status ?? 400).json({ error: err.type === "entity.too.large" ? "too big" : "bad JSON" });
      return;
    }
    next(err);
  });
  return r;
}
