/**
 * Replay — the server's own score for a run.
 *
 * A ranked run sends its server-issued seed (inside the ticket) and its steer
 * log; the server re-runs the game's pure simulation over that log and takes
 * the score, the win/loss and the stats from ITS run. Whatever the client
 * believes it scored is never read.
 *
 * What this proves, and what it does not: replay proves a run is LEGAL for its
 * seed — those exact inputs, on that shaft, produce that result. It does not
 * prove a person played it. A script that knows the seed (the game has to be
 * told it to draw the shaft) can search for good inputs offline and submit
 * them. What bounds that: the score cap per run (MAX_ORE_PER_RUN), the rule
 * that a run cannot be submitted faster than it takes to play, the per-wallet
 * limits on starting and finishing runs, and one fresh random seed per ticket.
 * The board is a PRACTICE board for exactly this reason.
 */
import { STEER_SCALE, type SteerLog } from "./inputs.js";
import { simulation as blockHunt } from "./sim.js";

/** What a finished run produced. */
export interface RunResult {
  score: number;
  won: boolean;
  nonces: number;
  stale: number;
  scrapes: number;
  /** Ticks the run lasted. */
  ticks: number;
}

/** What replay needs from the simulation. src/game/sim.ts provides it (`simulation`). */
export interface Simulation<S = unknown> {
  /** Fixed simulation rate. */
  readonly TICK_HZ: number;
  createSim(seed: number): S;
  step(sim: S, steer: number): void;
  resultOf(sim: S): RunResult;
  /** True once the run is over — the block broken into, or the run lost. */
  isDone(sim: S): boolean;
}

/** No run lasts longer than this much simulated time; logs past it are refused before replay. */
export const MAX_RUN_SECONDS = 120;

export const maxTicksFor = (sim: Pick<Simulation, "TICK_HZ">): number => Math.ceil(sim.TICK_HZ * MAX_RUN_SECONDS);

/**
 * The simulation ranked runs are replayed with: Block Hunt itself, the same
 * module the browser plays (src/game/sim.ts). The route keeps a null path for
 * a build without one, where ranked runs are refused rather than scored by
 * anything else.
 */
export function simulation(): Simulation | null {
  return blockHunt as Simulation;
}

export type ReplayOutcome = { ok: true; result: RunResult } | { ok: false; error: string };

/**
 * Replay a checked log (see checkInputs) on a seed. Ticks after the run ends
 * are ignored; a log that ends before the run does is refused — a ranked run
 * has to be played to its end.
 */
export function replayWith<S>(sim: Simulation<S>, seed: number, log: SteerLog): ReplayOutcome {
  const state = sim.createSim(seed);
  outer: for (const [k, count] of log) {
    const steer = k / STEER_SCALE;
    for (let i = 0; i < count; i++) {
      if (sim.isDone(state)) break outer;
      sim.step(state, steer);
    }
  }
  if (!sim.isDone(state)) return { ok: false, error: "the inputs end before the run does" };
  return { ok: true, result: sim.resultOf(state) };
}

/** Replay with the wired simulation. */
export function replay(seed: number, log: SteerLog): ReplayOutcome {
  const sim = simulation();
  return sim ? replayWith(sim, seed, log) : { ok: false, error: "ranked runs are not open yet" };
}
