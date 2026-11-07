import { describe, expect, it } from "vitest";
import { MAX_ORE_PER_RUN } from "../econ/tokenomics.js";
import { BLOCK_BONUS, MAX_NONCES, buildRun, oreOnOffer } from "./blockrun.js";
import { type BotKind, createBot, playWith } from "./bots.js";
import { STEER_SCALE, type SteerLog, checkInputs, createSteerRecorder } from "./inputs.js";
import { replayWith } from "./replay.js";
import {
  RUN_TICKS,
  TICK_HZ,
  createSim,
  isDone,
  replay,
  resultOf,
  simulation,
  step,
  steerToward,
} from "./sim.js";

/** One steer per tick <-> the wire's run-length log. */
const encode = (steers: number[]): SteerLog => {
  const rec = createSteerRecorder();
  for (const s of steers) rec.push(s);
  return rec.log();
};
const decode = (log: SteerLog): number[] => log.flatMap(([k, n]) => Array.from({ length: n }, () => k / STEER_SCALE));

const SEEDS = Array.from({ length: 200 }, (_, i) => (i * 2654435761 + 977) >>> 0);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A whole run by a bot, recorded: the log a browser would send, and what the run did. */
function botRun(kind: BotKind, seed: number) {
  const sim = createSim(seed);
  const rec = createSteerRecorder();
  const bot = createBot(kind, seed);
  // Step with what the recorder returns — exactly what the server will replay.
  while (!sim.done) step(sim, rec.push(bot(sim)));
  return { sim, log: rec.log(), result: resultOf(sim) };
}

describe("the sim is deterministic", () => {
  it("plays the same seed and the same inputs to the same result, every time", () => {
    const steers = Array.from({ length: RUN_TICKS }, (_, i) => (((i * 7) % 17) - 8) / 8);
    const run = () => { const sim = createSim(424242); for (const s of steers) step(sim, s); return { r: resultOf(sim), x: sim.x, lamp: sim.lamp }; };
    expect(run()).toEqual(run());
  });

  it("replays a recorded player exactly — what the server will check", () => {
    for (const seed of SEEDS.slice(0, 25)) {
      for (const kind of ["first", "expert"] as const) {
        const live = botRun(kind, seed);
        const again = replay(seed, live.log);
        expect(again.complete).toBe(true);
        expect(again.result).toEqual(live.result);
        // And through the server's own replay path, with the shape it takes.
        const server = replayWith(simulation, seed, live.log);
        expect(server.ok).toBe(true);
        if (server.ok) expect(server.result).toEqual(live.result);
      }
    }
  });

  it("notices when the inputs change", () => {
    const live = botRun("typical", 31337);
    const steers = decode(live.log);
    // Hold full right for a second in the middle of the run instead.
    const at = Math.floor(steers.length / 2);
    for (let i = at; i < Math.min(steers.length, at + TICK_HZ); i++) steers[i] = 1;
    const changed = replay(31337, encode(steers));
    const sim = createSim(31337);
    for (const s of steers) { if (sim.done) break; step(sim, s); }
    expect(changed.result).not.toEqual(live.result);
  });

  it("never steers harder or finer than a player can, whatever a log claims", () => {
    const a = createSim(7), b = createSim(7);
    for (let i = 0; i < 120; i++) { step(a, 999); step(b, 1); }
    expect(a.x).toBe(b.x);
    const c = createSim(7), d = createSim(7);
    for (let i = 0; i < 120; i++) { step(c, 0.3001); step(d, Math.round(0.3001 * STEER_SCALE) / STEER_SCALE); }
    expect(c.x).toBe(d.x);
  });

  it("is fed logs the server has already bounds-checked", () => {
    expect(checkInputs([[0, 10], [STEER_SCALE, 5]], RUN_TICKS).ok).toBe(true);
    expect(checkInputs([[STEER_SCALE + 1, 5]], RUN_TICKS).ok).toBe(false);
    expect(checkInputs([[0, RUN_TICKS + 1]], RUN_TICKS).ok).toBe(false);
  });

  it("only calls a log complete when it ends exactly with the run", () => {
    const live = botRun("expert", 99);
    const steers = decode(live.log);
    expect(replay(99, encode(steers.slice(0, steers.length - 30))).complete).toBe(false);
    expect(replay(99, encode([...steers, 0, 0, 0])).complete).toBe(false);
    expect(isDone(createSim(99))).toBe(false);
  });

  it("travels as a compact run-length log", () => {
    const steers = [0, 0, 0, 1, 1, -1, -1, -1, 0];
    expect(encode(steers)).toEqual([[0, 3], [STEER_SCALE, 2], [-STEER_SCALE, 3], [0, 1]]);
    expect(decode(encode(steers))).toEqual(steers);
    const sizes = SEEDS.slice(0, 30).map((s) => botRun("typical", s).log.length);
    // Far fewer entries than the 2,700 ticks of a full run.
    expect(avg(sizes)).toBeLessThan(1500);
  });
});

