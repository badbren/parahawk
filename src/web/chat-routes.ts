/**
 * Chat API — one shared room on the desktop.
 *
 *   GET    /api/chat/messages     ?after=<id>&limit=50 — newer than `after`, or the latest page
 *   GET    /api/chat/unread       ?after=<id> — how many others have posted since (the icon badge)
 *   POST   /api/chat/messages     { body } — signed-in wallets only
 *   DELETE /api/chat/messages/:id — the author, or the owner
 *
 * Anyone can read; posting needs the server session (the Xverse sign-in), so
 * every message is from an address that proved itself. Who wrote what is looked
 * up at READ time, once per response for all the authors in it: their profile
 * (name, picture, privacy — src/profile/names.ts), then their badges — Parasite
 * Pool's first, Parahawk's after (src/activity/pool-badges.ts). So a rename or a
 * new picture shows on old messages too.
 * Reads are never cached: the room changes every few seconds.
 *
 * PRIVACY: someone who turned privacy on in Profile never has their wallet
 * shown next to their name. Each author has a `ref`: the wallet address for
 * everyone else, "~<uid>" for private people — a private person's address
 * appears nowhere in a reply. Pool badges belong to the wallet, so a private
 * person never shows them either (they would tie the name to the wallet). When
 * the profile lookup fails outright we can't tell who is private, so everyone
 * gets an anonymous tag, and no pool badges, until it's back.
 *
 * Where messages live is src/chat/store.ts's call (never the live database
 * when running locally).
 */
import { createHash, randomBytes } from "node:crypto";
import express from "express";
import { getSession, type Session } from "../services/auth.js";
import { isAdmin as ownerCheck } from "./pages/admin.js";
// Strict: if profiles can't be read, Chat must not guess "nobody is private".
import { profilesForStrict as lookupProfiles, shortAddress, type ProfileRef } from "../profile/names.js";
import type { BadgeChip } from "../activity/public.js";
import { nameBadgesFor } from "../activity/pool-badges.js";
import { recordActivity } from "../activity/record.js";
import {
  CHAT_BURST_MAX,
  CHAT_BURST_WINDOW_MS,
  CHAT_COOLDOWN_MS,
  CHAT_MAX_PAGE,
  CHAT_PAGE,
  CHAT_REMOVED_WINDOW,
  cleanBody,
} from "../chat/rules.js";
import { createChatStore, type ChatMessage, type ChatStore } from "../chat/store.js";

export interface ChatRouterOptions {
  store?: ChatStore;
  session?: (req: express.Request) => Session | null;
  isAdmin?: (session: Session | null) => boolean;
  now?: () => number;
  /** Profiles (name, privacy, uid, picture) for the authors that have one. */
  profilesFor?: (addresses: readonly string[]) => Promise<Map<string, ProfileRef>>;
  /**
   * Badge chips per author, Parasite Pool's first then Parahawk's. `showPool`
   * says whose pool badges may show (not a private person's).
   */
  badgesFor?: (addresses: readonly string[], showPool: (address: string) => boolean) => Promise<Map<string, BadgeChip[]>>;
  /** Told about every accepted post, for the Parahawk badges. Fire-and-forget. */
  onPost?: (address: string) => Promise<void> | void;
}

/** What a reader gets for one message. Who wrote it is in the reply's `authors`, under `ref`. */
export interface WireMessage {
  id: number;
  /** The author's key in `authors` (see WireAuthor.ref). */
  ref: string;
  body: string;
  at: number;
}

/** One author, sent once per reply however many of their messages it carries. */
export interface WireAuthor {
  /**
   * Their profile link (/u/<ref>): the wallet address, or "~<uid>" when they
   * keep their wallet private. "?<tag>" (not a link) when we couldn't tell.
   */
  ref: string;
  /** Their display name, the short address when they have none, or a stand-in when private. */
  name: string;
  /** True when `name` is a chosen display name. */
  named: boolean;
  /** Same-origin URL of their picture, or null. */
  avatarUrl: string | null;
  /** Badge chips, Parasite Pool's first, then Parahawk's (at most MAX_BADGES). */
  badges: WireBadge[];
  /** True when the reader wrote it — decided here; the client never compares addresses. */
  mine: boolean;
}

/** One badge chip as the window gets it. */
export interface WireBadge {
  id: string;
  emoji: string;
  name: string;
  /** "pool" = a Parasite Pool badge (shown first, a touch stronger); "parahawk" = one of ours. */
  kind: "pool" | "parahawk";
}

/** Badges sent per author: the window shows two and a "+N" (tooltip lists the rest). */
const MAX_BADGES = 16;
/** A private person who never picked a name. */
const ANON_NAME = "Anonymous";

