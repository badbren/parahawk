/**
 * Profiles API: display name, privacy, profile picture, public profiles.
 *
 *   GET    /api/profile/me                 who you are (private, never cached):
 *                                           { address, displayName, isPrivate, uid, avatarUrl }
 *   PUT    /api/profile/me                 { displayName?: string | null, isPrivate?: boolean }
 *   PUT    /api/profile/me/avatar          { image: "data:image/webp;base64,…" } — set your picture
 *   DELETE /api/profile/me/avatar          remove it
 *   GET    /api/profile/avatar/:uid?v=     the picture itself
 *   GET    /api/profile/public/:ref        someone's public profile; ref = wallet address or ~uid
 *   GET    /api/profile/names?addresses=   up to 100, comma-separated → { names } — public names only
 *   DELETE /api/profile/names/:ref         owner only — reset someone's name (moderation)
 *   DELETE /api/profile/avatar/:ref        owner only — remove someone's picture (moderation)
 *
 * A profile belongs to the signed-in wallet: the server session an Xverse
 * sign-in (BIP-322) creates, src/services/auth.ts. The name rules are
 * src/profile/rules.ts, the picture rules src/profile/avatar.ts; "taken" is the
 * store's call (src/profile/store.ts), never the client's.
 *
 * Privacy: someone private never has their name and their wallet in the same
 * answer. Looked up by wallet, a private profile comes back without a name,
 * picture or uid; looked up by ~uid, without the wallet.
 */
import express from "express";
import { getSession, type Session } from "../services/auth.js";
import { isAdmin } from "./pages/admin.js";
import { checkName, looksLikeAddress, NAME_CHANGES_PER_DAY, canonicalAddress } from "../profile/rules.js";
import { NameTakenError, TooManyRenamesError, isUid, type ProfileRecord, type ProfileStore } from "../profile/store.js";
import { checkAvatar, decodeAvatarPayload } from "../profile/avatar.js";
import { avatarUrlOf, profileStore, publicNamesFor, rememberProfile } from "../profile/names.js";

export interface ProfileRouterOptions {
  /** Defaults to the process's store (src/profile/names.ts), which the name lookups also read. */
  store?: ProfileStore;
  session?: (req: express.Request) => Session | null;
  /** Who counts as the owner (reserved names, no limits, moderation). */
  isAdmin?: (session: Session | null) => boolean;
  now?: () => number;
}

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

const MAX_LOOKUP = 100;
/** Picture uploads per address per hour (soft: each serverless instance counts its own). */
const AVATAR_UPLOADS_PER_HOUR = 10;
const HOUR = 3_600_000;

/** What you see of yourself. */
const mine = (address: string, rec: ProfileRecord | null) => ({
  address,
  displayName: rec?.displayName ?? null,
  isPrivate: rec?.isPrivate ?? false,
  uid: rec?.uid ?? null,
  avatarUrl: rec ? avatarUrlOf(rec) : null,
});

