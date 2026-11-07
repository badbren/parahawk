/**
 * Block Hunt — the simulation. A run, one fixed tick at a time.
 *
 * This is the whole game as far as the score is concerned: steering, walls and
 * scrapes, every hazard, the lamp, pickups, the overclock, the multiplier and
 * the win or loss. It is pure — no DOM, no clocks, no Math.random, no frame
 * times — so the browser and the server run exactly the same thing, and a run
 * is nothing but its seed and the steering the player gave each tick. The
 * server can replay that log and get the same result to the last bit, which is
 * what makes a score impossible to fake.
 *
 * PUBLIC API — kept stable; the server's replay (src/game/replay.ts) is built against it.
 *
 *   TICK_HZ                    ticks per second of run time (60). A full run is RUN_TICKS.
 *   createSim(seed)            a fresh run, at tick 0.
 *   step(sim, steer)           advance exactly one tick. `steer` is -1..1 (full left .. full
 *                              right), on the 1/256 grid of src/game/inputs.ts; anything else is
 *                              clamped and snapped to it, so a tampered log can never steer
 *                              harder or finer than a player can. Returns what happened.
 *   isDone(sim)                the run is over: the block broken into, or the lamp out.
 *   resultOf(sim)              { score, won, nonces, stale, scrapes, ticks, ... } — score via bankableScore.
 *   steerToward(sim, x)        the steering that heads for x this tick: what mouse, touch and bots send.
 *   replay(seed, log)          a SteerLog (inputs.ts) run to the end, and whether it was exactly one run.
 *   simulation                 { TICK_HZ, createSim, step, resultOf, isDone } — the Simulation replay.ts takes.
 *
 * Inputs travel as inputs.ts's run-length encoded SteerLog: record each tick
 * with createSteerRecorder().push(raw) and step the sim with the value it
 * returns — that is exactly what the server will replay.
 *
 * A run ends the tick the lamp goes out (a loss) or the tick it reaches the
 * block with light left (a win). A complete log has exactly one steer per tick
 * up to and including that tick.
 */
import {
  CATCH_RADIUS,
  DAMAGE,
  GAS_DRAIN_PER_SECOND,
  LAMP_FROM_NONCE,
  LAMP_FROM_OVERCLOCK,
  LAMP_LOW,
  LAMP_MAX,
  MULT_STEP_STREAK,
  OVERCLOCK_REACH,
  OVERCLOCK_SECONDS,
  RUN_SECONDS,
  type FindKind,
  type HazardKind,
  type RunPlan,
  adjustmentAt,
  buildRun,
  clamp,
  findValue,
  hazardCovers,
  laneOf,
  multiplierFor,
  runOre,
  stratumIndexAt,
} from "./blockrun.js";
import { STEER_SCALE, type SteerLog, quantizeSteer } from "./inputs.js";

export const TICK_HZ = 60;
export const RUN_TICKS = RUN_SECONDS * TICK_HZ;
/**
 * Lateral speed at full steer, in shaft-widths per second. Steering is
 * immediate both ways: full speed the first tick a key is down, stopped dead
 * the first tick it is up. Nothing glides, so nothing overshoots — the
 * smoothness on screen comes from the renderer interpolating between ticks.
 */
export const MOVE_SPEED = 1.45;
/** How hard steerToward chases its target: per second, ~25 ms time constant. */
const FOLLOW = 40;
/** Ticks before scraping the same wall can cost again. */
const SCRAPE_GRACE_TICKS = 42;

/** What one tick can produce, for the screen and the speakers. Order within a tick is the order it happened. */
export type SimEvent =
  | { type: "find"; index: number; kind: FindKind; gain: number; multUp: boolean }
  | { type: "miss"; index: number }
  | { type: "hazard"; index: number; kind: Exclude<HazardKind, "gas">; damage: number }
  | { type: "gas"; index: number }
  | { type: "scrape"; side: -1 | 1; damage: number }
  | { type: "boost"; lamp: number }
  | { type: "lamp"; amount: number }
  | { type: "lampLow" }
  | { type: "stratum"; index: number }
  | { type: "adjust"; level: number }
  | { type: "win" }
  | { type: "lose" };

export interface Sim {
  readonly plan: RunPlan;
  /** Ticks played. Run time is tick / TICK_HZ. */
  tick: number;
  /** Position across the shaft, 0..1, and lateral speed in shaft-widths per second. */
  x: number;
  vx: number;
  lamp: number;
  /** Raw score: hashes and nonces at their multiplied value. Banked via resultOf. */
  score: number;
  streak: number;
  bestStreak: number;
  found: number;
  nonces: number;
  scrapes: number;
  hits: Record<HazardKind, number>;
  /** Next unresolved find and hazard, in time order. */
  nextFind: number;
  nextHazard: number;
  /** Finds caught, by index. */
  caught: boolean[];
  /** Gas pockets already counted, by hazard index. */
  gassed: boolean[];
  /** True while the mite is breathing gas this tick. */
  inGas: boolean;
  boostResolved: boolean;
  overclockUntil: number;
  overclocked: boolean;
  scrapeCooldown: number;
  lampWarned: boolean;
  stratum: number;
  adjustments: number;
  done: boolean;
  won: boolean;
  lostAtTick: number | null;
}

