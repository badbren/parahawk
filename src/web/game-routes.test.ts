import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSteerRecorder, type SteerLog } from "../game/inputs.js";
import { createBot } from "../game/bots.js";
import type { Simulation } from "../game/replay.js";
import { createSim, resultOf, step, TICK_HZ } from "../game/sim.js";
import { RUN_ATTEMPT_GAP_MS, RUN_COOLDOWN_MS, START_COOLDOWN_MS } from "../game/rules.js";
import { MemoryGameStore, SupabaseGameStore, type GameStore } from "../game/store.js";
import { SEED_MAX, SEED_MIN, TICKET_TTL_MS, verifyTicket } from "../game/ticket.js";
import { gameRouter, type GameRouterOptions } from "./game-routes.js";

const ALICE = "bc1qalice0000000000000000000000000000000";
const BOB = "bc1qbob00000000000000000000000000000000000";

// ── A stand-in simulation (the real one is src/game/sim.ts, once it lands) ────
interface Stub { x: number; tick: number; score: number; scrapes: number; seed: number }
const RUN_TICKS = 300;                       // 30 s at 10 Hz
const stub: Simulation<Stub> = {
  TICK_HZ: 10,
  createSim: (seed) => ({ x: 0.5, tick: 0, score: 0, scrapes: 0, seed }),
  step(s, steer) {
    s.x = Math.min(1, Math.max(0, s.x + steer * 0.05));
    if (s.x === 0 || s.x === 1) s.scrapes += 1;
    if (Math.abs(s.x - target(s)) < 0.12) s.score += 1;
    s.tick += 1;
  },
  isDone: (s) => s.tick >= RUN_TICKS,
  resultOf: (s) => ({ score: Math.min(200, s.score), won: s.score >= 150, nonces: 0, stale: 0, scrapes: s.scrapes, ticks: s.tick }),
};
const target = (s: Stub) => 0.5 + 0.4 * Math.sin((s.tick + (s.seed % 997)) / 9);
const chase = (s: Stub) => Math.max(-1, Math.min(1, (target(s) - s.x) / 0.05));
const idle = () => 0;

/** Play a whole run on a seed the way the game will, recording the steering. */
function play(seed: number, policy: (s: Stub) => number = chase) {
  const rec = createSteerRecorder();
  const s = stub.createSim(seed);
  while (!stub.isDone(s)) stub.step(s, rec.push(policy(s)));
  return { inputs: rec.log(), result: stub.resultOf(s) };
}
const RUN_MS = (RUN_TICKS / stub.TICK_HZ) * 1000;

// ── Server ───────────────────────────────────────────────────────────────────
let clock = Date.UTC(2026, 9, 22, 12);
let router: express.Router;
let store: GameStore;
let server: Server;
let base = "";

const session = (r: express.Request) => {
  const a = r.get("x-test-address");
  return a ? { address: a, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER } : null;
};
/** Fresh router (and its soft caps) per test; tests sign in by header. */
const mount = (opts: GameRouterOptions = {}) => {
  store = opts.store ?? new MemoryGameStore();
  router = gameRouter({ store, now: () => clock, session, simulation: stub, refuseDevSecret: false, ...opts });
};

