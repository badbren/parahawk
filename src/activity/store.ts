/**
 * Where site activity is kept.
 *
 * THE RULE (same as src/game/store.ts): only the deployed site writes to the
 * live database. Local runs use the production .env, so Supabase is used ONLY
 * when running on Vercel (`VERCEL` is set there and nowhere else); everywhere
 * else activity goes to a JSON file under data/, which is gitignored.
 *
 * In Postgres every write is one function call that locks the wallet's row, so
 * two pings from two tabs (or two serverless instances) can't both credit the
 * same minute.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, hasSupabase } from "../config.js";
import type { ActivityKind } from "./record.js";
import {
  MAX_CREDIT_S,
  MAX_GAP_S,
  applyEvent,
  applyPing,
  applyPoolAddress,
  type ActivityRecord,
} from "./rules.js";

export interface ActivityStore {
  readonly kind: "memory" | "file" | "supabase";
  /** A heartbeat from a signed-in desktop. `credited` = seconds it added. */
  ping(address: string, now: number): Promise<{ record: ActivityRecord; credited: number }>;
  /** Count one event of this kind. */
  bump(address: string, kind: ActivityKind, now: number): Promise<ActivityRecord>;
  get(address: string): Promise<ActivityRecord | null>;
  /** Many at once (Chat's badge chips): one read, however many addresses. Absent = no record. */
  getMany(addresses: readonly string[]): Promise<Map<string, ActivityRecord>>;
  /** Remember the address they mine to (null forgets it). */
  setPoolAddress(address: string, poolAddress: string | null, now: number): Promise<ActivityRecord>;
  /**
   * Add badge-earned times (src/activity/earned.ts). Times already stamped are
   * kept — the first stamp wins. Null when the wallet has no record.
   */
  stampEarned(address: string, stamps: Record<string, number>): Promise<ActivityRecord | null>;
  /** Every known wallet, most recently seen first, at most `limit` (the owner's dashboard). */
  all(limit: number): Promise<ActivityRecord[]>;
}

/** Activity held in memory — tests, and a deployed site with no database configured. */
export class MemoryActivityStore implements ActivityStore {
  readonly kind: "memory" | "file" = "memory";
  protected records = new Map<string, ActivityRecord>();

  async ping(address: string, now: number): Promise<{ record: ActivityRecord; credited: number }> {
    const out = applyPing(this.records.get(address) ?? null, address, now);
    this.records.set(address, out.record);
    this.changed();
    return { record: { ...out.record }, credited: out.credited };
  }
  async bump(address: string, kind: ActivityKind, now: number): Promise<ActivityRecord> {
    const rec = applyEvent(this.records.get(address) ?? null, address, kind, now);
    this.records.set(address, rec);
    this.changed();
    return { ...rec };
  }
  async get(address: string): Promise<ActivityRecord | null> {
    const rec = this.records.get(address);
    return rec ? { ...rec } : null;
  }
  async getMany(addresses: readonly string[]): Promise<Map<string, ActivityRecord>> {
    const out = new Map<string, ActivityRecord>();
    for (const a of addresses) {
      const rec = this.records.get(a);
      if (rec) out.set(a, { ...rec });
    }
    return out;
  }
  async setPoolAddress(address: string, poolAddress: string | null, now: number): Promise<ActivityRecord> {
    const rec = applyPoolAddress(this.records.get(address) ?? null, address, poolAddress, now);
    this.records.set(address, rec);
    this.changed();
    return { ...rec };
  }
  async stampEarned(address: string, stamps: Record<string, number>): Promise<ActivityRecord | null> {
    const rec = this.records.get(address);
    if (!rec) return null;
    const next: ActivityRecord = { ...rec, earnedAt: mergeStamps(rec.earnedAt, stamps) };
    this.records.set(address, next);
    this.changed();
    return { ...next, earnedAt: { ...next.earnedAt } };
  }
  async all(limit: number): Promise<ActivityRecord[]> {
    return [...this.records.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, Math.max(0, limit))
      .map((r) => ({ ...r, ...(r.earnedAt ? { earnedAt: { ...r.earnedAt } } : {}) }));
  }
  /** Hook for subclasses that persist. */
  protected changed(): void {}
}

/**
 * Activity in a JSON file — the local default. Read once, rewritten whole on
 * every change via a temp file + rename, so a crash mid-write never leaves half
 * a file.
 */