export interface SimResult {
  /** Ore banked: hashes and nonces carried, plus the block bonus on a win. Already capped. */
  score: number;
  won: boolean;
  nonces: number;
  /** Stale shares touched. */
  stale: number;
  scrapes: number;
  /** Ticks played: RUN_TICKS on a win, fewer on a loss. */
  ticks: number;
  found: number;
  hits: Record<HazardKind, number>;
  lamp: number;
  overclocked: boolean;
  bestStreak: number;
}

export function createSim(seed: number): Sim {
  const plan = buildRun(seed >>> 0);
  return {
    plan,
    tick: 0,
    x: plan.passage.centreAt(0),
    vx: 0,
    lamp: LAMP_MAX,
    score: 0,
    streak: 0,
    bestStreak: 0,
    found: 0,
    nonces: 0,
    scrapes: 0,
    hits: { stale: 0, rock: 0, cavein: 0, gas: 0 },
    nextFind: 0,
    nextHazard: 0,
    caught: plan.finds.map(() => false),
    gassed: plan.hazards.map(() => false),
    inGas: false,
    boostResolved: plan.boost === null,
    overclockUntil: -1,
    overclocked: false,
    scrapeCooldown: 0,
    lampWarned: false,
    stratum: 0,
    adjustments: 0,
    done: false,
    won: false,
    lostAtTick: null,
  };
}

/** Run time of the sim's current tick, in seconds. */
export const timeOf = (sim: Pick<Sim, "tick">): number => sim.tick / TICK_HZ;

/** Steering in range and on the wire's grid, whatever arrived. */
export const cleanSteer = (steer: number): number => quantizeSteer(steer) / STEER_SCALE;

const hurt = (sim: Sim, amount: number, events: SimEvent[]) => {
  sim.lamp = Math.max(0, sim.lamp - amount);
  if (!sim.lampWarned && sim.lamp > 0 && sim.lamp < LAMP_LOW) {
    sim.lampWarned = true;
    events.push({ type: "lampLow" });
  }
};

const refill = (sim: Sim, amount: number, events: SimEvent[]) => {
  const before = sim.lamp;
  sim.lamp = Math.min(LAMP_MAX, sim.lamp + amount);
  if (sim.lamp >= LAMP_LOW) sim.lampWarned = false;
  if (sim.lamp > before) events.push({ type: "lamp", amount: sim.lamp - before });
};

