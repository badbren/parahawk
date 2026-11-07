import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every Supabase client this file could build goes through this spy.
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ from: vi.fn(), rpc: vi.fn() })) }));

import { createClient } from "@supabase/supabase-js";
import { createGameStore, FileGameStore, GameStoreError, MemoryGameStore, SupabaseGameStore } from "./store.js";
import type { RunRecord } from "./types.js";

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "game-runs-"));
  dirs.push(dir);
  return join(dir, "data", "game-runs.json");
};
afterEach(() => {
  vi.mocked(createClient).mockClear();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const run = (address: string, at: number, score = 100, won = true): RunRecord => ({
  id: `${address}-${at}`, address, at, seed: at, score, won, nonces: 0, stale: 0, scrapes: 0, durationMs: 45_000, whitesAwarded: won ? 2 : 1,
});
const ticket = (nonce: string, address = "alice", expiresAt = 10_000_000) => ({ nonce, address, expiresAt });

describe("THE RULE: local never writes to the live database", () => {
  it("uses a local file off Vercel, even when Supabase credentials are present", () => {
    const makeSupabase = vi.fn();
    const store = createGameStore({ GAME_RUNS_FILE: tempFile() }, { hasSupabase: () => true, makeSupabase });
    expect(store.kind).toBe("file");
    expect(makeSupabase).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("does the same with the real credential check (the local .env has live credentials)", () => {
    const store = createGameStore({ GAME_RUNS_FILE: tempFile() });
    expect(store.kind).toBe("file");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses Supabase only on Vercel", () => {
    const store = createGameStore({ VERCEL: "1" }, { hasSupabase: () => true });
    expect(store.kind).toBe("supabase");
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("falls back to memory on Vercel with no database configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = createGameStore({ VERCEL: "1" }, { hasSupabase: () => false });
    expect(store.kind).toBe("memory");
    expect(createClient).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("MemoryGameStore", () => {
  it("records a run with its ticket, once", async () => {
    const store = new MemoryGameStore();
    expect(await store.recordRun(ticket("n1"), run("alice", 10), 0)).toBe(true);
    expect(await store.recordRun(ticket("n1"), run("alice", 20), 0)).toBe(false);
    expect((await store.playerStats("alice")).runs).toBe(1);
  });

  it("forgets spent tickets once they would have expired anyway", async () => {
    const store = new MemoryGameStore();
    await store.recordRun(ticket("n1", "alice", 100), run("alice", 10), 0);
    expect(await store.recordRun(ticket("n1", "alice", 100), run("alice", 20), 101)).toBe(true);
  });

  it("aggregates the board and a player's stats", async () => {
    const store = new MemoryGameStore();
    await store.recordRun(ticket("a"), run("alice", 10, 120), 0);
    await store.recordRun(ticket("b"), run("bob", 20, 150, false), 0);
    await store.recordRun(ticket("c"), run("alice", 30, 90), 0);
    await store.addBurn({ id: "x", address: "alice", at: 40, fromTier: "white", toTier: "orange" });
    const board = await store.leaderboard(15, 10);
    expect(board.entries.map((e) => [e.address, e.best])).toEqual([["bob", 150], ["alice", 90]]);
    expect(board).toMatchObject({ players: 2, totalRuns: 2 });
    expect(await store.playerStats("alice")).toMatchObject({ runs: 2, wins: 2, best: 120, whitesWon: 4, burns: [{ fromTier: "white", toTier: "orange", count: 1 }] });
    expect(await store.lastRunAt("alice")).toBe(30);
    expect(await store.lastRunAt("carol")).toBeNull();
  });
});

describe("FileGameStore", () => {
  it("survives a restart — runs, burns and spent tickets", async () => {
    const path = tempFile();
    const first = new FileGameStore(path);
    await first.recordRun(ticket("n1"), run("alice", 1000), 0);
    await first.addBurn({ id: "b", address: "alice", at: 1001, fromTier: "white", toTier: "orange" });
    const again = new FileGameStore(path);
    expect((await again.playerStats("alice")).runs).toBe(1);
    expect((await again.playerStats("alice")).burns).toHaveLength(1);
    expect(await again.recordRun(ticket("n1"), run("alice", 2000), 0)).toBe(false);
    expect(JSON.parse(readFileSync(path, "utf8")).tickets).toEqual({ n1: 10_000_000 });
  });

  it("starts empty on a missing or unreadable file", async () => {
    expect((await new FileGameStore(join(tmpdir(), "definitely-missing", "x.json")).leaderboard(null, 10)).entries).toEqual([]);
  });

  it("keeps only the newest runs past its bound", async () => {
    const store = new FileGameStore(tempFile(), 3);
    for (let i = 1; i <= 5; i++) await store.recordRun(ticket(`n${i}`), run(`p${i}`, i), 0);
    expect((await store.leaderboard(null, 10)).totalRuns).toBe(3);
  });
});

/** A Supabase client double: records every call and answers like the real functions. */
function fakeSupabase(answers: Record<string, () => { data: unknown; error: { message: string; code?: string } | null }>) {
  const calls: Array<{ kind: string; name: string; args: unknown }> = [];
  const chain = (name: string) => {
    const q: Record<string, unknown> = {};
    const result = () => (answers[`from:${name}`] ?? (() => ({ data: [], error: null })))();
    for (const m of ["select", "eq", "order", "limit"]) {
      q[m] = (...args: unknown[]) => { calls.push({ kind: m, name, args }); return q; };
    }
    q.insert = (row: unknown) => { calls.push({ kind: "insert", name, args: row }); return Promise.resolve(result()); };
    q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
    return q;
  };
  const client = {
    rpc: (name: string, args: unknown) => {
      calls.push({ kind: "rpc", name, args });
      return Promise.resolve((answers[`rpc:${name}`] ?? (() => ({ data: null, error: null })))());
    },
    from: (name: string) => chain(name),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("SupabaseGameStore", () => {
  it("records a run and spends its ticket in ONE function call", async () => {
    const { client, calls } = fakeSupabase({ "rpc:parahawk_game_record_run": () => ({ data: true, error: null }) });
    const store = new SupabaseGameStore(client);
    const r = run("bc1qalice", Date.UTC(2026, 9, 22), 140);
    expect(await store.recordRun(ticket("nonce-1", "bc1qalice", Date.UTC(2026, 9, 22, 0, 15)), r)).toBe(true);
    expect(calls).toEqual([{
      kind: "rpc", name: "parahawk_game_record_run", args: {
        p_nonce: "nonce-1", p_expires_at: "2026-10-22T00:15:00.000Z",
        p_id: r.id, p_address: "bc1qalice", p_played_at: "2026-10-22T00:00:00.000Z", p_seed: r.seed,
        p_score: 140, p_won: true, p_nonces: 0, p_stale: 0, p_scrapes: 0, p_duration_ms: 45_000, p_whites_awarded: 2,
      },
    }]);
  });

  it("reports an already-spent ticket as false, not as an error", async () => {
    const { client } = fakeSupabase({ "rpc:parahawk_game_record_run": () => ({ data: false, error: null }) });
    expect(await new SupabaseGameStore(client).recordRun(ticket("n"), run("a", 1))).toBe(false);
  });

  it("surfaces a database error instead of dropping the run", async () => {
    const { client } = fakeSupabase({ "rpc:parahawk_game_record_run": () => ({ data: null, error: { message: "connection reset", code: "08006" } }) });
    const err = await new SupabaseGameStore(client).recordRun(ticket("n"), run("a", 1)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GameStoreError);
    expect((err as GameStoreError).code).toBe("08006");
  });

  it("treats a reply that is not a boolean as an error", async () => {
    const { client } = fakeSupabase({ "rpc:parahawk_game_record_run": () => ({ data: null, error: null }) });
    await expect(new SupabaseGameStore(client).recordRun(ticket("n"), run("a", 1))).rejects.toBeInstanceOf(GameStoreError);
  });

  it("reads the board from the aggregate function, bigint counts and all", async () => {
    const { client, calls } = fakeSupabase({
      "rpc:parahawk_game_leaderboard": () => ({
        data: [
          { address: "bob", best: 150, best_at: "2026-10-22T01:00:00.000Z", runs: "3", wins: 2, whites_won: 5, players: 7, total_runs: "19" },
          { address: "alice", best: 120, best_at: "2026-10-22T02:00:00.000Z", runs: 1, wins: 0, whites_won: 1, players: 7, total_runs: 19 },
        ],
        error: null,
      }),
    });
    const agg = await new SupabaseGameStore(client).leaderboard(Date.UTC(2026, 9, 22), 25);
    expect(calls[0]).toEqual({ kind: "rpc", name: "parahawk_game_leaderboard", args: { p_since: "2026-10-22T00:00:00.000Z", p_limit: 25 } });
    expect(agg).toEqual({
      entries: [
        { address: "bob", best: 150, bestAt: Date.UTC(2026, 9, 22, 1), runs: 3, wins: 2, whitesWon: 5 },
        { address: "alice", best: 120, bestAt: Date.UTC(2026, 9, 22, 2), runs: 1, wins: 0, whitesWon: 1 },
      ],
      players: 7,
      totalRuns: 19,
    });
  });

  it("asks for all time with a null since, and reads an empty window as zeroes", async () => {
    const { client, calls } = fakeSupabase({ "rpc:parahawk_game_leaderboard": () => ({ data: [], error: null }) });
    expect(await new SupabaseGameStore(client).leaderboard(null, 50)).toEqual({ entries: [], players: 0, totalRuns: 0 });
    expect(calls[0]!.args).toEqual({ p_since: null, p_limit: 50 });
  });

  it("reads a player's totals and burns", async () => {
    const { client } = fakeSupabase({
      "rpc:parahawk_game_player_stats": () => ({
        data: [{ runs: 4, wins: 3, best: 170, whites_won: 7, first_at: "2026-10-20T00:00:00.000Z", last_at: "2026-10-22T00:00:00.000Z" }], error: null,
      }),
      "rpc:parahawk_game_player_burns": () => ({ data: [{ from_tier: "white", to_tier: "orange", burns: 2 }], error: null }),
    });
    expect(await new SupabaseGameStore(client).playerStats("bc1qalice")).toEqual({
      runs: 4, wins: 3, best: 170, whitesWon: 7, firstAt: Date.UTC(2026, 9, 20), lastAt: Date.UTC(2026, 9, 22),
      burns: [{ fromTier: "white", toTier: "orange", count: 2 }],
    });
  });

  it("surfaces errors from every read and write", async () => {
    const boom = () => ({ data: null, error: { message: "boom" } });
    const { client } = fakeSupabase({
      "rpc:parahawk_game_leaderboard": boom, "rpc:parahawk_game_player_stats": boom, "from:game_burns": boom, "from:game_runs": boom,
    });
    const s = new SupabaseGameStore(client);
    await expect(s.leaderboard(null, 5)).rejects.toBeInstanceOf(GameStoreError);
    await expect(s.playerStats("x")).rejects.toBeInstanceOf(GameStoreError);
    await expect(s.addBurn({ id: "b", address: "x", at: 1, fromTier: "white", toTier: "orange" })).rejects.toBeInstanceOf(GameStoreError);
    await expect(s.lastRunAt("x")).rejects.toBeInstanceOf(GameStoreError);
  });

  it("inserts burns and reads the last run with the right columns", async () => {
    const { client, calls } = fakeSupabase({ "from:game_runs": () => ({ data: [{ played_at: "2026-10-22T03:00:00.000Z" }], error: null }) });
    const s = new SupabaseGameStore(client);
    await s.addBurn({ id: "b1", address: "x", at: Date.UTC(2026, 9, 22), fromTier: "white", toTier: "orange" });
    expect(await s.lastRunAt("x")).toBe(Date.UTC(2026, 9, 22, 3));
    expect(calls).toEqual([
      { kind: "insert", name: "game_burns", args: { id: "b1", address: "x", burned_at: "2026-10-22T00:00:00.000Z", from_tier: "white", to_tier: "orange" } },
      { kind: "select", name: "game_runs", args: ["played_at"] },
      { kind: "eq", name: "game_runs", args: ["address", "x"] },
      { kind: "order", name: "game_runs", args: ["played_at", { ascending: false }] },
      { kind: "limit", name: "game_runs", args: [1] },
    ]);
  });
});
