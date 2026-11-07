/**
 * Where Chat messages are kept.
 *
 * THE RULE (same as src/game/store.ts): only the deployed site writes to the
 * live database. Local runs use the production .env, so a local chat that
 * reached for Supabase would put test messages in the live room. Supabase is
 * used ONLY when running on Vercel (`VERCEL` is set there and nowhere else);
 * everywhere else messages go to a JSON file under data/, which is gitignored.
 * store.test.ts holds this line.
 *
 * Messages are an append-only log with increasing ids, so a reader asks for
 * "everything after the last id I have". Deleting only marks a message; reads
 * report recent deletions so open windows can drop them.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, hasSupabase } from "../config.js";

export interface ChatMessage {
  id: number;
  address: string;
  body: string;
  /** When the server accepted it (ms). */
  at: number;
  deleted: boolean;
}

export interface ChatStore {
  readonly kind: "memory" | "file" | "supabase";
  add(address: string, body: string, at: number): Promise<ChatMessage>;
  /**
   * Live messages, oldest first. With `after`, those with a higher id (the first
   * `limit` of them); without, the latest `limit`.
   */
  list(after: number | null, limit: number): Promise<ChatMessage[]>;
  get(id: number): Promise<ChatMessage | null>;
  /** Mark a message deleted. False when there was no such live message. */
  remove(id: number, by: string, at: number): Promise<boolean>;
  /** The highest id ever handed out (deleted or not), 0 when the room is empty. */
  latestId(): Promise<number>;
  /** Ids of deleted messages above `afterId` — the "drop these" list for open windows. */
  removedAfter(afterId: number): Promise<number[]>;
  /** Live messages above `after` NOT posted by `exclude` (null = count everyone's). */
  countAfter(after: number, exclude: string | null): Promise<number>;
  /** When this address posted at or after `since`, newest first, at most `limit` (the per-wallet limits). */
  postTimes(address: string, since: number, limit: number): Promise<number[]>;
}

/** Messages held in memory — tests, and a deployed site with no database configured. */
export class MemoryChatStore implements ChatStore {
  readonly kind: "memory" | "file" = "memory";
  protected messages: ChatMessage[] = [];
  protected nextId = 1;

  async add(address: string, body: string, at: number): Promise<ChatMessage> {
    const m: ChatMessage = { id: this.nextId++, address, body, at, deleted: false };
    this.messages.push(m);
    this.changed();
    return { ...m };
  }
  async list(after: number | null, limit: number): Promise<ChatMessage[]> {
    const live = this.messages.filter((m) => !m.deleted && (after === null || m.id > after));
    return (after === null ? live.slice(-limit) : live.slice(0, limit)).map((m) => ({ ...m }));
  }
  async get(id: number): Promise<ChatMessage | null> {
    const m = this.messages.find((x) => x.id === id);
    return m ? { ...m } : null;
  }
  async remove(id: number, _by?: string, _at?: number): Promise<boolean> {
    const m = this.messages.find((x) => x.id === id);
    if (!m || m.deleted) return false;
    m.deleted = true;
    this.changed();
    return true;
  }
  async latestId(): Promise<number> {
    return this.nextId - 1;
  }
  async removedAfter(afterId: number): Promise<number[]> {
    return this.messages.filter((m) => m.deleted && m.id > afterId).map((m) => m.id);
  }
  async countAfter(after: number, exclude: string | null): Promise<number> {
    return this.messages.filter((m) => !m.deleted && m.id > after && m.address !== exclude).length;
  }
  async postTimes(address: string, since: number, limit: number): Promise<number[]> {
    return this.messages
      .filter((m) => m.address === address && m.at >= since)
      .map((m) => m.at)
      .sort((a, b) => b - a)
      .slice(0, limit);
  }
  /** Hook for subclasses that persist. */
  protected changed(): void {}
}

/**
 * Messages in a JSON file — the local default. Read once, rewritten whole on
 * every change via a temp file + rename, so a crash mid-write never leaves half
 * a file. Bounded, oldest dropped first; a dev convenience, not an archive.
 */
export class FileChatStore extends MemoryChatStore {
  override readonly kind = "file" as const;

  constructor(private readonly path: string, private readonly maxMessages = 5_000) {
    super();
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { messages?: unknown; nextId?: unknown };
      if (Array.isArray(raw.messages)) this.messages = raw.messages as ChatMessage[];
      const top = this.messages.reduce((n, m) => Math.max(n, m.id), 0);
      this.nextId = Math.max(top + 1, typeof raw.nextId === "number" ? raw.nextId : 1);
    } catch {
      // No file yet, or an unreadable one: start empty, the next write replaces it.
    }
  }

  protected override changed(): void {
    if (this.messages.length > this.maxMessages) this.messages = this.messages.slice(-this.maxMessages);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ nextId: this.nextId, messages: this.messages }));
    renameSync(tmp, this.path);
  }
}

// ── Postgres (supabase/migrations/20261106000200_chat.sql) ───────────────────