beforeAll(async () => {
  const app = express();
  app.use("/api/game", (req, res, next) => router(req, res, next));
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/game`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { clock += 24 * 3_600_000; mount(); });

const post = (path: string, body: unknown, who: string | null = ALICE, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(who ? { "x-test-address": who } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

async function start(who: string = ALICE): Promise<{ ticket: string; seed: number; tickHz: number | null; issuedAt: number; expiresAt: number }> {
  const res = await post("/start", {}, who);
  expect(res.status).toBe(200);
  return res.json();
}

const submit = (ticket: string, inputs: SteerLog | unknown, who: string = ALICE, extra: Record<string, unknown> = {}) =>
  post("/runs", { ticket, inputs, ...extra }, who);

// ── /start ───────────────────────────────────────────────────────────────────
describe("POST /start", () => {
  it("deals a signed ticket on a fresh server seed, to signed-in wallets only", async () => {
    expect((await post("/start", {}, null)).status).toBe(401);
    const t = await start();
    expect(t.tickHz).toBe(10);
    expect(t.issuedAt).toBe(clock);
    expect(t.expiresAt).toBe(clock + TICKET_TTL_MS);
    const v = verifyTicket(t.ticket, clock);
    expect(v.ok && v.payload.seed).toBe(t.seed);
    expect(v.ok && v.payload.address).toBe(ALICE);
  });

  it("ignores anything the client sends — a seed in the body is not the seed dealt", async () => {
    for (let i = 0; i < 25; i++) {
      const res = await post("/start", { seed: 42, issuedAt: 0, address: BOB });
      const t = await res.json();
      expect(t.seed).not.toBe(42);
      expect(verifyTicket(t.ticket, clock).ok && (verifyTicket(t.ticket, clock) as { payload: { address: string } }).payload.address).toBe(ALICE);
      clock += START_COOLDOWN_MS;
    }
  });

  it("deals 1,000 consecutive tickets with no repeated seed", async () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const t = await start();
      expect(t.seed >= SEED_MIN && t.seed <= SEED_MAX).toBe(true);
      seeds.add(t.seed);
      clock += START_COOLDOWN_MS;
    }
    expect(seeds.size).toBe(1000);
  });

  it("holds a wallet to one new run at a time", async () => {
    await start();
    const again = await post("/start", {});
    expect(again.status).toBe(429);
    expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await post("/start", {}, BOB)).status).toBe(200);
  });

  it("deals tickets even before replay is wired, so the game can switch over first", async () => {
    mount({ simulation: null });
    expect((await start()).tickHz).toBeNull();
  });

  it("refuses to deal tickets signed with the dev secret where that is forbidden (production)", async () => {
    mount({ refuseDevSecret: true });
    // The test process has no KEYS_SECRET, so tickets would be signed with the public dev string.
    expect((await post("/start", {})).status).toBe(503);
  });
});

// ── /runs ────────────────────────────────────────────────────────────────────
describe("POST /runs", () => {
  it("replays the run and records the SERVER's result, on the ticket's seed", async () => {
    const t = await start();
    const { inputs, result } = play(t.seed);
    clock += RUN_MS;
    // A lie about the score and a different seed ride along; neither is read.
    const res = await submit(t.ticket, inputs, ALICE, { score: 200, seed: 7, won: true });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, verified: true, practice: true });
    expect(body.run).toMatchObject({
      address: ALICE, seed: t.seed, score: result.score, won: result.won, scrapes: result.scrapes,
      durationMs: RUN_MS, whitesAwarded: result.won ? 2 : 1, at: clock,
    });
    const board = await (await fetch(`${base}/leaderboard?window=today`)).json();
    expect(board.rows[0]).toMatchObject({ address: ALICE, best: result.score, runs: 1 });
  });

  it("scores a weak run as the weak run it is", async () => {
    const t = await start();
    const { inputs, result } = play(t.seed, idle);
    clock += RUN_MS;
    const body = await (await submit(t.ticket, inputs)).json();
    expect(body.run.score).toBe(result.score);
    expect(body.run.won).toBe(false);
    expect(body.run.whitesAwarded).toBe(1);
  });

  it("refuses guests, cross-site posts and non-JSON", async () => {
    const t = await start();
    clock += RUN_MS;
    expect((await submit(t.ticket, play(t.seed).inputs, null as unknown as string)).status).toBe(401);
    expect((await post("/runs", { ticket: t.ticket, inputs: [] }, ALICE, { Origin: "https://evil.example" })).status).toBe(403);
    const form = await fetch(`${base}/runs`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "x-test-address": ALICE }, body: "a=1" });
    expect(form.status).toBe(415);
  });

  it("refuses the old client-scored shape", async () => {
    const res = await post("/runs", { seed: 7, score: 140, won: true, nonces: 1, stale: 0, scrapes: 2, durationMs: 45_000, whitesAwarded: 2 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ticket, inputs/);
  });

  it("refuses a forged or tampered ticket (401)", async () => {
    const t = await start();
    const { inputs } = play(t.seed);
    clock += RUN_MS;
    const [p, body, sig] = t.ticket.split(".") as [string, string, string];
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    const chosenSeed = `${p}.${Buffer.from(JSON.stringify({ ...payload, seed: 1 })).toString("base64url")}.${sig}`;
    for (const bad of [chosenSeed, `${p}.${body}.${sig.slice(1)}A`, "gt1.x.y", "not-a-ticket"]) {
      expect((await submit(bad, inputs)).status).toBe(401);
      clock += RUN_ATTEMPT_GAP_MS;
    }
  });

  it("refuses a ticket dealt to another wallet (403)", async () => {
    const t = await start(ALICE);
    clock += RUN_MS;
    expect((await submit(t.ticket, play(t.seed).inputs, BOB)).status).toBe(403);
  });

  it("refuses an expired ticket (410)", async () => {
    const t = await start();
    clock += TICKET_TTL_MS + 1;
    expect((await submit(t.ticket, play(t.seed).inputs)).status).toBe(410);
  });

  it("refuses a ticket used twice (409), and records the run once", async () => {
    const t = await start();
    const { inputs } = play(t.seed);
    clock += RUN_MS;
    expect((await submit(t.ticket, inputs)).status).toBe(201);
    clock += RUN_COOLDOWN_MS;
    expect((await submit(t.ticket, inputs)).status).toBe(409);
    expect((await store.playerStats(ALICE)).runs).toBe(1);
  });

  it("refuses a run submitted faster than it could be played (422)", async () => {
    const t = await start();
    const { inputs } = play(t.seed);
    clock += RUN_MS * 0.5;
    const res = await submit(t.ticket, inputs);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/faster than the run/);
  });

  it("refuses malformed inputs (422)", async () => {
    const t = await start();
    clock += RUN_MS;
    for (const bad of [[], [[0.5, 3]], [[0, 0]], [[999, 1]], "steer"]) {
      expect((await submit(t.ticket, bad)).status, JSON.stringify(bad)).toBe(422);
      clock += RUN_ATTEMPT_GAP_MS;
    }
  });

  it("refuses inputs that stop before the run ends (422) — and the ticket is not spent by it", async () => {
    const t = await start();
    const { inputs } = play(t.seed);
    clock += RUN_MS;
    expect((await submit(t.ticket, inputs.slice(0, 2))).status).toBe(422);
    clock += RUN_ATTEMPT_GAP_MS;
    expect((await submit(t.ticket, inputs)).status).toBe(201);
  });

  it("gives each wallet one submission per gap, and one accepted run per cooldown", async () => {
    const t1 = await start();
    clock += START_COOLDOWN_MS;
    const t2 = await start();
    clock += RUN_MS;
    expect((await submit(t1.ticket, play(t1.seed).inputs)).status).toBe(201);
    expect((await submit(t2.ticket, play(t2.seed).inputs)).status).toBe(429);   // attempt gap
    clock += RUN_ATTEMPT_GAP_MS;
    expect((await submit(t2.ticket, play(t2.seed).inputs)).status).toBe(429);   // run cooldown
    clock += RUN_COOLDOWN_MS;
    expect((await submit(t2.ticket, play(t2.seed).inputs)).status).toBe(201);
  });

  it("refuses ranked runs while no simulation is wired (503)", async () => {
    mount({ simulation: null });
    const t = await start();
    clock += RUN_MS;
    expect((await submit(t.ticket, [[0, 300]])).status).toBe(503);
  });

  it("answers bad JSON with JSON", async () => {
    const res = await post("/runs", "{nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad JSON" });
  });
});

// ── Production path: the Supabase store behind the router ────────────────────
describe("with the Supabase store", () => {
  /** Behaves like parahawk_game_record_run: one insert per nonce, all or nothing, and can be told to fail. */
  function fakeDb() {
    const spent = new Set<string>();
    const runs: unknown[] = [];
    let failNext = false;
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "parahawk_game_record_run") {
          if (failNext) { failNext = false; return { data: null, error: { message: "could not serialize access", code: "40001" } }; }
          if (spent.has(args.p_nonce as string)) return { data: false, error: null };
          spent.add(args.p_nonce as string);
          runs.push(args);
          return { data: true, error: null };
        }
        if (name === "parahawk_game_leaderboard") return { data: null, error: { message: "statement timeout", code: "57014" } };
        return { data: [], error: null };
      },
      from: () => {
        const q = { select: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({ data: [], error: null }) };
        return q;
      },
    };
    return { client: client as unknown as SupabaseClient, runs, failOnce: () => { failNext = true; } };
  }

  it("turns a database error into a 500 — the run is not lost and the ticket is not spent", async () => {
    const db = fakeDb();
    mount({ store: new SupabaseGameStore(db.client) });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = await start();
    const { inputs } = play(t.seed);
    clock += RUN_MS;
    db.failOnce();
    expect((await submit(t.ticket, inputs)).status).toBe(500);
    expect(db.runs).toHaveLength(0);
    clock += RUN_ATTEMPT_GAP_MS;
    expect((await submit(t.ticket, inputs)).status).toBe(201);
    expect(db.runs).toHaveLength(1);
    clock += RUN_COOLDOWN_MS;
    expect((await submit(t.ticket, inputs)).status).toBe(409);
    expect(db.runs).toHaveLength(1);
    expect((await fetch(`${base}/leaderboard?window=today`)).status).toBe(500);
    quiet.mockRestore();
  });
});

// ── Reads ────────────────────────────────────────────────────────────────────
describe("GET /leaderboard and /stats", () => {
  it("ranks verified runs and reports a player's record", async () => {
    const a = await start(ALICE);
    const b = await start(BOB);
    clock += RUN_MS;
    const ra = await (await submit(a.ticket, play(a.seed).inputs, ALICE)).json();
    const rb = await (await submit(b.ticket, play(b.seed, idle).inputs, BOB)).json();
    clock += 2_000;
    await post("/burns", { fromTier: "white", toTier: "orange" });

    const res = await fetch(`${base}/leaderboard?window=today`);
    expect(res.headers.get("cache-control")).toContain("max-age=15");
    const board = await res.json();
    expect(board.rows.map((r: { address: string }) => r.address)).toEqual(
      ra.run.score >= rb.run.score ? [ALICE, BOB] : [BOB, ALICE]);
    expect(board).toMatchObject({ window: "today", totalRuns: 2, players: 2, practice: true });

    const stats = await (await fetch(`${base}/stats/${ALICE}`)).json();
    expect(stats).toMatchObject({ runs: 1, best: ra.run.score, burned: { white: 2 }, made: { orange: 1 }, practice: true });
  });

  it("validates its inputs", async () => {
    expect((await fetch(`${base}/leaderboard?window=month`)).status).toBe(400);
    expect((await fetch(`${base}/stats/not-an-address`)).status).toBe(400);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});

// ── End to end with Block Hunt itself (src/game/sim.ts) ──────────────────────
describe("ranked runs on the real simulation", () => {
  /** Play the ticket's seed the way the browser does: steering every tick through the recorder. */
  function playReal(seed: number, kind: "first" | "expert") {
    const rec = createSteerRecorder();
    const sim = createSim(seed);
    const bot = createBot(kind, seed);
    while (!sim.done) step(sim, rec.push(bot(sim)));
    return { inputs: rec.log(), result: resultOf(sim) };
  }

  it("records exactly what the run scored — and only after it could have been played", async () => {
    mount({ simulation: undefined });   // the default: the wired simulation
    const t = await start();
    expect(t.tickHz).toBe(TICK_HZ);
    const { inputs, result } = playReal(t.seed, "expert");
    const runMs = (result.ticks / TICK_HZ) * 1000;

    clock += runMs * 0.5;
    expect((await submit(t.ticket, inputs)).status).toBe(422);    // faster than real time
    clock += runMs * 0.5 + RUN_ATTEMPT_GAP_MS;

    const res = await submit(t.ticket, inputs, ALICE, { score: 200, won: true });
    expect(res.status).toBe(201);
    const { run } = await res.json();
    expect(run).toMatchObject({
      seed: t.seed, score: result.score, won: result.won, nonces: result.nonces, stale: result.stale,
      scrapes: result.scrapes, whitesAwarded: result.won ? 2 : 1,
    });
    clock += RUN_COOLDOWN_MS;
    expect((await submit(t.ticket, inputs)).status).toBe(409);
  });

  it("will not score a log recorded on one seed against another wallet's ticket or seed", async () => {
    mount({ simulation: undefined });
    const mine = await start(ALICE);
    clock += START_COOLDOWN_MS;
    const other = await start(BOB);
    const { inputs, result } = playReal(other.seed, "expert");
    clock += (result.ticks / TICK_HZ) * 1000;
    expect((await submit(other.ticket, inputs, ALICE)).status).toBe(403);
    clock += RUN_ATTEMPT_GAP_MS;
    // Bob's good run, sent on Alice's ticket, is replayed on Alice's seed.
    const res = await submit(mine.ticket, inputs, ALICE);
    if (res.status === 201) expect((await res.json()).run).not.toMatchObject({ score: result.score, scrapes: result.scrapes, durationMs: Math.round((result.ticks / TICK_HZ) * 1000) });
    else expect(res.status).toBe(422);
  });
});
