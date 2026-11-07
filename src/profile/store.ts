/**
 * Where profiles are kept: display name, privacy, profile picture.
 *
 * THE RULE (same as src/game/store.ts): only the deployed site writes to the
 * live database. Local runs use the production .env, so a local store that
 * reached for Supabase would rename people on the live site. Supabase is used
 * ONLY when running on Vercel (`VERCEL` is set there and nowhere else);
 * everywhere else profiles go to data/profiles.json (gitignored); tests use memory.
 *
 * "That name is taken" is the store's answer, not a cache's: the site runs as
 * many short-lived serverless instances, so uniqueness is a unique index on
 * name_key in Postgres (supabase/migrations/20261106000000_profiles.sql).
 *
 * Every profile has a uid: a random id that never changes, so a link to
 * someone private (/u/~<uid>) never spells out their wallet.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, hasSupabase } from "../config.js";
import type { AvatarType } from "./avatar.js";
import { canonicalAddress, nameKey } from "./rules.js";

export interface ProfileRecord {
  /** Canonical spelling (rules.ts canonicalAddress). */
  address: string;
  /** Random, permanent, never derived from the address: 12 hex characters. */
  uid: string;
  displayName: string | null;
  /** Privacy on: their name is never shown next to their wallet, nor their wallet next to their name. */
  isPrivate: boolean;
  avatarType: AvatarType | null;
  /** Changes whenever the picture does (a hash of it); part of its URL. Null = no picture. */
  avatarVersion: string | null;
  updatedAt: number;
  /** The UTC day ("2026-11-06") the rename counter belongs to. */
  changesDay: string | null;
  /** Renames on changesDay. */
  changesToday: number;
}

/** A stored picture. */
export interface AvatarBlob {
  type: AvatarType;
  bytes: Uint8Array;
  version: string;
}

export class NameTakenError extends Error {
  constructor() {
    super("That name is taken.");
    this.name = "NameTakenError";
  }
}

export class TooManyRenamesError extends Error {
  constructor() {
    super("That's a lot of renames for one day. Try again tomorrow.");
    this.name = "TooManyRenamesError";
  }
}

/** A Supabase error, surfaced rather than swallowed. */
export class ProfileStoreError extends Error {
  readonly code: string | undefined;
  constructor(what: string, err: { message: string; code?: string }) {
    super(`${what}: ${err.message}`);
    this.name = "ProfileStoreError";
    this.code = err.code;
  }
}

export interface SetNameOptions {
  now: number;
  /** Renames allowed per UTC day; Infinity for the owner. */
  dailyLimit: number;
}

export interface ProfileStore {
  readonly kind: "memory" | "file" | "supabase";
  get(address: string): Promise<ProfileRecord | null>;
  /** The profile with this uid, or null. */
  byUid(uid: string): Promise<ProfileRecord | null>;
  /**
   * Give an address a name, or clear it with null. Throws NameTakenError when
   * another address holds the same name key and TooManyRenamesError past the
   * daily limit. Setting the exact name it already has changes nothing and
   * doesn't count.
   */
  setName(address: string, name: string | null, opts: SetNameOptions): Promise<ProfileRecord>;
  /** Turn privacy on or off. Doesn't count as a rename. */
  setPrivate(address: string, isPrivate: boolean, now: number): Promise<ProfileRecord>;
  /** Store a picture (already checked: src/profile/avatar.ts), or remove it with null. */
  setAvatar(address: string, avatar: { type: AvatarType; bytes: Uint8Array } | null, now: number): Promise<ProfileRecord>;
  /** The picture behind a uid, or null. */
  getAvatar(uid: string): Promise<AvatarBlob | null>;
  /** Names for these addresses, keyed by the spelling passed in. Addresses without one are absent. */
  namesFor(addresses: readonly string[]): Promise<Map<string, string>>;
  /** Profiles for these addresses, keyed by the spelling passed in. Addresses without one are absent. */
  refsFor(addresses: readonly string[]): Promise<Map<string, ProfileRecord>>;
}