describe("steering", () => {
  it("is full speed on the first tick a key is down, and stopped on the first tick it is up", () => {
    const sim = createSim(5);
    const x0 = sim.x;
    step(sim, 1);
    expect(sim.x).toBeGreaterThan(x0);
    const v = sim.vx;
    step(sim, 1);
    expect(sim.vx).toBe(v);
    const x1 = sim.x;
    step(sim, 0);
    expect(sim.vx).toBe(0);
    expect(sim.x).toBe(x1);
  });

  it("heads for a target without overshooting it", () => {
    const sim = createSim(5);
    const target = sim.x + 0.04;
    let max = sim.x;
    for (let i = 0; i < 60; i++) { step(sim, steerToward(sim, target)); max = Math.max(max, sim.x); }
    expect(max).toBeLessThanOrEqual(target + 1e-9);
    expect(Math.abs(sim.x - target)).toBeLessThan(0.004);
  });
});

describe("every run is a different run", () => {
  const plans = SEEDS.map((s) => buildRun(s));
  /** The share of runs that have something in the most crowded half-second bucket. */
  const crowding = (times: number[][]) => {
    const counts = new Map<number, number>();
    for (const ts of times) for (const b of new Set(ts.map((t) => Math.floor(t * 2)))) counts.set(b, (counts.get(b) ?? 0) + 1);
    return Math.max(...counts.values()) / times.length;
  };

  it("puts chambers, nonces and hazards somewhere different each time", () => {
    expect(crowding(plans.map((p) => p.chambers.map((c) => c.t)))).toBeLessThan(0.15);
    expect(crowding(plans.map((p) => p.finds.filter((f) => f.kind === "nonce").map((f) => f.t)))).toBeLessThan(0.15);
    expect(crowding(plans.map((p) => p.hazards.filter((h) => h.kind === "rock").map((h) => h.t)))).toBeLessThan(0.3);
    expect(crowding(plans.map((p) => p.hazards.filter((h) => h.kind === "gas").map((h) => h.t)))).toBeLessThan(0.15);
  });

  it("changes the number of chambers, squeezes, veins and hazards, not just their places", () => {
    for (const pick of [(p: (typeof plans)[0]) => p.chambers.length, (p: (typeof plans)[0]) => p.squeezes.length,
                        (p: (typeof plans)[0]) => p.veins.length, (p: (typeof plans)[0]) => p.hazards.length]) {
      expect(new Set(plans.map(pick)).size).toBeGreaterThan(2);
    }
  });

  it("puts nonces on both sides", () => {
    const left = plans.flatMap((p) => p.finds.filter((f) => f.kind === "nonce").map((f) => f.x < p.passage.centreAt(f.t))).filter(Boolean).length;
    const share = left / (plans.length * MAX_NONCES);
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.65);
  });

  it("stays fair while it varies: ore on offer and an expert's score hold a band", () => {
    const offers = plans.map(oreOnOffer);
    expect(Math.max(...offers) - Math.min(...offers)).toBeLessThanOrEqual(10);
    const expert = SEEDS.slice(0, 120).map((s) => botRun("expert", s).result);
    expect(expert.every((r) => r.won)).toBe(true);
    const scores = expert.map((r) => r.score).sort((a, b) => a - b);
    expect(scores[Math.floor(scores.length * 0.1)]!).toBeGreaterThan(150);
  });
});

/**
 * Tuning against the outcome, measured by bots playing the real sim. A win pays
 * 2 Whites and a loss 1, so these bands pin what fairness depends on: how often
 * each kind of player wins, that no layout archetype is the easy (or the
 * impossible) one, and that the best player's expected payout stays well under
 * double a newcomer's.
 */
describe("tuning against the outcome", () => {
  const results = (kind: BotKind, n = 200) => SEEDS.slice(0, n).map((s) => {
    const sim = createSim(s);
    playWith(kind, s, sim, step);
    return { r: resultOf(sim), arch: sim.plan.archetype };
  });
  const first = results("first"), typical = results("typical"), expert = results("expert");
  const winRate = (rs: typeof first) => rs.filter((x) => x.r.won).length / rs.length;

  it("lets a first-timer win a fair share — between a third and a half", () => {
    expect(winRate(first)).toBeGreaterThan(0.3);
    expect(winRate(first)).toBeLessThan(0.55);
  });

  it("has an ordinary player win most runs, and an expert nearly all", () => {
    expect(winRate(typical)).toBeGreaterThan(0.72);
    expect(winRate(typical)).toBeLessThan(0.95);
    expect(winRate(expert)).toBeGreaterThan(0.95);
  });

  it("keeps every archetype near the overall rate for a first-timer", () => {
    const overall = winRate(first);
    for (const arch of new Set(first.map((x) => x.arch))) {
      const rs = first.filter((x) => x.arch === arch);
      if (rs.length < 25) continue;
      expect(Math.abs(winRate(rs) - overall)).toBeLessThan(0.16);
    }
  });

  it("never pays the best player more than about 1.7x a newcomer", () => {
    const payout = (rs: typeof first) => avg(rs.map((x) => (x.r.won ? 2 : 1)));
    expect(payout(expert) / payout(first)).toBeLessThan(1.7);
  });

  it("rewards skill in ore too, and caps it", () => {
    const ore = (rs: typeof first) => avg(rs.map((x) => x.r.score));
    expect(ore(typical)).toBeGreaterThan(ore(first));
    expect(ore(expert)).toBeGreaterThan(ore(typical));
    for (const x of expert) expect(x.r.score).toBeLessThanOrEqual(MAX_ORE_PER_RUN);
    for (const x of first) if (x.r.won) expect(x.r.score).toBeGreaterThanOrEqual(BLOCK_BONUS);
  });
});
