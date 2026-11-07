/**
 * Profiles, read side — the one place the server asks "what is this address
 * called, and may we say so?" (Chat, Leaderboard, Suggestions, the Parahawk
 * pages, public profiles).
 *
 * Backed by the profile store (store.ts) with a short in-process cache, so a
 * busy Chat poll doesn't become a database query per message. A change shows
 * at once on the instance that saved it (rememberProfile) and within ~30 s on
 * the others. Lookups never throw: a name is a nicety, so on a database hiccup
 * the caller just shows the short address.
 *
 * Privacy: someone who turns it on keeps their name and their wallet apart.
 * publicNamesFor (names next to wallets) leaves them out; profilesFor says so,
 * so Chat can show their name without their wallet; addressForRef resolves a
 * private profile link (/u/~<uid>) without anyone else seeing the address.
 */
import { canonicalAddress, looksLikeAddress } from "./rules.js";
import { createProfileStore, isUid, type ProfileRecord, type ProfileStore } from "./store.js";

/** "bc1qxy…9fPq" — what to show when an address has no name. */
export function shortAddress(address: string): string {
  return address.length > 13 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

let store: ProfileStore | null = null;

/** The process's profile store, made on first use. */
export function profileStore(): ProfileStore {
  return (store ??= createProfileStore());
}

/** Swap the store (tests). Clears the cache. */
export function useProfileStore(next: ProfileStore | null): void {
  store = next;
  cache.clear();
}

const TTL_MS = 30_000;
const MAX_CACHED = 5_000;
/** Canonical address → its profile (null = looked up, has none) and when we looked. */
const cache = new Map<string, { rec: ProfileRecord | null; at: number }>();

/** A profile this instance just saved (rename, privacy, picture): show it here straight away. */
export function rememberProfile(rec: ProfileRecord, now = Date.now()): void {
  cache.set(canonicalAddress(rec.address), { rec: { ...rec }, at: now });
}

/** A rename this instance just saved. Prefer rememberProfile, which knows the whole profile. */
export function rememberName(address: string, name: string | null, now = Date.now()): void {
  const key = canonicalAddress(address);
  const hit = cache.get(key);
  if (hit?.rec) cache.set(key, { rec: { ...hit.rec, displayName: name }, at: now });
  else cache.delete(key); // not known here yet: look it up fresh next time
}

/** Where someone's picture is served, or null. The version makes a new picture a new URL. */
export const avatarUrlOf = (rec: Pick<ProfileRecord, "uid" | "avatarVersion">): string | null =>
  rec.avatarVersion && rec.uid ? `/api/profile/avatar/${rec.uid}?v=${rec.avatarVersion}` : null;

/** Profiles for these addresses (null = none), keyed by the spelling passed in. Never throws. */
/**
 * `strict`: when the store can't be read, throw instead of guessing "no profile".
 * A guess is fine for a name next to a wallet (it just goes missing), but it is
 * NOT fine where a private person could come back looking public (Chat).
 */
async function lookup(addresses: readonly string[], strict = false): Promise<Map<string, ProfileRecord | null>> {
  const out = new Map<string, ProfileRecord | null>();
  const now = Date.now();
  const misses: string[] = [];
  for (const raw of new Set(addresses)) {
    if (typeof raw !== "string" || raw === "") continue;
    const hit = cache.get(canonicalAddress(raw));
    if (hit && now - hit.at < TTL_MS) out.set(raw, hit.rec);
    else misses.push(raw);
  }
  if (misses.length === 0) return out;
  try {
    const found = await profileStore().refsFor(misses);
    if (cache.size > MAX_CACHED) cache.clear();
    for (const raw of misses) {
      const rec = found.get(raw) ?? null;
      cache.set(canonicalAddress(raw), { rec, at: now });
      out.set(raw, rec);
    }
  } catch (err) {
    console.warn("[profile] lookup failed:", (err as Error).message);
    // Better a profile from a minute ago than none — unless we have nothing for
    // someone and the caller can't afford a guess.
    for (const raw of misses) {
      const stale = cache.get(canonicalAddress(raw));
      if (!stale && strict) throw err;
      out.set(raw, stale?.rec ?? null);
    }
  }
  return out;
}

/**
 * Names for the addresses that have one, keyed by the spelling passed in —
 * private people included (Chat shows their name; it just never shows their
 * wallet). For names NEXT TO A WALLET use publicNamesFor.
 */
export async function displayNamesFor(addresses: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [raw, rec] of await lookup(addresses)) if (rec?.displayName) out.set(raw, rec.displayName);
  return out;
}

/** What a list needs about an address that has a Parahawk profile. */
export interface ProfileRef {
  /** Their display name, or null when they haven't set one. */
  name: string | null;
  /**
   * They turned privacy on: their name is never shown next to their wallet, and
   * their wallet is never shown next to their name.
   */
  isPrivate: boolean;
  /** Stable opaque id for links that must not reveal the wallet: /u/~<uid>. */
  uid: string;
  /** Same-origin URL of their profile picture, or null. */
  avatarUrl: string | null;
}

/** Profiles for the addresses that have one, keyed by the spelling passed in. Never throws. */
export async function profilesFor(addresses: readonly string[]): Promise<Map<string, ProfileRef>> {
  const out = new Map<string, ProfileRef>();
  for (const [raw, rec] of await lookup(addresses)) {
    if (rec) out.set(raw, { name: rec.displayName, isPrivate: rec.isPrivate, uid: rec.uid, avatarUrl: avatarUrlOf(rec) });
  }
  return out;
}

/**
 * profilesFor that fails CLOSED: throws when the store can't be read and some
 * address has no cached profile, so a private person can never come back
 * looking public. For Chat, which then shows everyone as an anonymous tag.
 */
export async function profilesForStrict(addresses: readonly string[]): Promise<Map<string, ProfileRef>> {
  const out = new Map<string, ProfileRef>();
  for (const [raw, rec] of await lookup(addresses, true)) {
    if (rec) out.set(raw, { name: rec.displayName, isPrivate: rec.isPrivate, uid: rec.uid, avatarUrl: avatarUrlOf(rec) });
  }
  return out;
}

/**
 * Names to show NEXT TO A WALLET — "bc1q…f96s (badbren)" across the Parahawk
 * pages and the Leaderboard: only people who haven't turned privacy on. Never throws.
 */
export async function publicNamesFor(addresses: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const [raw, rec] of await lookup(addresses)) if (rec?.displayName && !rec.isPrivate) out.set(raw, rec.displayName);
  return out;
}

/**
 * A profile link's ref → the wallet behind it. A ref is a wallet address, or
 * "~<uid>" for someone private. Null when it matches nobody (an unknown uid, or
 * something that isn't an address). Any well-formed address resolves, profile
 * or not — everyone's wallet has stats — with isPrivate from their profile.
 * Never throws.
 */
export async function addressForRef(ref: string): Promise<{ address: string; isPrivate: boolean } | null> {
  if (typeof ref !== "string" || ref === "") return null;
  if (ref.startsWith("~")) {
    const uid = ref.slice(1);
    if (!isUid(uid)) return null;
    try {
      const rec = await profileStore().byUid(uid);
      return rec ? { address: rec.address, isPrivate: rec.isPrivate } : null;
    } catch (err) {
      console.warn("[profile] uid lookup failed:", (err as Error).message);
      return null;
    }
  }
  const trimmed = ref.trim();
  if (!looksLikeAddress(trimmed)) return null;
  const rec = (await lookup([trimmed])).get(trimmed) ?? null;
  return { address: canonicalAddress(trimmed), isPrivate: rec?.isPrivate ?? false };
}