export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A new uid: 48 random bits as 12 hex characters (the same shape as the SQL default). */
export const newUid = (): string => randomBytes(6).toString("hex");
export const isUid = (s: string): boolean => /^[0-9a-f]{12}$/.test(s);
/** A picture's version: the start of its SHA-256, so the same picture keeps the same URL. */
export const avatarVersionOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 12);

const blank = (address: string, now: number): ProfileRecord => ({
  address, uid: newUid(), displayName: null, isPrivate: false, avatarType: null, avatarVersion: null,
  updatedAt: now, changesDay: null, changesToday: 0,
});

/** Renames already used today, or throw when that's the limit. */
function renamesUsed(cur: ProfileRecord | null, opts: SetNameOptions): number {
  const used = cur && cur.changesDay === utcDay(opts.now) ? cur.changesToday : 0;
  if (used >= opts.dailyLimit) throw new TooManyRenamesError();
  return used;
}

const copy = (r: ProfileRecord): ProfileRecord => ({ ...r });

/** Profiles held in memory — tests, and a deployed site with no database configured. */
export class MemoryProfileStore implements ProfileStore {
  readonly kind: "memory" | "file" = "memory";
  /** Canonical address → record. */
  protected rows = new Map<string, ProfileRecord>();
  /** Canonical address → picture bytes. */
  protected pictures = new Map<string, Uint8Array>();

  async get(address: string): Promise<ProfileRecord | null> {
    const r = this.rows.get(canonicalAddress(address));
    return r ? copy(r) : null;
  }

  async byUid(uid: string): Promise<ProfileRecord | null> {
    for (const r of this.rows.values()) if (r.uid === uid) return copy(r);
    return null;
  }

  async setName(address: string, name: string | null, opts: SetNameOptions): Promise<ProfileRecord> {
    const a = canonicalAddress(address);
    const cur = this.rows.get(a) ?? null;
    if ((cur?.displayName ?? null) === name) return cur ? copy(cur) : blank(a, opts.now);
    const used = renamesUsed(cur, opts);
    if (name !== null) {
      const key = nameKey(name);
      for (const [other, r] of this.rows) {
        if (other !== a && r.displayName !== null && nameKey(r.displayName) === key) throw new NameTakenError();
      }
    }
    const next: ProfileRecord = {
      ...(cur ?? blank(a, opts.now)),
      displayName: name, updatedAt: opts.now, changesDay: utcDay(opts.now), changesToday: used + 1,
    };
    this.rows.set(a, next);
    this.changed();
    return copy(next);
  }

  async setPrivate(address: string, isPrivate: boolean, now: number): Promise<ProfileRecord> {
    const a = canonicalAddress(address);
    const cur = this.rows.get(a) ?? null;
    if (cur && cur.isPrivate === isPrivate) return copy(cur);
    const next: ProfileRecord = { ...(cur ?? blank(a, now)), isPrivate, updatedAt: now };
    this.rows.set(a, next);
    this.changed();
    return copy(next);
  }

  async setAvatar(address: string, avatar: { type: AvatarType; bytes: Uint8Array } | null, now: number): Promise<ProfileRecord> {
    const a = canonicalAddress(address);
    const cur = this.rows.get(a) ?? null;
    if (!avatar && !cur?.avatarVersion) return cur ? copy(cur) : blank(a, now);
    const next: ProfileRecord = {
      ...(cur ?? blank(a, now)),
      avatarType: avatar?.type ?? null,
      avatarVersion: avatar ? avatarVersionOf(avatar.bytes) : null,
      updatedAt: now,
    };
    if (avatar) this.pictures.set(a, Uint8Array.from(avatar.bytes)); else this.pictures.delete(a);
    this.rows.set(a, next);
    this.changed();
    return copy(next);
  }

  async getAvatar(uid: string): Promise<AvatarBlob | null> {
    for (const r of this.rows.values()) {
      if (r.uid !== uid) continue;
      const bytes = this.pictures.get(r.address);
      return bytes && r.avatarType && r.avatarVersion ? { type: r.avatarType, bytes: Uint8Array.from(bytes), version: r.avatarVersion } : null;
    }
    return null;
  }

