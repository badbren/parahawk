/**
 * Where Block Hunt runs and burns are kept.
 *
 * THE RULE: only the deployed site writes to the live database. Local runs use
 * the production .env (so the stats pages have real data), which means a local
 * leaderboard that reached for Supabase would put test runs on the live board.
 * So Supabase is used ONLY when running on Vercel (`VERCEL` is set there and
 * nowhere else); everywhere else runs go to a JSON file under data/, which is
 * gitignored. store.test.ts holds this line.
 *
 * Correctness lives in the store, not in process memory, because the site runs
 * as many short-lived serverless instances: spending a ticket and recording
 * its run is ONE step (`recordRun`) — in Postgres a single function, so a
 * ticket is spent exactly once across every instance and a run is never lost
 * after its ticket is spent (both or neither). The leaderboard and stats are
 * aggregated where the rows are (SQL functions in the migration), so a big
 * board never ships its raw rows to the server.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TierId } from "../econ/tokenomics.js";
import { config, hasSupabase } from "../config.js";
import { aggregateBoard, aggregatePlayer, type BoardAggregate, type PlayerAggregate } from "./board.js";
import type { BurnRecord, RunRecord } from "./types.js";

/** A ticket being spent: its nonce, who it was dealt to, and when it stops mattering. */
export interface SpentTicket {
  nonce: string;
  address: string;
  expiresAt: number;
}

export interface GameStore {
  readonly kind: "memory" | "file" | "supabase";
  /**
   * Spend a ticket and record the run it was played on — both or neither.
   * False when the ticket had already been spent (nothing is recorded).
   */
  recordRun(ticket: SpentTicket, run: RunRecord, now: number): Promise<boolean>;
  addBurn(burn: BurnRecord): Promise<void>;
  /** When this address last finished a run, or null. */
  lastRunAt(address: string): Promise<number | null>;
  /** Best per address at or after `since` (all time when null), ranked, top `limit`. */
  leaderboard(since: number | null, limit: number): Promise<BoardAggregate>;
  /** One player's totals, all time. */
  playerStats(address: string): Promise<PlayerAggregate>;
}

/** Runs held in memory — tests, and a deployed site with no database configured. */
export class MemoryGameStore implements GameStore {
  readonly kind: "memory" | "file" = "memory";
  protected runs: RunRecord[] = [];
  protected burns: BurnRecord[] = [];
  /** Spent ticket nonce → when the ticket expires. */
  protected tickets = new Map<string, number>();

  async recordRun(ticket: SpentTicket, run: RunRecord, now: number): Promise<boolean> {
    // Spent nonces only need remembering until their ticket would have expired anyway.
    for (const [nonce, expiresAt] of this.tickets) if (expiresAt < now) this.tickets.delete(nonce);
    if (this.tickets.has(ticket.nonce)) return false;
    this.tickets.set(ticket.nonce, ticket.expiresAt);
    this.runs.push(run);
    this.changed();
    return true;
  }
  async addBurn(burn: BurnRecord): Promise<void> { this.burns.push(burn); this.changed(); }
  async lastRunAt(address: string): Promise<number | null> {
    let last: number | null = null;
    for (const r of this.runs) if (r.address === address && (last === null || r.at > last)) last = r.at;
    return last;
  }
  async leaderboard(since: number | null, limit: number): Promise<BoardAggregate> {
    return aggregateBoard(this.runs, since, limit);
  }
  async playerStats(address: string): Promise<PlayerAggregate> {
    return aggregatePlayer(this.runs.filter((r) => r.address === address), this.burns.filter((b) => b.address === address));
  }
  /** Hook for subclasses that persist. */
  protected changed(): void {}
}

/**
 * Runs in a JSON file — the local default. Read once, rewritten whole on every
 * change via a temp file + rename, so a crash mid-write never leaves half a file.
 * Bounded, oldest runs dropped first; this is a dev convenience, not an archive.
 */
export class FileGameStore extends MemoryGameStore {
  override readonly kind = "file" as const;

  constructor(private readonly path: string, private readonly maxRuns = 50_000) {
    super();
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { runs?: unknown; burns?: unknown; tickets?: unknown };
      if (Array.isArray(raw.runs)) this.runs = raw.runs as RunRecord[];
      if (Array.isArray(raw.burns)) this.burns = raw.burns as BurnRecord[];
      if (raw.tickets && typeof raw.tickets === "object") {
        for (const [nonce, exp] of Object.entries(raw.tickets as Record<string, unknown>)) {
          if (typeof exp === "number") this.tickets.set(nonce, exp);
        }
      }
    } catch {
      // No file yet, or an unreadable one: start empty, the next write replaces it.
    }
  }

  protected override changed(): void {
    if (this.runs.length > this.maxRuns) this.runs = this.runs.slice().sort((a, b) => b.at - a.at).slice(0, this.maxRuns);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ runs: this.runs, burns: this.burns, tickets: Object.fromEntries(this.tickets) }));
    renameSync(tmp, this.path);
  }
}

// ── Postgres (supabase/migrations/20261022000000_game_runs.sql) ──────────────

const iso = (ms: number) => new Date(ms).toISOString();
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const time = (v: unknown): number | null => (typeof v === "string" ? Date.parse(v) : null);

