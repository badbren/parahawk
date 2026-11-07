/**
 * Block Hunt auto-players. They play the real sim through the same door a
 * person does — one steering input per tick, via steerToward — so their runs
 * are ordinary input logs that replay like anyone's. Three temperaments stand
 * in for the players the tuning is stated against:
 *
 *   first    notices things late, steers roughly, often walks into trouble
 *   typical  reasonable reactions, dodges most of what it sees
 *   expert   reads the shaft early, threads everything, takes the risky ore
 *
 * Deterministic from (kind, seed), so tests can pin their win rates and score
 * bands, and the headless browser checks can drive the real game with them.
 */
import { type Hazard, type RunPlan, clamp, createRng, laneOf } from "./blockrun.js";
import { type Sim, steerToward, timeOf } from "./sim.js";

export type BotKind = "first" | "typical" | "expert";

interface Temperament {
  /** Seconds ahead a find has to be before the bot goes for it. */
  react: number;
  /** Seconds between decisions; in between it keeps steering for its last target, like a person does. */
  decide: number;
  /** Chance per second of looking away for a moment. */
  lapse: number;
  /** Hardest it steers, as a fraction of full lock. People rarely slam it. */
  grip: number;
  /** How far off its aim lands, as a fraction of the shaft. */
  noise: number;
  /** Chance it sees a given rock, cave-in or stale share in time to step round it. */
  dodge: number;
  /** Seconds ahead it notices gas. */
  gasSense: number;
  /** Chance it goes for the overclock, and for a nonce. */
  boost: number;
  nonce: number;
}

/**
 * Calibrated so the bots catch about the share of finds the skill tuning was
 * stated against — a first-timer roughly a third, an ordinary player a little
 * over half, an expert nine in ten — rather than playing like machines.
 */
const TEMPERAMENT: Record<BotKind, Temperament> = {
  first:   { react: 0.32, decide: 0.22, lapse: 0.55, grip: 0.6, noise: 0.085, dodge: 0.4, gasSense: 0.1, boost: 0.25, nonce: 0.3 },
  typical: { react: 0.42, decide: 0.12, lapse: 0.22, grip: 0.8, noise: 0.05, dodge: 0.75, gasSense: 0.3, boost: 0.55, nonce: 0.6 },
  expert:  { react: 0.6, decide: 0.03, lapse: 0, grip: 1, noise: 0.012, dodge: 0.97, gasSense: 0.7, boost: 1, nonce: 1 },
};

/** Keep a target inside the lane x is in, with a margin off the wall. */
function inLane(plan: RunPlan, t: number, from: number, x: number, margin = 0.025): number {
  const [a, b] = laneOf(plan.passage, t, from);
  return clamp(x, a + margin, b - margin);
}

/** Step a target out of a hazard's way, toward whichever side of its lane has more room. */
function around(plan: RunPlan, hz: Hazard, x: number, margin: number): number {
  const [a, b] = laneOf(plan.passage, hz.t, hz.x);
  const left = hz.x - hz.r - margin, right = hz.x + hz.r + margin;
  const roomLeft = left - a, roomRight = b - right;
  if (x < hz.x && roomLeft > 0.01) return Math.min(x, left);
  if (x >= hz.x && roomRight > 0.01) return Math.max(x, right);
  return roomLeft > roomRight ? left : right;
}

/** A player of the given temperament: call once per tick for the steering it gives. */
export function createBot(kind: BotKind, seed: number): (sim: Sim) => number {
  const rng = createRng((seed ^ 0xb07b07) >>> 0);
  const T = TEMPERAMENT[kind];
  const wantsBoost = rng() < T.boost;
  const skipNonce = new Map<number, boolean>();
  const sees = new Map<number, boolean>();
  const aimNoise = new Map<number, number>();
  let target: number | null = null;
  let nextDecision = 0;
  let lapsedUntil = -1;

  const decide = (sim: Sim): number => {
    const { plan } = sim;
    const t = timeOf(sim);
    let aim = sim.x;

    // The next find worth chasing, once it is close enough to notice.
    for (let i = sim.nextFind; i < plan.finds.length; i++) {
      const f = plan.finds[i]!;
      if (f.t - t > T.react) break;
      if (f.kind === "nonce") {
        if (!skipNonce.has(i)) skipNonce.set(i, rng() >= T.nonce);
        if (skipNonce.get(i)) continue;
      }
      if (!aimNoise.has(i)) aimNoise.set(i, (rng() * 2 - 1) * T.noise);
      aim = f.x + aimNoise.get(i)!;
      break;
    }

    // The overclock, if it is going for it.
    const b = plan.boost;
    if (wantsBoost && b && !sim.boostResolved && b.t - t < T.react && b.t > t) aim = b.x;

    // Stay off the walls, now and a moment ahead.
    aim = inLane(plan, t + 0.12, sim.x, inLane(plan, t, sim.x, aim));

    // Step round what it sees coming.
    for (let i = sim.nextHazard; i < plan.hazards.length; i++) {
      const hz = plan.hazards[i]!;
      if (hz.t - t > T.react) break;
      if (hz.kind === "gas") continue;
      if (!sees.has(i)) sees.set(i, rng() < T.dodge);
      if (!sees.get(i)) continue;
      if (Math.abs(aim - hz.x) < hz.r + 0.02) aim = around(plan, hz, aim, 0.03);
    }

    // Gas: get out of the way of a pocket it has noticed, or out of one it is in.
    for (const hz of plan.hazards) {
      if (hz.kind !== "gas") continue;
      const active = t >= hz.t - T.gasSense && t <= hz.t + hz.span;
      if (active && Math.abs(aim - hz.x) < hz.r + 0.02) aim = inLane(plan, t, sim.x, around(plan, hz, aim, 0.03));
    }
    return aim;
  };

  return (sim) => {
    const t = timeOf(sim);
    // Now and then it looks away; while it does, it keeps doing what it was doing.
    if (T.lapse > 0 && t >= lapsedUntil && rng() < T.lapse / 60) lapsedUntil = t + 0.3 + rng() * 0.4;
    if (t >= lapsedUntil && t >= nextDecision) {
      target = decide(sim);
      nextDecision = t + T.decide;
    }
    if (target === null) return 0;
    const s = steerToward(sim, target);
    return Math.max(-T.grip, Math.min(T.grip, s));
  };
}

/** Play a whole run with a bot. Returns the per-tick steering it gave, for replay checks. */
export function playWith(kind: BotKind, seed: number, sim: Sim, step: (sim: Sim, steer: number) => unknown): number[] {
  const bot = createBot(kind, seed);
  const steers: number[] = [];
  while (!sim.done) {
    const s = bot(sim);
    steers.push(s);
    step(sim, s);
  }
  return steers;
}