  async namesFor(addresses: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const raw of addresses) {
      const name = this.rows.get(canonicalAddress(raw))?.displayName;
      if (name) out.set(raw, name);
    }
    return out;
  }

  async refsFor(addresses: readonly string[]): Promise<Map<string, ProfileRecord>> {
    const out = new Map<string, ProfileRecord>();
    for (const raw of addresses) {
      const r = this.rows.get(canonicalAddress(raw));
      if (r) out.set(raw, copy(r));
    }
    return out;
  }

  /** Hook for subclasses that persist. */
  protected changed(): void {}
}

const AVATAR_TYPES = new Set<AvatarType>(["image/png", "image/jpeg", "image/webp"]);

/**
 * Profiles in a JSON file — the local default. Read once, rewritten whole on
 * every change via a temp file + rename, so a crash mid-write never leaves half
 * a file. Pictures ride along as base64.
 */
export class FileProfileStore extends MemoryProfileStore {
  override readonly kind = "file" as const;

  constructor(private readonly path: string) {
    super();
    let backfilled = false;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { profiles?: unknown };
      if (Array.isArray(raw.profiles)) {
        for (const p of raw.profiles as Array<Partial<ProfileRecord> & { avatarB64?: unknown }>) {
          if (typeof p?.address !== "string") continue;
          const a = canonicalAddress(p.address);
          const hasUid = typeof p.uid === "string" && isUid(p.uid);
          if (!hasUid) backfilled = true;
          const type = typeof p.avatarType === "string" && AVATAR_TYPES.has(p.avatarType as AvatarType) ? (p.avatarType as AvatarType) : null;
          const bytes = type && typeof p.avatarB64 === "string" ? Uint8Array.from(Buffer.from(p.avatarB64, "base64")) : null;
          this.rows.set(a, {
            address: a,
            uid: hasUid ? (p.uid as string) : newUid(),
            displayName: typeof p.displayName === "string" ? p.displayName : null,
            isPrivate: p.isPrivate === true,
            avatarType: bytes ? type : null,
            avatarVersion: bytes ? avatarVersionOf(bytes) : null,
            updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : 0,
            changesDay: typeof p.changesDay === "string" ? p.changesDay : null,
            changesToday: typeof p.changesToday === "number" ? p.changesToday : 0,
          });
          if (bytes) this.pictures.set(a, bytes);
        }
      }
    } catch {
      // No file yet, or an unreadable one: start empty, the next write replaces it.
    }
    // Profiles saved before uids existed get one now, written once so it sticks.
    if (backfilled) this.changed();
  }

  protected override changed(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    const profiles = [...this.rows.values()].map((r) => {
      const bytes = this.pictures.get(r.address);
      return bytes ? { ...r, avatarB64: Buffer.from(bytes).toString("base64") } : r;
    });
    writeFileSync(tmp, JSON.stringify({ profiles }));
    renameSync(tmp, this.path);
  }
}

// ── Postgres (supabase/migrations/20261106000000_profiles.sql) ───────────────

interface ProfileRow {
  address: string;
  uid?: string | null;
  display_name?: string | null;
  is_private?: boolean | null;
  avatar_type?: string | null;
  avatar_ver?: string | null;
  updated_at?: string | null;
  changes_day?: string | null;
  changes_today?: number | null;
}

/** Every column but the picture itself (avatar_b64 is only read by getAvatar). */
const COLS = "address, uid, display_name, is_private, avatar_type, avatar_ver, updated_at, changes_day, changes_today";

