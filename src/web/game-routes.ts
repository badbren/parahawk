/**
 * Block Hunt leaderboard + stats API (PRACTICE).
 *
 *   POST /api/game/start            deal a ranked-run ticket: { ticket, seed, tickHz, issuedAt, expiresAt }
 *   POST /api/game/runs             { ticket, inputs } — the server replays the run and scores it itself
 *   POST /api/game/burns            a burn, for the stats
 *   GET  /api/game/leaderboard      ?window=today|week|all&limit=50
 *   GET  /api/game/stats/:address   one player, all time
 *
 * The server never takes a client's word for a score. A ranked run starts with
 * a ticket the server signs (src/game/ticket.ts) carrying a fresh random seed;
 * it ends with that ticket and the steer log, which the server replays on the
 * ticket's seed (src/game/replay.ts) — the board records the server's result.
 * Tickets are good once, for one wallet, for 15 minutes, and not before the
 * run could actually have been played. Spending a ticket and recording its run
 * is a single database step (store.recordRun), so "good once" holds across
 * every serverless instance; the per-wallet limits kept in memory here are
 * only soft caps.
 *
 * The limit, stated plainly: replay proves a run is legal for its seed, not
 * that a person played it. A script that knows the seed can search for good
 * inputs. The per-run score cap, the real-time minimum and the per-wallet
 * start/finish limits bound what that buys — and nothing here pays out.
 *
 * Where the rows live is src/game/store.ts's call (never the live database
 * when running locally).
 */
import { randomUUID } from "node:crypto";
import express from "express";
import { getSession, isSignableAddress, type Session } from "../services/auth.js";
import { isLeaderboardWindow, rankBoard, statsFrom, windowStart } from "../game/board.js";
import { checkInputs } from "../game/inputs.js";
import { withNames } from "../game/names.js";
import { publicNamesFor } from "../profile/names.js";
import { maxTicksFor, replayWith, simulation, type Simulation } from "../game/replay.js";
import {
  BURN_COOLDOWN_MS,
  RUN_ATTEMPT_GAP_MS,
  RUN_COOLDOWN_MS,
  START_COOLDOWN_MS,
  checkBurn,
  minRealMsFor,
  statsFromResult,
} from "../game/rules.js";
import { createGameStore, type GameStore } from "../game/store.js";
import { createSeedDealer, issueTicket, ticketsBlocked, usingDevSecret, verifyTicket } from "../game/ticket.js";
import type { RunRecord } from "../game/types.js";