export class FileActivityStore extends MemoryActivityStore {
  override readonly kind = "file" as const;

  constructor(private readonly path: string) {
    super();
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { records?: unknown };
      if (raw.records && typeof raw.records === "object") {
        for (const [address, rec] of Object.entries(raw.records as Record<string, unknown>)) {
          const r = sanitize(address, rec);
          if (r) this.records.set(address, r);
        }
      }
    } catch {
      // No file yet, or an unreadable one: start empty, the next write replaces it.
    }
  }

  protected override changed(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ records: Object.fromEntries(this.records) }));
    renameSync(tmp, this.path);
  }
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** A record read back from the file, with anything malformed zeroed rather than trusted. */
function sanitize(address: string, raw: unknown): ActivityRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    address,
    firstSeen: n(r.firstSeen),
    lastSeen: n(r.lastSeen),
    lastPing: typeof r.lastPing === "number" ? r.lastPing : null,
    secondsOnSite: n(r.secondsOnSite),
    activeDays: n(r.activeDays),
    lastDay: typeof r.lastDay === "string" ? r.lastDay : null,
    selfSearches: n(r.selfSearches),
    walletSearches: n(r.walletSearches),
    chatMessages: n(r.chatMessages),
    suggestions: n(r.suggestions),
    poolAddress: typeof r.poolAddress === "string" ? r.poolAddress : null,
    earnedAt: earnedAtOf(r.earnedAt),
  };
}

/** Stamps already there win: a badge's earned time is the FIRST one recorded. */
export function mergeStamps(prev: Record<string, number> | null | undefined, stamps: Record<string, number>): Record<string, number> {
  return { ...stamps, ...(prev ?? {}) };
}

/** A stored earned-at map, with anything malformed dropped; null = never tracked. */
export function earnedAtOf(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(v as Record<string, unknown>)) {
    if (typeof at === "number" && Number.isFinite(at) && at >= 0) out[id] = at;
  }
  return out;
}

// ── Postgres (supabase/migrations/20261106000100_activity.sql) ───────────────

/** A Supabase error, surfaced — never swallowed into a quiet zero. */
export class ActivityStoreError extends Error {
  readonly code: string | undefined;
  constructor(what: string, err: { message: string; code?: string }) {
    super(`${what}: ${err.message}`);
    this.name = "ActivityStoreError";
    this.code = err.code;
  }
}

interface ActivityRow {
  address: string;
  first_seen: string;
  last_seen: string;
  last_ping: string | null;
  seconds_on_site: number | string;
  active_days: number;
  last_day: string | null;
  self_searches: number;
  wallet_searches: number;
  chat_messages: number;
  suggestions: number;
  pool_address: string | null;
  earned_at?: unknown;
  credited?: number;
}

const iso = (ms: number) => new Date(ms).toISOString();
const time = (v: string | null | undefined): number => (v ? Date.parse(v) || 0 : 0);

function fromRow(r: ActivityRow): ActivityRecord {
  return {
    address: r.address,
    firstSeen: time(r.first_seen),
    lastSeen: time(r.last_seen),
    lastPing: r.last_ping ? time(r.last_ping) : null,
    secondsOnSite: Number(r.seconds_on_site) || 0,
    activeDays: Number(r.active_days) || 0,
    lastDay: r.last_day,
    selfSearches: Number(r.self_searches) || 0,
    walletSearches: Number(r.wallet_searches) || 0,
    chatMessages: Number(r.chat_messages) || 0,
    suggestions: Number(r.suggestions) || 0,
    poolAddress: r.pool_address,
    earnedAt: earnedAtOf(r.earned_at),
  };
}

function rowOf(what: string, data: unknown): ActivityRow {
  if (!data || typeof data !== "object" || typeof (data as ActivityRow).address !== "string") {
    throw new ActivityStoreError(what, { message: `unexpected reply ${JSON.stringify(data)}` });
  }
  return data as ActivityRow;
}

/** The deployed site's store. Every write is one SQL function (the migration). */
export class SupabaseActivityStore implements ActivityStore {
  readonly kind = "supabase" as const;
  constructor(private readonly db: SupabaseClient) {}