const fromRow = (r: ProfileRow): ProfileRecord => {
  const type = typeof r.avatar_type === "string" && AVATAR_TYPES.has(r.avatar_type as AvatarType) ? (r.avatar_type as AvatarType) : null;
  return {
    address: r.address,
    uid: r.uid ?? "",
    displayName: r.display_name ?? null,
    isPrivate: r.is_private === true,
    avatarType: type && r.avatar_ver ? type : null,
    avatarVersion: type && r.avatar_ver ? r.avatar_ver : null,
    updatedAt: r.updated_at ? Date.parse(r.updated_at) || 0 : 0,
    changesDay: r.changes_day ?? null,
    changesToday: Number(r.changes_today ?? 0) || 0,
  };
};

/** PostgREST puts the address list in the URL, so big lookups go in slices. */
const LOOKUP_SLICE = 50;

/** The deployed site's store. */
export class SupabaseProfileStore implements ProfileStore {
  readonly kind = "supabase" as const;
  constructor(private readonly db: SupabaseClient) {}

  async get(address: string): Promise<ProfileRecord | null> {
    const { data, error } = await this.db.from("site_profiles").select(COLS)
      .eq("address", canonicalAddress(address))
      .maybeSingle();
    if (error) throw new ProfileStoreError("site_profiles select", error);
    return data ? fromRow(data as ProfileRow) : null;
  }

  async byUid(uid: string): Promise<ProfileRecord | null> {
    if (!isUid(uid)) return null;
    const { data, error } = await this.db.from("site_profiles").select(COLS).eq("uid", uid).maybeSingle();
    if (error) throw new ProfileStoreError("site_profiles by uid", error);
    return data ? fromRow(data as ProfileRow) : null;
  }

  /**
   * Upsert some columns of one row. Only the columns sent change (PostgREST
   * merges duplicates), so a rename never touches the picture and vice versa.
   * A brand-new row also gets its uid here.
   */
  private async write(cur: ProfileRecord | null, a: string, cols: Omit<ProfileRow, "address"> & Record<string, unknown>): Promise<ProfileRecord> {
    const base = cur ?? blank(a, Date.now());
    const row = { address: a, ...(cur ? {} : { uid: base.uid }), ...cols };
    const { error } = await this.db.from("site_profiles").upsert(row, { onConflict: "address" });
    // 23505 = unique_violation: someone else holds this name key.
    if (error?.code === "23505") throw new NameTakenError();
    if (error) throw new ProfileStoreError("site_profiles upsert", error);
    return { ...base, ...fromRow({ ...toRow(base), ...row } as ProfileRow) };
  }

  async setName(address: string, name: string | null, opts: SetNameOptions): Promise<ProfileRecord> {
    const a = canonicalAddress(address);
    const cur = await this.get(a);
    if ((cur?.displayName ?? null) === name) return cur ?? blank(a, opts.now);
    const used = renamesUsed(cur, opts);
    return this.write(cur, a, {
      display_name: name,
      name_key: name === null ? null : nameKey(name),
      updated_at: new Date(opts.now).toISOString(),
      changes_day: utcDay(opts.now),
      changes_today: used + 1,
    });
  }

  async setPrivate(address: string, isPrivate: boolean, now: number): Promise<ProfileRecord> {
    const a = canonicalAddress(address);
    const cur = await this.get(a);
    if (cur && cur.isPrivate === isPrivate) return cur;
    return this.write(cur, a, { is_private: isPrivate, updated_at: new Date(now).toISOString() });
  }

  async setAvatar(address: string, avatar: { type: AvatarType; bytes: Uint8Array } | null, now: number): Promise<ProfileRecord> {
    const a = canonicalAddress(address);
    const cur = await this.get(a);
    if (!avatar && !cur?.avatarVersion) return cur ?? blank(a, now);
    return this.write(cur, a, {
      avatar_type: avatar?.type ?? null,
      avatar_b64: avatar ? Buffer.from(avatar.bytes).toString("base64") : null,
      avatar_ver: avatar ? avatarVersionOf(avatar.bytes) : null,
      updated_at: new Date(now).toISOString(),
    });
  }