export function profileRouter(opts: ProfileRouterOptions = {}): express.Router {
  const given = opts.store;
  const getStore = (): ProfileStore => given ?? profileStore();
  const session = opts.session ?? getSession;
  const owner = opts.isAdmin ?? isAdmin;
  const now = opts.now ?? Date.now;
  /** A router given its own store (tests) answers name lookups from it; otherwise the shared, cached path. */
  const publicNames = given
    ? async (a: readonly string[]) => {
        const out = new Map<string, string>();
        for (const [raw, rec] of await given.refsFor(a)) if (rec.displayName && !rec.isPrivate) out.set(raw, rec.displayName);
        return out;
      }
    : publicNamesFor;
  /** Remember a saved profile for the shared lookups (not needed with a test store). */
  const remember = (rec: ProfileRecord) => { if (!given) rememberProfile(rec); };
  const isOwnerAddress = (address: string) => owner({ address, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER });
  /** Address → recent picture uploads (timestamps). */
  const uploads = new Map<string, number[]>();

  const r = express.Router();
  const smallJson = express.json({ limit: "2kb" });
  // A 48 KB picture is ~64 KB of base64, plus the data: prefix and the JSON around it.
  const pictureJson = express.json({ limit: "80kb" });

  /** Shared gate for writes: no caching, same origin, signed in. */
  const gate = (req: express.Request, res: express.Response, signInFor = "set up a profile"): Session | null => {
    res.set("Cache-Control", "no-store");
    if (!sameOrigin(req)) { res.status(403).json({ error: "cross-site request refused" }); return null; }
    const s = session(req);
    if (!s) { res.status(401).json({ error: `Sign in with Xverse to ${signInFor}.` }); return null; }
    return s;
  };

  /** A moderation target: "~uid" or a wallet address → the stored profile's address, or null. */
  const resolveTarget = async (ref: string): Promise<string | null> => {
    if (ref.startsWith("~")) {
      const uid = ref.slice(1);
      if (!isUid(uid)) return null;
      return (await getStore().byUid(uid))?.address ?? null;
    }
    return looksLikeAddress(ref) ? canonicalAddress(ref) : null;
  };

  r.get("/me", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const s = session(req);
    if (!s) { res.json({ address: null, displayName: null, isPrivate: false, uid: null, avatarUrl: null }); return; }
    try {
      res.json(mine(s.address, await getStore().get(s.address)));
    } catch (err) {
      console.error("[/api/profile/me] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.put("/me", smallJson, async (req, res) => {
    const s = gate(req, res, "set a display name");
    if (!s) return;
    if (!req.is("application/json")) { res.status(415).json({ error: "send JSON" }); return; }
    const body = req.body as Record<string, unknown> | null;
    const hasName = typeof body === "object" && body !== null && !Array.isArray(body) && "displayName" in body;
    const hasPrivacy = typeof body === "object" && body !== null && !Array.isArray(body) && "isPrivate" in body;
    if (!hasName && !hasPrivacy) {
      res.status(400).json({ error: "Send { displayName } — a name, or null to clear it — and/or { isPrivate }." });
      return;
    }
    if (hasPrivacy && typeof body!.isPrivate !== "boolean") { res.status(400).json({ error: "isPrivate is true or false." }); return; }
    const admin = owner(s);
    let name: string | null = null;
    if (hasName && body!.displayName !== null) {
      const checked = checkName(body!.displayName, { admin });
      if (!checked.ok) { res.status(400).json({ error: checked.error }); return; }
      name = checked.name;
    }
    try {
      const store = getStore();
      if (hasName) await store.setName(s.address, name, { now: now(), dailyLimit: admin ? Infinity : NAME_CHANGES_PER_DAY });
      if (hasPrivacy) await store.setPrivate(s.address, body!.isPrivate as boolean, now());
      // Report what is stored (a no-op write on a new address saves nothing).
      const saved = await store.get(s.address);
      if (saved) remember(saved);
      res.json(mine(s.address, saved));
    } catch (err) {
      if (err instanceof NameTakenError) { res.status(409).json({ error: err.message }); return; }
      if (err instanceof TooManyRenamesError) { res.status(429).json({ error: err.message }); return; }
      console.error("[/api/profile/me PUT] failed:", err);
      res.status(500).json({ error: "Couldn't save that. Try again in a minute." });
    }
  });

  r.put("/me/avatar", pictureJson, async (req, res) => {
    const s = gate(req, res, "add a profile picture");
    if (!s) return;
    if (!req.is("application/json")) { res.status(415).json({ error: "send JSON" }); return; }
    const t = now();
    if (!owner(s)) {
      const key = canonicalAddress(s.address);
      const recent = (uploads.get(key) ?? []).filter((at) => t - at < HOUR);
      if (recent.length >= AVATAR_UPLOADS_PER_HOUR) {
        uploads.set(key, recent);
        res.set("Retry-After", String(Math.ceil((HOUR - (t - recent[0]!)) / 1000)));
        res.status(429).json({ error: "That's a lot of new pictures. Try again in a bit." });
        return;
      }
      recent.push(t);
      uploads.set(key, recent);
      if (uploads.size > 5_000) uploads.clear();
    }
    const checked = checkAvatar(decodeAvatarPayload((req.body as { image?: unknown } | null)?.image));
    if (!checked.ok) { res.status(400).json({ error: checked.error }); return; }
    try {
      const rec = await getStore().setAvatar(s.address, { type: checked.type, bytes: checked.bytes }, t);
      remember(rec);
      res.json(mine(s.address, rec));
    } catch (err) {
      console.error("[/api/profile/me/avatar PUT] failed:", err);
      res.status(500).json({ error: "Couldn't save that picture. Try again in a minute." });
    }
  });

  r.delete("/me/avatar", async (req, res) => {
    const s = gate(req, res, "change your profile picture");
    if (!s) return;
    try {
      const store = getStore();
      await store.setAvatar(s.address, null, now());
      const saved = await store.get(s.address);
      if (saved) remember(saved);
      res.json(mine(s.address, saved));
    } catch (err) {
      console.error("[/api/profile/me/avatar DELETE] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.get("/avatar/:uid", async (req, res) => {
    const uid = String(req.params.uid ?? "");
    if (!isUid(uid)) { res.status(404).set("Cache-Control", "no-store").json({ error: "no picture" }); return; }
    try {
      const blob = await getStore().getAvatar(uid);
      if (!blob) { res.status(404).set("Cache-Control", "public, max-age=60").json({ error: "no picture" }); return; }
      // A versioned URL never changes (a new picture gets a new version), so it can be cached for good.
      const versioned = req.query.v === blob.version;
      res.set({
        "Content-Type": blob.type,
        "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=60",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      });
      res.send(Buffer.from(blob.bytes));
    } catch (err) {
      console.error("[/api/profile/avatar] failed:", err);
      res.status(500).set("Cache-Control", "no-store").json({ error: "internal error" });
    }
  });

  r.get("/public/:ref", async (req, res) => {
    const ref = String(req.params.ref ?? "").trim();
    try {
      if (ref.startsWith("~")) {
        const uid = ref.slice(1);
        const rec = isUid(uid) ? await getStore().byUid(uid) : null;
        if (!rec) { res.status(404).set("Cache-Control", "public, max-age=30").json({ error: "No profile here." }); return; }
        res.set("Cache-Control", "public, max-age=30, s-maxage=30");
        // By uid: the name and picture, and the wallet only when they let it show.
        res.json({
          ref, uid: rec.uid, name: rec.displayName, avatarUrl: avatarUrlOf(rec), isPrivate: rec.isPrivate,
          address: rec.isPrivate ? null : rec.address,
          isOwner: !rec.isPrivate && isOwnerAddress(rec.address),
        });
        return;
      }
      if (!looksLikeAddress(ref)) { res.status(400).json({ error: "That isn't a wallet address." }); return; }
      const rec = await getStore().get(ref);
      const open = rec != null && !rec.isPrivate;
      res.set("Cache-Control", "public, max-age=30, s-maxage=30");
      // By wallet: never the name, picture or uid of someone private.
      res.json({
        ref, uid: open ? rec.uid : null, name: open ? rec.displayName : null, avatarUrl: open ? avatarUrlOf(rec) : null,
        isPrivate: rec?.isPrivate ?? false, address: canonicalAddress(ref),
        isOwner: !(rec?.isPrivate ?? false) && isOwnerAddress(ref),
      });
    } catch (err) {
      console.error("[/api/profile/public] failed:", err);
      res.status(500).set("Cache-Control", "no-store").json({ error: "internal error" });
    }
  });

  r.get("/names", async (req, res) => {
    const raw = req.query.addresses;
    const joined = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.filter((x) => typeof x === "string").join(",") : "";
    const list = [...new Set(joined.split(",").map((a) => a.trim()).filter(Boolean))];
    if (list.length > MAX_LOOKUP) { res.status(400).json({ error: `${MAX_LOOKUP} addresses at most` }); return; }
    if (!list.every(looksLikeAddress)) { res.status(400).json({ error: "those don't look like wallet addresses" }); return; }
    try {
      // Wallet → name, so only people who haven't turned privacy on.
      const names = list.length ? await publicNames(list) : new Map<string, string>();
      res.set("Cache-Control", "public, max-age=30, s-maxage=30, stale-while-revalidate=60");
      res.json({ names: Object.fromEntries(names) });
    } catch (err) {
      console.error("[/api/profile/names] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.delete("/names/:ref", async (req, res) => {
    const s = gate(req, res, "moderate");
    if (!s) return;
    if (!owner(s)) { res.status(403).json({ error: "owner only" }); return; }
    try {
      const target = await resolveTarget(req.params.ref.trim());
      if (!target) { res.status(400).json({ error: "not a profile" }); return; }
      const store = getStore();
      await store.setName(target, null, { now: now(), dailyLimit: Infinity });
      const saved = await store.get(target);
      if (saved) remember(saved);
      res.json({ ok: true, displayName: null });
    } catch (err) {
      console.error("[/api/profile/names DELETE] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.delete("/avatar/:ref", async (req, res) => {
    const s = gate(req, res, "moderate");
    if (!s) return;
    if (!owner(s)) { res.status(403).json({ error: "owner only" }); return; }
    try {
      const target = await resolveTarget(req.params.ref.trim());
      if (!target) { res.status(400).json({ error: "not a profile" }); return; }
      const store = getStore();
      await store.setAvatar(target, null, now());
      const saved = await store.get(target);
      if (saved) remember(saved);
      res.json({ ok: true, avatarUrl: null });
    } catch (err) {
      console.error("[/api/profile/avatar DELETE] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.use((_req, res) => { res.status(404).json({ error: "not found" }); });
  // A body that is not JSON, or too big, gets a JSON answer rather than Express's HTML page.
  r.use((err: { type?: string; status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
      res.status(err.status ?? 400).json({ error: err.type === "entity.too.large" ? "That's too big." : "bad JSON" });
      return;
    }
    next(err);
  });
  return r;
}