  async ping(address: string, now: number): Promise<{ record: ActivityRecord; credited: number }> {
    const { data, error } = await this.db.rpc("parahawk_activity_ping", {
      p_address: address, p_now: iso(now), p_max_credit_s: MAX_CREDIT_S, p_max_gap_s: MAX_GAP_S,
    });
    if (error) throw new ActivityStoreError("parahawk_activity_ping", error);
    const row = rowOf("parahawk_activity_ping", data);
    return { record: fromRow(row), credited: Number(row.credited) || 0 };
  }

  async bump(address: string, kind: ActivityKind, now: number): Promise<ActivityRecord> {
    const { data, error } = await this.db.rpc("parahawk_activity_bump", { p_address: address, p_kind: kind, p_now: iso(now) });
    if (error) throw new ActivityStoreError("parahawk_activity_bump", error);
    return fromRow(rowOf("parahawk_activity_bump", data));
  }

  async get(address: string): Promise<ActivityRecord | null> {
    const { data, error } = await this.db.from("site_activity").select("*").eq("address", address).maybeSingle();
    if (error) throw new ActivityStoreError("site_activity select", error);
    return data ? fromRow(data as ActivityRow) : null;
  }

  async getMany(addresses: readonly string[]): Promise<Map<string, ActivityRecord>> {
    const out = new Map<string, ActivityRecord>();
    const list = [...new Set(addresses)];
    // One query per 200 — PostgREST puts the list in the URL.
    for (let i = 0; i < list.length; i += 200) {
      const { data, error } = await this.db.from("site_activity").select("*").in("address", list.slice(i, i + 200));
      if (error) throw new ActivityStoreError("site_activity select many", error);
      for (const row of (data ?? []) as ActivityRow[]) out.set(row.address, fromRow(row));
    }
    return out;
  }

  async setPoolAddress(address: string, poolAddress: string | null, now: number): Promise<ActivityRecord> {
    const { data, error } = await this.db.rpc("parahawk_activity_set_pool", { p_address: address, p_pool: poolAddress, p_now: iso(now) });
    if (error) throw new ActivityStoreError("parahawk_activity_set_pool", error);
    return fromRow(rowOf("parahawk_activity_set_pool", data));
  }

  async stampEarned(address: string, stamps: Record<string, number>): Promise<ActivityRecord | null> {
    // One statement, so two instances stamping at once both land (the first time wins).
    const { data, error } = await this.db.rpc("parahawk_activity_stamp", { p_address: address, p_stamps: stamps });
    if (error) throw new ActivityStoreError("parahawk_activity_stamp", error);
    return data ? fromRow(rowOf("parahawk_activity_stamp", data)) : null;
  }

  async all(limit: number): Promise<ActivityRecord[]> {
    const { data, error } = await this.db.from("site_activity").select("*")
      .order("last_seen", { ascending: false }).limit(Math.max(0, Math.min(limit, 10_000)));
    if (error) throw new ActivityStoreError("site_activity select all", error);
    return ((data ?? []) as ActivityRow[]).map(fromRow);
  }
}

export interface ActivityStoreEnv {
  /** Set by Vercel on every deployment, and nowhere else. */
  VERCEL?: string;
  /** Override the local file (tests). */
  ACTIVITY_FILE?: string;
}

export interface ActivityStoreDeps {
  hasSupabase?: () => boolean;
  makeSupabase?: () => SupabaseClient;
}

/** Pick the store for this process. See THE RULE at the top of the file. */
export function createActivityStore(env: ActivityStoreEnv = process.env, deps: ActivityStoreDeps = {}): ActivityStore {
  if (env.VERCEL) {
    const has = deps.hasSupabase ?? hasSupabase;
    if (!has()) {
      console.warn("[activity] no Supabase configured on Vercel — Parahawk badges are in-memory only");
      return new MemoryActivityStore();
    }
    const make = deps.makeSupabase
      ?? (() => createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } }));
    return new SupabaseActivityStore(make());
  }
  return new FileActivityStore(env.ACTIVITY_FILE ?? resolve("data", "site-activity.json"));
}

/**
 * The process's one store. The router and recordActivity() must share it: two
 * file stores on one file would each rewrite it from their own copy.
 */
let shared: ActivityStore | null = null;
export function sharedActivityStore(): ActivityStore {
  return (shared ??= createActivityStore());
}
/** Swap the shared store (tests); null makes a fresh one on next use. */
export function useActivityStore(store: ActivityStore | null): void {
  shared = store;
}