  async getAvatar(uid: string): Promise<AvatarBlob | null> {
    if (!isUid(uid)) return null;
    const { data, error } = await this.db.from("site_profiles").select("avatar_type, avatar_b64, avatar_ver").eq("uid", uid).maybeSingle();
    if (error) throw new ProfileStoreError("site_profiles avatar", error);
    const r = data as { avatar_type: string | null; avatar_b64: string | null; avatar_ver: string | null } | null;
    if (!r || !r.avatar_b64 || !r.avatar_ver || !r.avatar_type || !AVATAR_TYPES.has(r.avatar_type as AvatarType)) return null;
    return { type: r.avatar_type as AvatarType, bytes: Uint8Array.from(Buffer.from(r.avatar_b64, "base64")), version: r.avatar_ver };
  }

  /** Canonical spelling → the spellings the caller used for it. */
  private static spellings(addresses: readonly string[]): Map<string, string[]> {
    const spellings = new Map<string, string[]>();
    for (const raw of addresses) {
      const c = canonicalAddress(raw);
      const list = spellings.get(c);
      if (list) list.push(raw); else spellings.set(c, [raw]);
    }
    return spellings;
  }

  async namesFor(addresses: readonly string[]): Promise<Map<string, string>> {
    const spellings = SupabaseProfileStore.spellings(addresses);
    const out = new Map<string, string>();
    const all = [...spellings.keys()];
    for (let i = 0; i < all.length; i += LOOKUP_SLICE) {
      const { data, error } = await this.db.from("site_profiles")
        .select("address, display_name")
        .in("address", all.slice(i, i + LOOKUP_SLICE))
        .not("display_name", "is", null);
      if (error) throw new ProfileStoreError("site_profiles names", error);
      for (const r of (data ?? []) as Array<{ address: string; display_name: string | null }>) {
        if (!r.display_name) continue;
        for (const raw of spellings.get(r.address) ?? []) out.set(raw, r.display_name);
      }
    }
    return out;
  }

  async refsFor(addresses: readonly string[]): Promise<Map<string, ProfileRecord>> {
    const spellings = SupabaseProfileStore.spellings(addresses);
    const out = new Map<string, ProfileRecord>();
    const all = [...spellings.keys()];
    for (let i = 0; i < all.length; i += LOOKUP_SLICE) {
      const { data, error } = await this.db.from("site_profiles").select(COLS).in("address", all.slice(i, i + LOOKUP_SLICE));
      if (error) throw new ProfileStoreError("site_profiles refs", error);
      for (const r of (data ?? []) as ProfileRow[]) {
        const rec = fromRow(r);
        for (const raw of spellings.get(r.address) ?? []) out.set(raw, rec);
      }
    }
    return out;
  }
}

/** A record as a row (for merging a partial write over what we knew). */
function toRow(r: ProfileRecord): ProfileRow {
  return {
    address: r.address, uid: r.uid, display_name: r.displayName, is_private: r.isPrivate,
    avatar_type: r.avatarType, avatar_ver: r.avatarVersion,
    updated_at: new Date(r.updatedAt).toISOString(), changes_day: r.changesDay, changes_today: r.changesToday,
  };
}

export interface ProfileStoreEnv {
  /** Set by Vercel on every deployment, and nowhere else. */
  VERCEL?: string;
  /** Override the local file (tests). */
  PROFILES_FILE?: string;
}

export interface ProfileStoreDeps {
  hasSupabase?: () => boolean;
  makeSupabase?: () => SupabaseClient;
}

/** Pick the store for this process. See THE RULE at the top of the file. */
export function createProfileStore(env: ProfileStoreEnv = process.env, deps: ProfileStoreDeps = {}): ProfileStore {
  if (env.VERCEL) {
    const has = deps.hasSupabase ?? hasSupabase;
    if (!has()) {
      console.warn("[profile] no Supabase configured on Vercel — profiles are in-memory only");
      return new MemoryProfileStore();
    }
    const make = deps.makeSupabase
      ?? (() => createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } }));
    return new SupabaseProfileStore(make());
  }
  return new FileProfileStore(env.PROFILES_FILE ?? resolve("data", "profiles.json"));
}