export interface GameRouterOptions {
  store?: GameStore;
  session?: (req: express.Request) => Session | null;
  now?: () => number;
  /** A fixed namer (tests). Without one, boards show Parahawk display names over short addresses. */
  nameFor?: (address: string) => string;
  /** Display-name lookup. Defaults to src/profile/names.ts publicNamesFor: rows pair a name with a wallet, so private people stay nameless. */
  namesFor?: (addresses: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  /** The simulation runs are replayed with. Defaults to the wired one (replay.ts); null = none. */
  simulation?: Simulation | null;
  /** Refuse to deal tickets signed with the dev secret. Defaults to "on Vercel". */
  refuseDevSecret?: boolean;
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

const wait = (res: express.Response, ms: number, what: string) => {
  const secs = Math.max(1, Math.ceil(ms / 1000));
  res.set("Retry-After", String(secs)).status(429).json({ error: `${what} — try again in ${secs} s` });
};

export function gameRouter(opts: GameRouterOptions = {}): express.Router {
  let store = opts.store ?? null;
  const getStore = (): GameStore => (store ??= createGameStore());
  const session = opts.session ?? getSession;
  const now = opts.now ?? Date.now;
  const namesFor = opts.namesFor ?? publicNamesFor;
  /** The namer for one response: display names where people set one, the short address for the rest. */
  const namer = async (addresses: string[]): Promise<(address: string) => string> =>
    opts.nameFor ?? withNames(await namesFor(addresses).catch(() => new Map<string, string>()));
  const sim = opts.simulation === undefined ? simulation() : opts.simulation;
  const refuseDevSecret = opts.refuseDevSecret ?? ticketsBlocked(process.env, true);
  const dealSeed = createSeedDealer();
  /**
   * Last ticket / submission / accepted run / burn per address. Soft caps only:
   * each serverless instance has its own, and nothing correct depends on them.
   */
  const lastStart = new Map<string, number>();
  const lastAttempt = new Map<string, number>();
  const lastRun = new Map<string, number>();
  const lastBurn = new Map<string, number>();

  const r = express.Router();
  const smallJson = express.json({ limit: "2kb" });
  // A steer log that changed every tick of a long run is a few hundred KB at most.
  const runJson = express.json({ limit: "400kb" });

  /** Shared gate for the POSTs: no caching, same origin, signed in, and (optionally) JSON. */
  const gate = (req: express.Request, res: express.Response, needJson = true): Session | null => {
    res.set("Cache-Control", "no-store");
    if (!sameOrigin(req)) { res.status(403).json({ error: "cross-site request refused" }); return null; }
    if (needJson && !req.is("application/json")) { res.status(415).json({ error: "send JSON" }); return null; }
    const s = session(req);
    if (!s) { res.status(401).json({ error: "sign in with Xverse to play ranked runs" }); return null; }
    return s;
  };

  // ── Start: deal a ticket ───────────────────────────────────────────────────
  // The body is ignored entirely: nothing the client sends goes into a ticket.
  r.post("/start", smallJson, (req, res) => {
    const s = gate(req, res, false);
    if (!s) return;
    if (refuseDevSecret && usingDevSecret()) {
      res.status(503).json({ error: "ranked runs are off: the server has no KEYS_SECRET to sign tickets with" });
      return;
    }
    const t = now();
    const since = t - (lastStart.get(s.address) ?? 0);
    if (since < START_COOLDOWN_MS) { wait(res, START_COOLDOWN_MS - since, "one new run at a time"); return; }
    lastStart.set(s.address, t);
    const issued = issueTicket(s.address, t, dealSeed);
    res.json({ ...issued, tickHz: sim?.TICK_HZ ?? null, practice: true });
  });

  // ── Runs: replay and record ────────────────────────────────────────────────
  r.post("/runs", runJson, async (req, res) => {
    const s = gate(req, res);
    if (!s) return;
    if (!sim) { res.status(503).json({ error: "ranked runs are not open yet — the server cannot replay runs" }); return; }

    const body = req.body as Record<string, unknown> | null;
    if (typeof body !== "object" || body === null || Array.isArray(body) || typeof body.ticket !== "string" || !("inputs" in body)) {
      res.status(400).json({ error: "send { ticket, inputs } — the server scores runs itself" });
      return;
    }

    const t = now();
    const ticket = verifyTicket(body.ticket, t);
    if (!ticket.ok) {
      if (ticket.reason === "expired") res.status(410).json({ error: "this run's ticket has expired — start a new run" });
      else res.status(401).json({ error: "that ticket is not one of ours" });
      return;
    }
    const { seed, address, issuedAt, nonce } = ticket.payload;
    if (address !== s.address) { res.status(403).json({ error: "that ticket was dealt to another wallet" }); return; }

    // Replays cost CPU, so even a wallet with a good ticket gets one try per gap.
    const sinceAttempt = t - (lastAttempt.get(address) ?? 0);
    if (sinceAttempt < RUN_ATTEMPT_GAP_MS) { wait(res, RUN_ATTEMPT_GAP_MS - sinceAttempt, "one submission at a time"); return; }
    lastAttempt.set(address, t);

    const inputs = checkInputs(body.inputs, maxTicksFor(sim));
    if (!inputs.ok) { res.status(422).json({ error: inputs.error }); return; }
    // No faster than real time: the ticket was dealt before the run began.
    const needMs = minRealMsFor(inputs.ticks, sim.TICK_HZ);
    if (t - issuedAt < needMs) {
      res.status(422).json({ error: "submitted faster than the run could have been played" });
      return;
    }

    try {
      const last = Math.max(lastRun.get(s.address) ?? 0, (await getStore().lastRunAt(s.address)) ?? 0);
      if (t - last < RUN_COOLDOWN_MS) { wait(res, RUN_COOLDOWN_MS - (t - last), `one run every ${RUN_COOLDOWN_MS / 1000} s`); return; }

      // The server's own run, on the ticket's seed. The client's opinion of
      // its score is never read — there is nowhere in the body to put one.
      const replayed = replayWith(sim, seed, inputs.log);
      if (!replayed.ok) { res.status(422).json({ error: replayed.error }); return; }

      const run: RunRecord = { id: randomUUID(), address, at: t, ...statsFromResult(seed, replayed.result, sim.TICK_HZ) };
      // Spend the ticket and record the run in one step: both or neither.
      if (!(await getStore().recordRun({ nonce, address, expiresAt: ticket.expiresAt }, run, t))) {
        res.status(409).json({ error: "that ticket has already been used" });
        return;
      }
      lastRun.set(address, t);
      res.status(201).json({ ok: true, run, verified: true, practice: true });
    } catch (err) {
      console.error("[/api/game/runs] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.post("/burns", smallJson, async (req, res) => {
    const s = gate(req, res);
    if (!s) return;
    const checked = checkBurn(req.body);
    if (!checked.ok) { res.status(400).json({ error: checked.error }); return; }
    const t = now();
    if (t - (lastBurn.get(s.address) ?? 0) < BURN_COOLDOWN_MS) { res.status(429).json({ error: "slow down" }); return; }
    lastBurn.set(s.address, t);
    try {
      const burn = { id: randomUUID(), address: s.address, at: t, ...checked.value };
      await getStore().addBurn(burn);
      res.status(201).json({ ok: true, burn, practice: true });
    } catch (err) {
      console.error("[/api/game/burns] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.get("/leaderboard", async (req, res) => {
    const window = req.query.window ?? "today";
    if (!isLeaderboardWindow(window)) { res.status(400).json({ error: "window must be today, week or all" }); return; }
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 50;
    try {
      const t = now();
      const agg = await getStore().leaderboard(windowStart(window, t), limit);
      res.set("Cache-Control", "public, max-age=15, s-maxage=15, stale-while-revalidate=30");
      res.json(rankBoard(agg, window, t, await namer(agg.entries.map((e) => e.address))));
    } catch (err) {
      console.error("[/api/game/leaderboard] failed:", err);
      res.status(500).json({ error: "internal error" });
    }
  });

  r.get("/stats/:address", async (req, res) => {
    const address = req.params.address.trim();
    if (!isSignableAddress(address)) { res.status(400).json({ error: "not a bitcoin address" }); return; }
    try {
      const agg = await getStore().playerStats(address);
      // A player watches this move after every run, so it is never cached.
      res.set("Cache-Control", "no-store");
      res.json(statsFrom(address, agg, await namer([address])));
    } catch (err) {
      console.error("[/api/game/stats] failed:", err);
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
