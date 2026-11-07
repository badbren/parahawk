import { describe, expect, it } from "vitest";
import { createBot, type BotKind } from "./bots.js";
import { createSteerRecorder, type SteerLog } from "./inputs.js";
import { maxTicksFor, replay, replayWith, simulation, type Simulation } from "./replay.js";
import { createSim, resultOf, step, TICK_HZ } from "./sim.js";

/**
 * A stand-in for src/game/sim.ts: deterministic, seeded, and sensitive to
 * every input, which is all replay needs to be tested against.
 */
interface Stub { x: number; tick: number; score: number; scrapes: number; seed: number }
const STUB_TICKS = 300;
const stub: Simulation<Stub> = {
  TICK_HZ: 10,
  createSim: (seed) => ({ x: 0.5, tick: 0, score: 0, scrapes: 0, seed }),
  step(s, steer) {
    s.x = Math.min(1, Math.max(0, s.x + steer * 0.05));
    if (s.x === 0 || s.x === 1) s.scrapes += 1;
    if (Math.abs(s.x - target(s)) < 0.12) s.score += 1;
    s.tick += 1;
  },
  isDone: (s) => s.tick >= STUB_TICKS,
  resultOf: (s) => ({ score: s.score, won: s.score >= 150, nonces: 0, stale: 0, scrapes: s.scrapes, ticks: s.tick }),
};
const target = (s: Stub) => 0.5 + 0.4 * Math.sin((s.tick + (s.seed % 997)) / 9);

/** Play a whole run with a policy, recording it the way the game will. */
function play(seed: number, policy: (s: Stub) => number) {
  const rec = createSteerRecorder();
  const s = stub.createSim(seed);
  while (!stub.isDone(s)) stub.step(s, rec.push(policy(s)));
  return { log: rec.log(), result: stub.resultOf(s) };
}
const chase = (s: Stub) => Math.max(-1, Math.min(1, (target(s) - s.x) / 0.05));

describe("replay", () => {
  it("scores a recorded log exactly as it was played", () => {
    const { log, result } = play(4242, chase);
    expect(result.won).toBe(true);
    expect(replayWith(stub, 4242, log)).toEqual({ ok: true, result });
  });

  it("gives a different result when the inputs are tampered with", () => {
    const { log, result } = play(4242, chase);
    // Steer the opposite way for the whole run.
    const tampered: SteerLog = log.map(([k, n]) => [-k || 256, n]);
    const out = replayWith(stub, 4242, tampered);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result).not.toEqual(result);
  });

  it("scores the same log differently on another seed — the ticket's seed is the one that counts", () => {
    const { log, result } = play(4242, chase);
    const out = replayWith(stub, 777, log);
    expect(out.ok && out.result.score).not.toBe(result.score);
  });

  it("refuses a log that ends before the run does", () => {
    const { log } = play(1, chase);
    const short = log.slice(0, Math.max(1, log.length - 3));
    expect(replayWith(stub, 1, short)).toEqual({ ok: false, error: "the inputs end before the run does" });
  });

  it("ignores ticks after the run has ended", () => {
    const { log, result } = play(9, chase);
    expect(replayWith(stub, 9, [...log, [0, 50]])).toEqual({ ok: true, result });
  });

  it("is wired to Block Hunt itself", () => {
    expect(simulation()?.TICK_HZ).toBe(TICK_HZ);
  });

  it("bounds a run's length by the simulation's own rate", () => {
    expect(maxTicksFor(stub)).toBe(1200);
  });
});

/** Play a real run the way the browser does: a bot steering, every tick through the recorder. */
function playReal(kind: BotKind, seed: number) {
  const rec = createSteerRecorder();
  const sim = createSim(seed);
  const bot = createBot(kind, seed);
  while (!sim.done) step(sim, rec.push(bot(sim)));
  return { log: rec.log(), result: resultOf(sim) };
}

describe("replay with the real simulation", () => {
  it("scores recorded runs exactly as they were played, for every kind of player", () => {
    for (const kind of ["first", "typical", "expert"] as const) {
      for (const seed of [1, 2024, 0xdeadbeef]) {
        const { log, result } = playReal(kind, seed);
        const out = replay(seed, log);
        expect(out.ok, `${kind}/${seed}`).toBe(true);
        if (out.ok) expect(out.result).toMatchObject({
          score: result.score, won: result.won, nonces: result.nonces, stale: result.stale, scrapes: result.scrapes, ticks: result.ticks,
        });
      }
    }
  });

  it("does not hand a tampered log the original's result", () => {
    const { log, result } = playReal("expert", 31337);
    const mirrored: SteerLog = log.map(([k, n]) => [-k, n]);
    const out = replay(31337, mirrored);
    if (out.ok) expect(out.result).not.toMatchObject({ score: result.score, ticks: result.ticks, scrapes: result.scrapes });
    else expect(out.error).toMatch(/end before the run/);
  });

  it("scores a log on the ticket's seed, not the one it was played on", () => {
    const { log, result } = playReal("expert", 99);
    const out = replay(100, log);
    if (out.ok) expect(out.result).not.toMatchObject({ score: result.score, ticks: result.ticks });
    else expect(out.error).toMatch(/end before the run/);
  });

  it("refuses a real run cut short", () => {
    const { log } = playReal("typical", 5);
    const half: SteerLog = [[log[0]![0], Math.max(1, Math.floor(log[0]![1] / 2))]];
    expect(replay(5, half).ok).toBe(false);
  });
});