/** Advance exactly one tick with this steering. A finished sim does nothing. */
export function step(sim: Sim, steer: number): SimEvent[] {
  const events: SimEvent[] = [];
  if (sim.done) return events;
  const { plan } = sim;
  const { passage } = plan;
  const s = cleanSteer(steer);

  sim.tick++;
  const t = sim.tick / TICK_HZ;

  // ── Steering: exactly what the input asks for, this tick ──────────────────
  sim.vx = s * MOVE_SPEED;
  const lane = laneOf(passage, t, sim.x);
  sim.x = clamp(sim.x + sim.vx / TICK_HZ, 0, 1);

  // ── Walls: you cannot enter rock. Scraping costs the streak and some light ─
  sim.scrapeCooldown = Math.max(0, sim.scrapeCooldown - 1);
  if (sim.x < lane[0] || sim.x > lane[1]) {
    const side: -1 | 1 = sim.x > lane[1] ? 1 : -1;
    sim.x = clamp(sim.x, lane[0], lane[1]);
    sim.vx = 0;
    if (sim.scrapeCooldown === 0) {
      sim.scrapeCooldown = SCRAPE_GRACE_TICKS;
      sim.scrapes++;
      sim.streak = 0;
      events.push({ type: "scrape", side, damage: DAMAGE.scrape });
      hurt(sim, DAMAGE.scrape, events);
    }
  }

  // ── Hazards that reach you this tick ──────────────────────────────────────
  while (sim.nextHazard < plan.hazards.length && plan.hazards[sim.nextHazard]!.t <= t) {
    const i = sim.nextHazard++;
    const hz = plan.hazards[i]!;
    if (hz.kind === "gas" || !hazardCovers(hz, sim.x)) continue;
    sim.hits[hz.kind]++;
    sim.streak = 0;
    events.push({ type: "hazard", index: i, kind: hz.kind, damage: DAMAGE[hz.kind] });
    hurt(sim, DAMAGE[hz.kind], events);
  }

  // ── Gas drains the lamp for as long as you are in it ──────────────────────
  sim.inGas = false;
  for (let i = 0; i < plan.hazards.length; i++) {
    const hz = plan.hazards[i]!;
    if (hz.kind !== "gas" || t < hz.t || t > hz.t + hz.span || !hazardCovers(hz, sim.x)) continue;
    sim.inGas = true;
    if (!sim.gassed[i]) {
      sim.gassed[i] = true;
      sim.hits.gas++;
      sim.streak = 0;
      events.push({ type: "gas", index: i });
    }
    hurt(sim, GAS_DRAIN_PER_SECOND / TICK_HZ, events);
  }

  // ── The overclock ─────────────────────────────────────────────────────────
  const b = plan.boost;
  if (b && !sim.boostResolved && b.t <= t) {
    sim.boostResolved = true;
    if (Math.abs(sim.x - b.x) <= CATCH_RADIUS) {
      sim.overclockUntil = t + OVERCLOCK_SECONDS;
      sim.overclocked = true;
      events.push({ type: "boost", lamp: LAMP_FROM_OVERCLOCK });
      refill(sim, LAMP_FROM_OVERCLOCK, events);
    }
  }

  // ── Finds that reach you this tick ────────────────────────────────────────
  const reach = CATCH_RADIUS * (t < sim.overclockUntil ? OVERCLOCK_REACH : 1);
  while (sim.nextFind < plan.finds.length && plan.finds[sim.nextFind]!.t <= t) {
    const i = sim.nextFind++;
    const f = plan.finds[i]!;
    if (Math.abs(sim.x - f.x) > reach) { events.push({ type: "miss", index: i }); continue; }
    const before = multiplierFor(sim.streak);
    const gain = findValue(f, sim.streak);
    sim.score += gain;
    sim.streak++;
    sim.bestStreak = Math.max(sim.bestStreak, sim.streak);
    sim.found++;
    sim.caught[i] = true;
    events.push({ type: "find", index: i, kind: f.kind, gain, multUp: multiplierFor(sim.streak) > before });
    if (f.kind === "nonce") { sim.nonces++; refill(sim, LAMP_FROM_NONCE, events); }
  }

  // ── Layers and difficulty adjustments ─────────────────────────────────────
  const si = stratumIndexAt(plan, t);
  if (si !== sim.stratum) { sim.stratum = si; events.push({ type: "stratum", index: si }); }
  const adj = adjustmentAt(plan, t);
  if (adj > sim.adjustments) { sim.adjustments = adj; events.push({ type: "adjust", level: adj }); }

  // ── The end ───────────────────────────────────────────────────────────────
  if (sim.lamp <= 0) {
    sim.done = true;
    sim.won = false;
    sim.lostAtTick = sim.tick;
    events.push({ type: "lose" });
  } else if (sim.tick >= RUN_TICKS) {
    sim.done = true;
    sim.won = true;
    events.push({ type: "win" });
  }
  return events;
}

export function resultOf(sim: Sim): SimResult {
  return {
    score: runOre(sim.score, sim.won),
    won: sim.won,
    nonces: sim.nonces,
    stale: sim.hits.stale,
    scrapes: sim.scrapes,
    ticks: sim.tick,
    found: sim.found,
    hits: { ...sim.hits },
    lamp: Math.ceil(sim.lamp),
    overclocked: sim.overclocked,
    bestStreak: sim.bestStreak,
  };
}

/** Pointer and bot steering moves in steps of this much of full lock: fine enough to be smooth, coarse enough to log small. */
const STEER_STEP = 1 / 32;

/**
 * The steering that heads for x this tick: proportional, rounded toward zero,
 * so it closes in without ever overshooting and settles within one step (under
 * a pixel) instead of buzzing. Mouse, touch and every bot steer through this,
 * so all of them produce the same kind of input log a keyboard does.
 */
export function steerToward(sim: Pick<Sim, "x">, targetX: number): number {
  const want = ((targetX - sim.x) * FOLLOW) / MOVE_SPEED;
  return clamp(Math.trunc(want / STEER_STEP) * STEER_STEP, -1, 1);
}

export const isDone = (sim: Pick<Sim, "done">): boolean => sim.done;

export interface Replay {
  result: SimResult;
  /** The log ended exactly when the run did: not short, not padded. */
  complete: boolean;
}

/** Play a SteerLog against a seed from the start. */
export function replay(seed: number, log: SteerLog): Replay {
  const sim = createSim(seed);
  let used = 0, extra = false;
  outer: for (const [k, n] of log) {
    for (let i = 0; i < n; i++) {
      if (sim.done) { extra = true; break outer; }
      step(sim, k / STEER_SCALE);
      used++;
    }
  }
  return { result: resultOf(sim), complete: sim.done && !extra && used === sim.tick };
}

/** The shape src/game/replay.ts replays ranked runs with. */
export const simulation = {
  TICK_HZ,
  createSim,
  step: (sim: Sim, steer: number): void => { step(sim, steer); },
  resultOf,
  isDone,
};

/** The streak needed for the next multiplier step, for HUDs: 0..MULT_STEP_STREAK-1 pips lit. */
export const streakPips = (sim: Pick<Sim, "streak">): number => sim.streak % MULT_STEP_STREAK;