/** A Supabase error, surfaced — never swallowed into a dropped run or a quiet empty board. */
export class GameStoreError extends Error {
  /** The Postgres/PostgREST error code, when there is one. */
  readonly code: string | undefined;
  constructor(what: string, err: { message: string; code?: string }) {
    super(`${what}: ${err.message}`);
    this.name = "GameStoreError";
    this.code = err.code;
  }
}

interface BoardRow {
  address: string; best: number; best_at: string; runs: number; wins: number; whites_won: number;
  players: number; total_runs: number;
}
interface StatsRow { runs: number; wins: number; best: number; whites_won: number; first_at: string | null; last_at: string | null }
interface BurnStepRow { from_tier: string; to_tier: string; burns: number }

/** The deployed site's store. Every write and aggregate is a SQL function or a plain insert. */
export class SupabaseGameStore implements GameStore {
  readonly kind = "supabase" as const;
  constructor(private readonly db: SupabaseClient) {}

  async recordRun(t: SpentTicket, r: RunRecord): Promise<boolean> {
    const { data, error } = await this.db.rpc("parahawk_game_record_run", {
      p_nonce: t.nonce,
      p_expires_at: iso(t.expiresAt),
      p_id: r.id,
      p_address: r.address,
      p_played_at: iso(r.at),
      p_seed: r.seed,
      p_score: r.score,
      p_won: r.won,
      p_nonces: r.nonces,
      p_stale: r.stale,
      p_scrapes: r.scrapes,
      p_duration_ms: r.durationMs,
      p_whites_awarded: r.whitesAwarded,
    });
    if (error) throw new GameStoreError("parahawk_game_record_run", error);
    if (typeof data !== "boolean") throw new GameStoreError("parahawk_game_record_run", { message: `unexpected reply ${JSON.stringify(data)}` });
    return data;
  }

  async addBurn(b: BurnRecord): Promise<void> {
    const { error } = await this.db.from("game_burns").insert({
      id: b.id, address: b.address, burned_at: iso(b.at), from_tier: b.fromTier, to_tier: b.toTier,
    });
    if (error) throw new GameStoreError("game_burns insert", error);
  }

  async lastRunAt(address: string): Promise<number | null> {
    const { data, error } = await this.db.from("game_runs").select("played_at").eq("address", address)
      .order("played_at", { ascending: false }).limit(1);
    if (error) throw new GameStoreError("game_runs select", error);
    return time(((data ?? [])[0] as { played_at?: string } | undefined)?.played_at);
  }

  async leaderboard(since: number | null, limit: number): Promise<BoardAggregate> {
    const { data, error } = await this.db.rpc("parahawk_game_leaderboard", { p_since: since === null ? null : iso(since), p_limit: limit });
    if (error) throw new GameStoreError("parahawk_game_leaderboard", error);
    const rows = (data ?? []) as BoardRow[];
    return {
      entries: rows.map((r) => ({
        address: r.address, best: num(r.best), bestAt: time(r.best_at) ?? 0,
        runs: num(r.runs), wins: num(r.wins), whitesWon: num(r.whites_won),
      })),
      players: rows.length ? num(rows[0]!.players) : 0,
      totalRuns: rows.length ? num(rows[0]!.total_runs) : 0,
    };
  }

  async playerStats(address: string): Promise<PlayerAggregate> {
    const [stats, burns] = await Promise.all([
      this.db.rpc("parahawk_game_player_stats", { p_address: address }),
      this.db.rpc("parahawk_game_player_burns", { p_address: address }),
    ]);
    if (stats.error) throw new GameStoreError("parahawk_game_player_stats", stats.error);
    if (burns.error) throw new GameStoreError("parahawk_game_player_burns", burns.error);
    const s = ((stats.data ?? []) as StatsRow[])[0];
    return {
      runs: num(s?.runs), wins: num(s?.wins), best: num(s?.best), whitesWon: num(s?.whites_won),
      firstAt: time(s?.first_at), lastAt: time(s?.last_at),
      burns: ((burns.data ?? []) as BurnStepRow[]).map((b) => ({ fromTier: b.from_tier as TierId, toTier: b.to_tier as TierId, count: num(b.burns) })),
    };
  }
}

export interface GameStoreEnv {
  /** Set by Vercel on every deployment, and nowhere else. */
  VERCEL?: string;
  /** Override the local file (tests). */
  GAME_RUNS_FILE?: string;
}

export interface GameStoreDeps {
  hasSupabase?: () => boolean;
  makeSupabase?: () => SupabaseClient;
}

/** Pick the store for this process. See THE RULE at the top of the file. */
export function createGameStore(env: GameStoreEnv = process.env, deps: GameStoreDeps = {}): GameStore {
  if (env.VERCEL) {
    const has = deps.hasSupabase ?? hasSupabase;
    if (!has()) {
      // A deployed board without a database forgets everything on every cold start. Say so.
      console.warn("[game] no Supabase configured on Vercel — the Block Hunt board is in-memory only");
      return new MemoryGameStore();
    }
    const make = deps.makeSupabase
      ?? (() => createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } }));
    return new SupabaseGameStore(make());
  }
  return new FileGameStore(env.GAME_RUNS_FILE ?? resolve("data", "game-runs.json"));
}
