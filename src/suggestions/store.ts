/**
 * Where suggestions are kept.
 *
 * THE RULE (same as src/game/store.ts): only the deployed site writes to the
 * live database. Local runs use the production .env, so a local Suggestions
 * window that reached for Supabase would drop test notes into the owner's real
 * inbox. Supabase is used ONLY when running on Vercel (`VERCEL` is set there and
 * nowhere else); everywhere else suggestions go to a JSON file under data/,
 * which is gitignored. store.test.ts holds this line.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, hasSupabase } from "../config.js";
import { isStatus, type SuggestionRecord, type SuggestionStatus } from "./rules.js";

export interface SuggestionStore {
  readonly kind: "memory" | "file" | "supabase";
  add(s: SuggestionRecord): Promise<void>;
  /** Newest first, at most `limit`. */
  list(limit: number): Promise<SuggestionRecord[]>;
  /** How many are still "new". */
  countNew(): Promise<number>;
  /** How many this address sent at or after `since` (ms). */
  countFromSince(address: string, since: number): Promise<number>;
  /** False when there is no such suggestion. */
  setStatus(id: string, status: SuggestionStatus): Promise<boolean>;
  /** False when there is no such suggestion. */
  remove(id: string): Promise<boolean>;
}

/** Suggestions held in memory — tests, and a deployed site with no database configured. */
export class MemorySuggestionStore implements SuggestionStore {
  readonly kind: "memory" | "file" = "memory";
  protected items: SuggestionRecord[] = [];

  async add(s: SuggestionRecord): Promise<void> { this.items.push({ ...s }); this.changed(); }
  async list(limit: number): Promise<SuggestionRecord[]> {
    return this.items.slice().sort((a, b) => b.at - a.at).slice(0, Math.max(0, limit)).map((s) => ({ ...s }));
  }
  async countNew(): Promise<number> { return this.items.filter((s) => s.status === "new").length; }
  async countFromSince(address: string, since: number): Promise<number> {
    return this.items.filter((s) => s.address === address && s.at >= since).length;
  }
  async setStatus(id: string, status: SuggestionStatus): Promise<boolean> {
    const s = this.items.find((x) => x.id === id);
    if (!s) return false;
    if (s.status !== status) { s.status = status; this.changed(); }
    return true;
  }
  async remove(id: string): Promise<boolean> {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    this.changed();
    return true;
  }
  /** Hook for subclasses that persist. */
  protected changed(): void {}
}

const isRecord = (v: unknown): v is SuggestionRecord => {
  const s = v as Partial<SuggestionRecord> | null;
  return typeof s === "object" && s !== null && typeof s.id === "string" && typeof s.at === "number"
    && typeof s.title === "string" && typeof s.notes === "string"
    && (s.address === null || typeof s.address === "string") && isStatus(s.status);
};

/**
 * Suggestions in a JSON file — the local default. Read once, rewritten whole on
 * every change via a temp file + rename, so a crash mid-write never leaves half
 * a file. Bounded, oldest dropped first; this is a dev convenience, not an archive.
 */
export class FileSuggestionStore extends MemorySuggestionStore {
  override readonly kind = "file" as const;

  constructor(private readonly path: string, private readonly maxItems = 5_000) {
    super();
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { suggestions?: unknown };
      if (Array.isArray(raw.suggestions)) this.items = raw.suggestions.filter(isRecord);
    } catch {
      // No file yet, or an unreadable one: start empty, the next write replaces it.
    }
  }

  protected override changed(): void {
    if (this.items.length > this.maxItems) this.items = this.items.slice().sort((a, b) => b.at - a.at).slice(0, this.maxItems);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ suggestions: this.items }));
    renameSync(tmp, this.path);
  }
}

// ── Postgres (supabase/migrations/20261106000300_suggestions.sql) ────────────

/** A Supabase error, surfaced — never swallowed into a lost suggestion or a quietly empty inbox. */
export class SuggestionStoreError extends Error {
  readonly code: string | undefined;
  constructor(what: string, err: { message: string; code?: string }) {
    super(`${what}: ${err.message}`);
    this.name = "SuggestionStoreError";
    this.code = err.code;
  }
}

interface Row { id: string; created_at: string; title: string; notes: string; address: string | null; status: string }

const fromRow = (r: Row): SuggestionRecord => ({
  id: r.id,
  at: Date.parse(r.created_at) || 0,
  title: r.title,
  notes: r.notes,
  address: r.address ?? null,
  status: isStatus(r.status) ? r.status : "new",
});

/** The deployed site's store. */
export class SupabaseSuggestionStore implements SuggestionStore {
  readonly kind = "supabase" as const;
  constructor(private readonly db: SupabaseClient) {}

  async add(s: SuggestionRecord): Promise<void> {
    const { error } = await this.db.from("suggestions").insert({
      id: s.id, created_at: new Date(s.at).toISOString(), title: s.title, notes: s.notes, address: s.address, status: s.status,
    });
    if (error) throw new SuggestionStoreError("suggestions insert", error);
  }

  async list(limit: number): Promise<SuggestionRecord[]> {
    const { data, error } = await this.db.from("suggestions").select("id, created_at, title, notes, address, status")
      .order("created_at", { ascending: false }).limit(Math.max(1, limit));
    if (error) throw new SuggestionStoreError("suggestions select", error);
    return ((data ?? []) as Row[]).map(fromRow);
  }

  async countNew(): Promise<number> {
    const { count, error } = await this.db.from("suggestions").select("id", { count: "exact", head: true }).eq("status", "new");
    if (error) throw new SuggestionStoreError("suggestions count", error);
    return count ?? 0;
  }

  async countFromSince(address: string, since: number): Promise<number> {
    const { count, error } = await this.db.from("suggestions").select("id", { count: "exact", head: true })
      .eq("address", address).gte("created_at", new Date(since).toISOString());
    if (error) throw new SuggestionStoreError("suggestions count", error);
    return count ?? 0;
  }

  async setStatus(id: string, status: SuggestionStatus): Promise<boolean> {
    const { data, error } = await this.db.from("suggestions").update({ status }).eq("id", id).select("id");
    if (error) throw new SuggestionStoreError("suggestions update", error);
    return (data ?? []).length > 0;
  }

  async remove(id: string): Promise<boolean> {
    const { data, error } = await this.db.from("suggestions").delete().eq("id", id).select("id");
    if (error) throw new SuggestionStoreError("suggestions delete", error);
    return (data ?? []).length > 0;
  }
}

export interface SuggestionStoreEnv {
  /** Set by Vercel on every deployment, and nowhere else. */
  VERCEL?: string;
  /** Override the local file (tests). */
  SUGGESTIONS_FILE?: string;
}

export interface SuggestionStoreDeps {
  hasSupabase?: () => boolean;
  makeSupabase?: () => SupabaseClient;
}

/** Pick the store for this process. See THE RULE at the top of the file. */
export function createSuggestionStore(env: SuggestionStoreEnv = process.env, deps: SuggestionStoreDeps = {}): SuggestionStore {
  if (env.VERCEL) {
    const has = deps.hasSupabase ?? hasSupabase;
    if (!has()) {
      // A deployed inbox without a database loses every suggestion on a cold start. Say so.
      console.warn("[suggestions] no Supabase configured on Vercel — suggestions are in-memory only");
      return new MemorySuggestionStore();
    }
    const make = deps.makeSupabase
      ?? (() => createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } }));
    return new SupabaseSuggestionStore(make());
  }
  return new FileSuggestionStore(env.SUGGESTIONS_FILE ?? resolve("data", "suggestions.json"));
}