const iso = (ms: number) => new Date(ms).toISOString();
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const time = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : 0) || 0;

/** A Supabase error, surfaced — never swallowed into a lost message or a quiet empty room. */
export class ChatStoreError extends Error {
  readonly code: string | undefined;
  constructor(what: string, err: { message: string; code?: string }) {
    super(`${what}: ${err.message}`);
    this.name = "ChatStoreError";
    this.code = err.code;
  }
}

interface Row { id: number | string; address: string; body: string; created_at: string; deleted?: boolean }
const COLS = "id, address, body, created_at, deleted";
const fromRow = (r: Row): ChatMessage => ({ id: num(r.id), address: r.address, body: r.body, at: time(r.created_at), deleted: r.deleted === true });

/** The deployed site's store: one table, plain queries. */
export class SupabaseChatStore implements ChatStore {
  readonly kind = "supabase" as const;
  constructor(private readonly db: SupabaseClient) {}

  async add(address: string, body: string, at: number): Promise<ChatMessage> {
    const { data, error } = await this.db.from("chat_messages").insert({ address, body, created_at: iso(at) }).select(COLS).single();
    if (error) throw new ChatStoreError("chat_messages insert", error);
    return fromRow(data as Row);
  }

  async list(after: number | null, limit: number): Promise<ChatMessage[]> {
    let q = this.db.from("chat_messages").select(COLS).eq("deleted", false);
    if (after !== null) q = q.gt("id", after);
    const { data, error } = await q.order("id", { ascending: after !== null }).limit(limit);
    if (error) throw new ChatStoreError("chat_messages select", error);
    const rows = ((data ?? []) as Row[]).map(fromRow);
    return after === null ? rows.reverse() : rows;
  }

  async get(id: number): Promise<ChatMessage | null> {
    const { data, error } = await this.db.from("chat_messages").select(COLS).eq("id", id).limit(1);
    if (error) throw new ChatStoreError("chat_messages select", error);
    const row = ((data ?? []) as Row[])[0];
    return row ? fromRow(row) : null;
  }

  async remove(id: number, by: string, at: number): Promise<boolean> {
    const { data, error } = await this.db.from("chat_messages")
      .update({ deleted: true, deleted_at: iso(at), deleted_by: by })
      .eq("id", id).eq("deleted", false).select("id");
    if (error) throw new ChatStoreError("chat_messages update", error);
    return ((data ?? []) as unknown[]).length > 0;
  }

  async latestId(): Promise<number> {
    const { data, error } = await this.db.from("chat_messages").select("id").order("id", { ascending: false }).limit(1);
    if (error) throw new ChatStoreError("chat_messages select", error);
    return num(((data ?? []) as Array<{ id: unknown }>)[0]?.id);
  }

  async removedAfter(afterId: number): Promise<number[]> {
    const { data, error } = await this.db.from("chat_messages").select("id").eq("deleted", true).gt("id", afterId).limit(500);
    if (error) throw new ChatStoreError("chat_messages select", error);
    return ((data ?? []) as Array<{ id: unknown }>).map((r) => num(r.id));
  }

  async countAfter(after: number, exclude: string | null): Promise<number> {
    let q = this.db.from("chat_messages").select("id", { count: "exact", head: true }).eq("deleted", false).gt("id", after);
    if (exclude !== null) q = q.neq("address", exclude);
    const { count, error } = await q;
    if (error) throw new ChatStoreError("chat_messages count", error);
    return count ?? 0;
  }

  async postTimes(address: string, since: number, limit: number): Promise<number[]> {
    const { data, error } = await this.db.from("chat_messages").select("created_at")
      .eq("address", address).gte("created_at", iso(since))
      .order("created_at", { ascending: false }).limit(limit);
    if (error) throw new ChatStoreError("chat_messages select", error);
    return ((data ?? []) as Array<{ created_at: string }>).map((r) => time(r.created_at));
  }
}

export interface ChatStoreEnv {
  /** Set by Vercel on every deployment, and nowhere else. */
  VERCEL?: string;
  /** Override the local file (tests). */
  CHAT_FILE?: string;
}

export interface ChatStoreDeps {
  hasSupabase?: () => boolean;
  makeSupabase?: () => SupabaseClient;
}

/** Pick the store for this process. See THE RULE at the top of the file. */
export function createChatStore(env: ChatStoreEnv = process.env, deps: ChatStoreDeps = {}): ChatStore {
  if (env.VERCEL) {
    const has = deps.hasSupabase ?? hasSupabase;
    if (!has()) {
      // A deployed room without a database forgets everything on every cold start. Say so.
      console.warn("[chat] no Supabase configured on Vercel — Chat is in-memory only");
      return new MemoryChatStore();
    }
    const make = deps.makeSupabase
      ?? (() => createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } }));
    return new SupabaseChatStore(make());
  }
  return new FileChatStore(env.CHAT_FILE ?? resolve("data", "chat.json"));
}