/**
 * A tag for an author we can't safely name or link (the profile lookup failed,
 * or a private profile came back without a usable uid). Salted per process, so
 * it says nothing about the wallet; it only keeps one person's lines together.
 */
const TAG_SALT = randomBytes(16);
const anonTag = (address: string) => `?${createHash("sha256").update(TAG_SALT).update(address).digest("hex").slice(0, 10)}`;

/** A same-origin path (never protocol-relative, never another site). */
const localUrl = (u: unknown): string | null =>
  typeof u === "string" && u.startsWith("/") && !u.startsWith("//") && !u.startsWith("/\\") ? u : null;

/**
 * How one address appears in Chat. Pure, so the privacy rule is tested on its
 * own: a private person, or anyone when the lookup failed, never gets their
 * address into the result.
 */
export function authorFor(address: string, profile: ProfileRef | undefined, lookupFailed: boolean, badges: readonly BadgeChip[], mine: boolean): WireAuthor {
  // Pool badges are the wallet's: never next to a private person's name, nor anyone's when we can't tell.
  const poolOk = !lookupFailed && profile?.isPrivate !== true;
  const chips = badges
    .filter((b) => poolOk || b.kind !== "pool")
    .slice(0, MAX_BADGES)
    .map((b): WireBadge => ({ id: b.id, emoji: b.emoji, name: b.name, kind: b.kind === "pool" ? "pool" : "parahawk" }));
  if (lookupFailed) return { ref: anonTag(address), name: "Someone", named: false, avatarUrl: null, badges: chips, mine };
  if (!profile) return { ref: address, name: shortAddress(address), named: false, avatarUrl: null, badges: chips, mine };
  const avatar = localUrl(profile.avatarUrl);
  if (profile.isPrivate) {
    // Belt and braces: a uid or picture URL that would spell out the wallet is not used.
    const uid = typeof profile.uid === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(profile.uid) && !address.includes(profile.uid) && !profile.uid.includes(address)
      ? profile.uid
      : null;
    return {
      ref: uid ? `~${uid}` : anonTag(address),
      name: profile.name ?? ANON_NAME,
      named: profile.name != null,
      avatarUrl: avatar && !avatar.includes(address) ? avatar : null,
      badges: chips,
      mine,
    };
  }
  return { ref: address, name: profile.name ?? shortAddress(address), named: profile.name != null, avatarUrl: avatar, badges: chips, mine };
}

/** Cross-site requests are refused outright; same-origin fetches (or an absent / "null" Origin under no-referrer) pass. */
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

const wait = (res: express.Response, ms: number, error: string) => {
  res.set("Retry-After", String(Math.max(1, Math.ceil(ms / 1000)))).status(429).json({ error });
};

/** A non-negative integer query value, or null when absent / not one. */
function intParam(v: unknown): number | null {
  if (typeof v !== "string" || !/^\d{1,15}$/.test(v)) return null;
  return Number(v);
}

export function chatRouter(opts: ChatRouterOptions = {}): express.Router {
  let store = opts.store ?? null;
  const getStore = (): ChatStore => (store ??= createChatStore());
  const session = opts.session ?? getSession;
  const isAdmin = opts.isAdmin ?? ownerCheck;
  const now = opts.now ?? Date.now;
  const profilesFor = opts.profilesFor ?? lookupProfiles;
  const badgesFor = opts.badgesFor ?? nameBadgesFor;
  const onPost = opts.onPost ?? ((address: string) => recordActivity(address, "chat_message"));
  /** Last accepted post per address. A soft cap only (one per instance); the store check is the real one. */
  const lastPost = new Map<string, number>();

  const r = express.Router();
  const smallJson = express.json({ limit: "8kb" });

  /**
   * A batch of messages as `viewer` sees them, plus one entry per author: one
   * profiles lookup, then one badges lookup (it needs to know who is private),
   * for the whole batch. Neither outage takes the room down — no badges, or
   * (profiles) anonymous tags and no pool badges for everyone.
   */
  const toWire = async (messages: ChatMessage[], viewer: Session | null): Promise<{ messages: WireMessage[]; authors: Record<string, WireAuthor> }> => {
    const addresses = [...new Set(messages.map((m) => m.address))];
    let profiles = new Map<string, ProfileRef>();
    let badges = new Map<string, BadgeChip[]>();
    let lookupFailed = false;
    if (addresses.length > 0) {
      const [p] = await Promise.allSettled([profilesFor(addresses)]);
      if (p.status === "fulfilled" && p.value instanceof Map) profiles = p.value;
      else { lookupFailed = true; console.error("[/api/chat] profile lookup failed:", p.status === "rejected" ? p.reason : "not a Map"); }
      const showPool = (address: string) => !lookupFailed && profiles.get(address)?.isPrivate !== true;
      const [b] = await Promise.allSettled([badgesFor(addresses, showPool)]);
      if (b.status === "fulfilled" && b.value instanceof Map) badges = b.value;
      else console.error("[/api/chat] badge lookup failed:", b.status === "rejected" ? b.reason : "not a Map");
    }
    const refOf = new Map<string, string>();
    const authors: Record<string, WireAuthor> = {};
    for (const address of addresses) {
      const a = authorFor(address, profiles.get(address), lookupFailed, badges.get(address) ?? [], viewer?.address === address);
      refOf.set(address, a.ref);
      authors[a.ref] = a;
    }
    return { messages: messages.map((m) => ({ id: m.id, ref: refOf.get(m.address)!, body: m.body, at: m.at })), authors };
  };

  r.get("/messages", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const after = intParam(req.query.after);
    const rawLimit = intParam(req.query.limit);
    const limit = rawLimit === null ? CHAT_PAGE : Math.min(CHAT_MAX_PAGE, Math.max(1, rawLimit));
    try {
      const s = getStore();
      const [messages, latestId] = await Promise.all([s.list(after, limit), s.latestId()]);
      const removed = await s.removedAfter(Math.max(0, latestId - CHAT_REMOVED_WINDOW));
      const viewer = session(req);
      const wire = await toWire(messages, viewer);
      res.json({
        messages: wire.messages,
        authors: wire.authors,
        latestId,
        removed,
        // The reader's own address goes back to the reader only — it is theirs.
        viewer: { address: viewer?.address ?? null, admin: isAdmin(viewer) },
      });
    } catch (err) {
      console.error("[/api/chat/messages] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.get("/unread", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const after = intParam(req.query.after) ?? 0;
    try {
      const s = getStore();
      const viewer = session(req);
      const [latestId, count] = await Promise.all([s.latestId(), s.countAfter(after, viewer?.address ?? null)]);
      res.json({ latestId, count });
    } catch (err) {
      console.error("[/api/chat/unread] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.post("/messages", smallJson, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!sameOrigin(req)) { res.status(403).json({ error: "cross-site request refused" }); return; }
    if (!req.is("application/json")) { res.status(415).json({ error: "send JSON" }); return; }
    const s = session(req);
    if (!s) { res.status(401).json({ error: "Sign in with Xverse to chat." }); return; }

    const checked = cleanBody((req.body as { body?: unknown } | null)?.body);
    if (!checked.ok) { res.status(400).json({ error: checked.error }); return; }

    const t = now();
    const since = t - (lastPost.get(s.address) ?? 0);
    if (since < CHAT_COOLDOWN_MS) { wait(res, CHAT_COOLDOWN_MS - since, "Slow down a little."); return; }
    try {
      const st = getStore();
      // The store's view holds across serverless instances: newest first.
      const times = await st.postTimes(s.address, t - CHAT_BURST_WINDOW_MS, CHAT_BURST_MAX);
      const newest = times[0];
      if (newest !== undefined && t - newest < CHAT_COOLDOWN_MS) { wait(res, CHAT_COOLDOWN_MS - (t - newest), "Slow down a little."); return; }
      if (times.length >= CHAT_BURST_MAX) {
        const oldest = times[times.length - 1]!;
        const ms = oldest + CHAT_BURST_WINDOW_MS - t;
        wait(res, ms, `That's a lot of messages — try again in ${Math.max(1, Math.ceil(ms / 60_000))} min.`);
        return;
      }
      lastPost.set(s.address, t);
      const message = await st.add(s.address, checked.body, t);
      void Promise.resolve().then(() => onPost(s.address)).catch(() => {});
      const wire = await toWire([message], s);
      res.status(201).json({ ok: true, message: wire.messages[0], authors: wire.authors });
    } catch (err) {
      console.error("[/api/chat/messages POST] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.delete("/messages/:id", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!sameOrigin(req)) { res.status(403).json({ error: "cross-site request refused" }); return; }
    const s = session(req);
    if (!s) { res.status(401).json({ error: "Sign in with Xverse first." }); return; }
    const id = intParam(req.params.id);
    if (id === null) { res.status(404).json({ error: "no such message" }); return; }
    try {
      const st = getStore();
      const m = await st.get(id);
      if (!m || m.deleted) { res.status(404).json({ error: "no such message" }); return; }
      if (m.address !== s.address && !isAdmin(s)) { res.status(403).json({ error: "you can only delete your own messages" }); return; }
      await st.remove(id, s.address, now());
      res.json({ ok: true, id });
    } catch (err) {
      console.error("[/api/chat/messages DELETE] failed:", err);
      res.status(500).json({ error: "internal error" });
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
