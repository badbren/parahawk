/**
 * Block Hunt — the layout of a run. Pure, deterministic, no DOM.
 *
 * A run is 45 seconds down a mineshaft toward a block at the bottom. This file
 * builds everything about one run from a single 32-bit seed: the shape of the
 * shaft (one of a few archetypes, with its own chambers, squeezes, ore veins
 * and maybe a fork), where the hashes and nonces lie, where the hazards wait,
 * and where each stratum — each difficulty adjustment — begins. sim.ts plays a
 * run tick by tick against this plan; the shell only draws it.
 *
 * Shared by the browser and the server, so a run can be replayed and scored
 * where the player cannot touch it. That makes two rules absolute here:
 *
 *  - **Same seed, same run, on every machine.** All randomness is xorshift32
 *    off the seed. All trigonometry goes through dsin(), which uses only + - *
 *    and /, so Chrome, Firefox, Safari and Node agree to the last bit. Never
 *    use Math.random(), Math.sin(), Math.exp() or Math.pow() in game logic.
 *  - **Different seed, different run.** Not just different wiggles: different
 *    structure, so nobody can learn a run by heart. sim.test.ts pins the
 *    variety and pins the fairness band that keeps that variety fair.
 */
import { MAX_ORE_PER_RUN } from "../econ/tokenomics.js";

export const RUN_SECONDS = 45;
/** The closing stretch where finds pay double and the block is in sight. */
export const BLOCK_WINDOW_SECONDS = 8;
/** The final chamber. The passage opens out and the grail is just there. */
export const VAULT_SECONDS = 4.5;

export const HASH_VALUE = 1;
/** The rare find. Off the easy line — in a chamber, a squeeze, or the rich side of a fork. */
export const NONCE_VALUE = 10;
export const MAX_NONCES = 3;

/** Clean finds needed for each step up the multiplier. */
export const MULT_STEP_STREAK = 8;
export const MULT_STEP = 0.25;
export const MAX_MULT = 1.75;
export const BLOCK_WINDOW_MULT = 2;
/** Paid on breaking into the block — a win. A lamp that goes out never gets it. */
export const BLOCK_BONUS = 67;
/** A find is collected within this fraction of the shaft. */
export const CATCH_RADIUS = 0.062;

// ── The lamp ────────────────────────────────────────────────────────────────

/** A full lamp. Hit zero before the block and the run is lost. */
export const LAMP_MAX = 100;
/** What each knock costs the lamp. */
export const DAMAGE = { stale: 5, rock: 30, cavein: 32, scrape: 9 } as const;
/** Lamp drained per second spent inside a gas pocket. */
export const GAS_DRAIN_PER_SECOND = 24;
/** Lamp restored by a nonce, and by the overclock. Worth the detour toward the wall. */
export const LAMP_FROM_NONCE = 12;
export const LAMP_FROM_OVERCLOCK = 20;
/** Below this the lamp warns you. */
export const LAMP_LOW = 30;

// ── Hazards ─────────────────────────────────────────────────────────────────

export type HazardKind = "stale" | "rock" | "cavein" | "gas";
/** How much of the shaft each kind covers either side of its centre. */
export const HAZARD_RADIUS = { stale: 0.042, rock: 0.05 } as const;
/** The narrowest gap any hazard leaves open, as a fraction of the shaft. */
export const HAZARD_GAP = 0.075;
/** How long a gas pocket hangs in the passage, in seconds of travel. */
export const GAS_SPAN = 1.15;

/**
 * The overclock: one per run, out toward a wall in the deep rock. Catch it and
 * for a few seconds you reach finds from much further away.
 */
export const OVERCLOCK_SECONDS = 4;
/** How much wider your reach is while overclocked. */
export const OVERCLOCK_REACH = 1.9;

/** Half-width of the vault at the very bottom. */
const VAULT_HALF_WIDTH = 0.46;
/** No passage is ever narrower than this either side of its centre. */
export const MIN_HALF_WIDTH = 0.085;
/** Each side of a fork is at least this wide. */
export const MIN_LANE = 0.09;

const GLYPHS = "0123456789abcdef";

// ── Deterministic maths ─────────────────────────────────────────────────────

const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
const TWO_PI = 6.283185307179586;

/**
 * Sine from + - * / only, so every JS engine computes the same bits. Math.sin
 * is implementation-defined; a replay on the server must not disagree with the
 * browser about which side of a wall the mite was on. Accurate to ~1e-11.
 */
export function dsin(x: number): number {
  const k = Math.floor(x / TWO_PI + 0.5);
  let r = x - k * TWO_PI;
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  return r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800 + r2 * (1 / 6227020800 + r2 * (-1 / 1307674368000))))))));
}

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (t: number): number => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

/**
 * Scramble a seed (murmur3's finaliser) so neighbouring seeds start their
 * streams far apart — without it, seeds 1, 2, 3 all opened on the same shape.
 * Integer maths only (Math.imul is exact), so it is the same everywhere.
 */
function mixSeed(seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** xorshift32 — small, fast, identical in every JS engine. */
export function createRng(seed: number): () => number {
  let s = mixSeed(seed) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

// ── Strata ──────────────────────────────────────────────────────────────────

/** The layers you descend through, in order. Where each begins comes from the seed. */
export const STRATA = [
  { name: "Surface rock", accent: "#6f7a63" },
  { name: "The mempool", accent: "#8fd14f" },
  { name: "Deep rock", accent: "#a08050" },
  { name: "The vein", accent: "#ffd24a" },
  { name: "The vault", accent: "#ffe9a3" },
] as const;

export type Stratum = (typeof STRATA)[number];

/**
 * Seconds of passage visible below the mite, per stratum. The view is a fixed
 * height, so a shorter lookahead means the shaft rises to meet you faster and
 * there is less time to react: each new layer is a difficulty adjustment. The
 * vault opens back out so arriving at the block reads as arriving, not a crash.
 */
export const VIEW_AHEAD_BY_STRATUM = [3.2, 2.75, 2.35, 1.95, 3.4] as const;
export const VIEW_AHEAD_TOP = VIEW_AHEAD_BY_STRATUM[0];
export const VIEW_AHEAD_FASTEST = 1.95;
/** Seconds each speed-up takes to bite in, so it is felt as a surge, not a jolt. */
const ADJUST_SECONDS = 1.4;
/** The vault always starts here: the last VAULT_SECONDS belong to the block. */
export const VAULT_FROM = (RUN_SECONDS - VAULT_SECONDS) / RUN_SECONDS;

// ── The plan ────────────────────────────────────────────────────────────────

/**
 * The few shapes a shaft can take, so runs feel different rather than being
 * the same descent with the walls nudged:
 *  - winding:  long sweeping bends, a couple of chambers
 *  - zigzag:   tight, fast switchbacks in a narrower shaft
 *  - caverns:  a slow wander through big chambers with squeezes between
 *  - forked:   a section splits round a pillar — one side tight and rich, one wide and safe
 */
export type Archetype = "winding" | "zigzag" | "caverns" | "forked";
export const ARCHETYPES: readonly Archetype[] = ["winding", "zigzag", "caverns", "forked"];

/** A smooth swelling (or narrowing) of the passage around time t, `w` seconds either side. */
export interface Bump { t: number; w: number; size: number }

/** A pillar splitting the passage in two between t0 and t1. `rich` is the tight, loaded side. */
export interface Fork { t0: number; t1: number; rich: -1 | 1; width: number }

export type FindKind = "hash" | "nonce";

export interface Find {
  /** Seconds into the run when this reaches the miner. */
  t: number;
  /** Position across the shaft, 0..1. Always inside an open lane. */
  x: number;
  kind: FindKind;
  value: number;
  /** Character drawn for the find. Cosmetic. */
  glyph: string;
}

/**
 * Something in the shaft that costs you light.
 *  - stale:  a stale share. Small; costs your streak and a little light.
 *  - rock:   a boulder that has come down the shaft and lodged ahead of you.
 *  - cavein: rubble slumped off one wall, closing part of the passage.
 *  - gas:    firedamp over part of the passage for a stretch; drains while you are in it.
 * Every one sits inside an open lane and leaves at least HAZARD_GAP to pass.
 */
export interface Hazard {
  kind: HazardKind;
  /** When it reaches the miner. For gas, when the pocket starts. */
  t: number;
  /** How long it lasts, in seconds of travel. Only gas has one. */
  span: number;
  /** Centre across the shaft, 0..1. */
  x: number;
  /** Half of the width it covers, as a fraction of the shaft. */
  r: number;
  /** Which wall a cave-in comes off: -1 left, 1 right. 0 for everything else. */
  side: -1 | 0 | 1;
}

/** True when a miner at x is inside the hazard's reach. */
export const hazardCovers = (h: Hazard, x: number): boolean => Math.abs(x - h.x) < h.r;

/** The overclock pickup. */
export interface Boost { t: number; x: number }

/** The passage geometry, sampled at any moment of the run. */
export interface Passage {
  /** Centre of the passage at time t, 0..1. */
  centreAt(t: number): number;
  /** Half-width of the passage at time t, as a fraction of the shaft. */
  halfWidthAt(t: number): number;
  /** Half-width of the fork's pillar at time t (0 when there is no pillar here). */
  pillarAt(t: number): number;
  /** The open lanes at time t, left to right: one, or two either side of a pillar. */
  lanesAt(t: number): Array<[number, number]>;
  /** How much of a chamber this moment is, 0..1. */
  bulgeAt(t: number): number;
}

export interface RunPlan {
  seed: number;
  archetype: Archetype;
  passage: Passage;
  /** When each stratum begins, as seconds into the run. strataFrom[0] is 0; [4] is the vault. */
  strataFrom: readonly number[];
  chambers: readonly Bump[];
  squeezes: readonly Bump[];
  /** Stretches where ore runs thick: finds come close together. */
  veins: ReadonlyArray<{ t: number; dur: number }>;
  fork: Fork | null;
  finds: Find[];
  /** In time order. Never in the surface rock or the vault. */
  hazards: Hazard[];
  /** At most one a run. */
  boost: Boost | null;
  windowOpensAt: number;
  vaultOpensAt: number;
}

const bumpAt = (t: number, b: Bump): number => {
  const u = (t - b.t) / b.w;
  if (u <= -1 || u >= 1) return 0;
  const v = 1 - u * u;
  return b.size * v * v;
};

/** Which stratum time t falls in, for a plan's boundaries. */
export function stratumIndexAt(plan: Pick<RunPlan, "strataFrom">, t: number): number {
  let i = 0;
  for (let k = 0; k < plan.strataFrom.length; k++) if (t >= plan.strataFrom[k]!) i = k;
  return i;
}
export const stratumAt = (plan: Pick<RunPlan, "strataFrom">, t: number): Stratum => STRATA[stratumIndexAt(plan, t)]!;

/** How far ahead you can see at time t, in seconds of travel: the descent's speed. */
export function viewAheadAt(plan: Pick<RunPlan, "strataFrom">, t: number): number {
  const i = stratumIndexAt(plan, t);
  const now = VIEW_AHEAD_BY_STRATUM[i]!;
  if (i === 0) return now;
  return lerp(VIEW_AHEAD_BY_STRATUM[i - 1]!, now, smooth((t - plan.strataFrom[i]!) / ADJUST_SECONDS));
}

/** Which difficulty adjustment you are in: 0 at the surface, up to 3 in the vein. */
export const adjustmentAt = (plan: Pick<RunPlan, "strataFrom">, t: number): number => Math.min(3, stratumIndexAt(plan, t));

export const isChamber = (passage: Passage, t: number): boolean => passage.bulgeAt(t) >= 0.5;

interface Shape {
  amp: [number, number, number];
  freq: [number, number, number];
  widthTop: number;
  widthDeep: number;
}

/** Pick a value in [lo, hi). */
const range = (rng: () => number, lo: number, hi: number) => lo + rng() * (hi - lo);

function shapeFor(arch: Archetype, rng: () => number): Shape {
  switch (arch) {
    case "zigzag":
      return { amp: [range(rng, 0.1, 0.13), range(rng, 0.11, 0.14), range(rng, 0.045, 0.065)],
               freq: [range(rng, 0.85, 1.0), range(rng, 1.5, 1.8), range(rng, 2.5, 2.9)], widthTop: 0.29, widthDeep: 0.14 };
    case "caverns":
      return { amp: [range(rng, 0.16, 0.2), range(rng, 0.07, 0.1), range(rng, 0.03, 0.05)],
               freq: [range(rng, 0.34, 0.44), range(rng, 0.8, 1.0), range(rng, 1.6, 1.9)], widthTop: 0.31, widthDeep: 0.125 };
    default:
      return { amp: [range(rng, 0.21, 0.26), range(rng, 0.1, 0.14), range(rng, 0.04, 0.06)],
               freq: [range(rng, 0.5, 0.6), range(rng, 1.05, 1.2), range(rng, 1.95, 2.2)], widthTop: 0.3, widthDeep: 0.12 };
  }
}

/** Spread `n` non-overlapping bumps over [from, to], each `w` seconds either side. */
function spreadBumps(rng: () => number, n: number, from: number, to: number, w: [number, number], size: [number, number]): Bump[] {
  const out: Bump[] = [];
  if (n <= 0) return out;
  const slot = (to - from) / n;
  for (let i = 0; i < n; i++) {
    const bw = range(rng, w[0], w[1]);
    const lo = from + slot * i + bw, hi = from + slot * (i + 1) - bw;
    out.push({ t: hi > lo ? range(rng, lo, hi) : (lo + hi) / 2, w: bw, size: range(rng, size[0], size[1]) });
  }
  return out;
}

/** Build the shaft for a seed: its archetype, shape, chambers, squeezes, veins and fork. */
export function buildRun(seed: number): RunPlan {
  const rng = createRng(seed ^ 0x5bf03635);
  const archetype = ARCHETYPES[Math.floor(rng() * ARCHETYPES.length)]!;
  const shape = shapeFor(archetype, rng);
  const phase = [rng() * TWO_PI, rng() * TWO_PI, rng() * TWO_PI];
  const vaultOpensAt = RUN_SECONDS - VAULT_SECONDS;

  // Where each layer begins moves from run to run; the order never does —
  // surface first, the vault last, which is the story of the descent.
  const strataFrom = [0, range(rng, 0.16, 0.25) * RUN_SECONDS, range(rng, 0.4, 0.5) * RUN_SECONDS, range(rng, 0.63, 0.74) * RUN_SECONDS, VAULT_FROM * RUN_SECONDS];

  // Chambers, squeezes and veins: how many, where and how big all come from the seed.
  const nChambers = archetype === "caverns" ? 3 + Math.floor(rng() * 3) : archetype === "zigzag" ? 1 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2);
  const chamberSize: [number, number] = archetype === "caverns" ? [0.15, 0.21] : [0.11, 0.16];
  const chamberW: [number, number] = archetype === "caverns" ? [1.2, 1.9] : [0.8, 1.3];
  const chambers = spreadBumps(rng, nChambers, 3, vaultOpensAt - 2, chamberW, chamberSize);
  const nSqueeze = archetype === "zigzag" ? 2 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 2);
  const squeezes = spreadBumps(rng, nSqueeze, 8, vaultOpensAt - 3, [0.7, 1.2], [0.03, 0.06]);
  const nVeins = 1 + Math.floor(rng() * 3);
  const veins = spreadBumps(rng, nVeins, 5, vaultOpensAt - 3, [1.0, 1.6], [1, 1]).map((b) => ({ t: b.t - b.w, dur: b.w * 2 }));

  // The fork: one section split round a pillar, somewhere in the deep rock or the vein.
  let fork: Fork | null = null;
  if (archetype === "forked") {
    const t0 = range(rng, strataFrom[2]!, Math.min(strataFrom[3]! + 4, vaultOpensAt - 8));
    fork = { t0, t1: t0 + range(rng, 3.6, 5.2), rich: rng() < 0.5 ? -1 : 1, width: range(rng, 0.045, 0.06) };
  }

  const forkBump: Bump | null = fork ? { t: (fork.t0 + fork.t1) / 2, w: (fork.t1 - fork.t0) / 2 + 1.2, size: 0.2 } : null;
  const pillarAt = (t: number): number => {
    if (!fork || t <= fork.t0 || t >= fork.t1) return 0;
    // Grows from nothing at the split, holds, closes again at the merge.
    const edge = 0.7;
    const grow = smooth((t - fork.t0) / edge) * smooth((fork.t1 - t) / edge);
    return fork.width * grow;
  };

  const rawHalf = (t: number): number => {
    const progress = clamp(t / RUN_SECONDS, 0, 1);
    let hw = lerp(shape.widthTop, shape.widthDeep, progress);
    for (const c of chambers) hw += bumpAt(t, c);
    for (const s of squeezes) hw -= bumpAt(t, s);
    if (forkBump) hw += bumpAt(t, forkBump);
    // A fork needs room for a pillar and a lane either side of it.
    const p = pillarAt(t);
    if (p > 0) hw = Math.max(hw, p + MIN_LANE + 0.01);
    hw = Math.max(MIN_HALF_WIDTH, hw);
    if (progress < VAULT_FROM) return hw;
    const into = (progress - VAULT_FROM) / (1 - VAULT_FROM);
    return lerp(hw, VAULT_HALF_WIDTH, Math.min(1, into * 1.4));
  };
  const halfWidthAt = (t: number) => Math.min(0.47, rawHalf(t));

  const centreAt = (t: number): number => {
    const raw = 0.5 + shape.amp[0] * dsin(shape.freq[0] * t + phase[0]!) + shape.amp[1] * dsin(shape.freq[1] * t + phase[1]!) + shape.amp[2] * dsin(shape.freq[2] * t + phase[2]!);
    const hw = halfWidthAt(t);
    // Keep the whole passage on screen, whatever the wander does.
    return clamp(raw, hw + 0.02, 1 - hw - 0.02);
  };

  const lanesAt = (t: number): Array<[number, number]> => {
    const c = centreAt(t), hw = halfWidthAt(t), p = pillarAt(t);
    if (p <= 0) return [[c - hw, c + hw]];
    return [[c - hw, c - p], [c + p, c + hw]];
  };

  const bulgeAt = (t: number): number => {
    let b = 0;
    for (const c of chambers) b = Math.max(b, bumpAt(t, c) / c.size);
    return b;
  };

  const passage: Passage = { centreAt, halfWidthAt, pillarAt, lanesAt, bulgeAt };
  const partial = { seed, archetype, passage, strataFrom, chambers, squeezes, veins, fork, windowOpensAt: RUN_SECONDS - BLOCK_WINDOW_SECONDS, vaultOpensAt };
  const finds = placeFinds(seed, partial);
  const { hazards, boost } = placeHazards(seed, partial, finds);
  return { ...partial, finds, hazards, boost };
}

type Partial = Omit<RunPlan, "finds" | "hazards" | "boost">;

/** The lane x sits in at time t, or the nearest one. */
export function laneOf(passage: Passage, t: number, x: number): [number, number] {
  const lanes = passage.lanesAt(t);
  if (lanes.length === 1) return lanes[0]!;
  const [a, b] = lanes as [[number, number], [number, number]];
  return x <= (a[1] + b[0]) / 2 ? a : b;
}

const inVein = (plan: Partial, t: number) => plan.veins.some((v) => t >= v.t && t <= v.t + v.dur);

/**
 * Hashes and nonces. The total on offer stays inside a narrow band whatever the
 * shape (sim.test.ts pins it), but where it lies does not: veins pack finds
 * close together, nonces hide in whichever chambers, squeezes or fork this run
 * happens to have, on whichever side.
 */
function placeFinds(seed: number, plan: Partial): Find[] {
  const rng = createRng(seed);
  const veinStep = 0.34;
  const veinSpan = plan.veins.reduce((s, v) => s + v.dur, 0);
  const start = 0.6;
  const target = 66 + Math.floor(rng() * 7);
  const veinFinds = veinSpan / veinStep;
  const baseStep = (plan.vaultOpensAt - start - veinSpan) / Math.max(30, target - veinFinds);

  const finds: Find[] = [];
  const fork = plan.fork;
  for (let t = start; t < plan.vaultOpensAt; t += inVein(plan, t) ? veinStep : baseStep) {
    const lanes = plan.passage.lanesAt(t);
    let lane = lanes[0]!;
    if (lanes.length === 2 && fork) {
      // Most of a fork's ore lies down the tight, rich side.
      const richLane = fork.rich < 0 ? lanes[0]! : lanes[1]!;
      lane = rng() < 0.72 ? richLane : (fork.rich < 0 ? lanes[1]! : lanes[0]!);
    } else rng();
    const mid = (lane[0] + lane[1]) / 2, half = (lane[1] - lane[0]) / 2;
    finds.push({
      t,
      x: clamp(mid + (rng() * 2 - 1) * half * 0.8, 0.03, 0.97),
      kind: "hash",
      value: HASH_VALUE,
      glyph: GLYPHS[Math.floor(rng() * GLYPHS.length)]!,
    });
  }

  // Nonces: where this run hides them. Candidates in order of preference:
  // chambers, the rich side of a fork, then the tightest squeezes. Each turns
  // the nearest find into a nonce, out toward a wall on a side the seed picks.
  const spots: number[] = [];
  // Which chambers get one is shuffled, so it is not always the first ones.
  const order = plan.chambers.map((c) => ({ t: c.t, k: rng() })).sort((a, b) => a.k - b.k);
  for (const o of order) spots.push(o.t);
  if (fork) spots.splice(Math.floor(rng() * (spots.length + 1)), 0, (fork.t0 + fork.t1) / 2 + range(rng, -0.8, 0.8));
  for (const s of plan.squeezes) spots.push(s.t);
  // A run with few openings still gets its nonces: anywhere past the surface.
  while (spots.length < MAX_NONCES) spots.push(range(rng, plan.strataFrom[1]!, plan.vaultOpensAt - 3));

  const used = new Set<number>();
  let placed = 0;
  // If spacing turned candidates away, keep trying anywhere past the surface:
  // every run offers all three, so the ore on offer stays inside its band.
  for (let i = 0; i < 24; i++) spots.push(range(rng, plan.strataFrom[1]!, plan.vaultOpensAt - 2.5));
  for (const spot of spots) {
    if (placed >= MAX_NONCES) break;
    let best = -1, bestD = Infinity;
    finds.forEach((f, i) => {
      if (used.has(i) || f.t < 2) return;
      const d = Math.abs(f.t - spot);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0) continue;
    // Never two nonces within two seconds of each other.
    if (finds.some((f) => f.kind === "nonce" && Math.abs(f.t - finds[best]!.t) < 2)) continue;
    const f = finds[best]!;
    const lanes = plan.passage.lanesAt(f.t);
    const lane = lanes.length === 2 && fork ? (fork.rich < 0 ? lanes[0]! : lanes[1]!) : lanes[0]!;
    const mid = (lane[0] + lane[1]) / 2, half = (lane[1] - lane[0]) / 2;
    const side = rng() < 0.5 ? -1 : 1;
    const depth = range(rng, 0.6, 0.86);
    finds[best] = { t: f.t, x: clamp(mid + side * half * depth, 0.03, 0.97), kind: "nonce", value: NONCE_VALUE, glyph: "◆" };
    used.add(best);
    placed++;
  }
  return finds;
}

/** How likely each gap between two finds is to hold each hazard, per stratum: [stale, rock, cave-in]. */
const SLOT_ODDS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],          // surface rock: learn to steer
  [0.26, 0, 0],       // the mempool: stale shares
  [0.12, 0.16, 0.06], // deep rock: it starts coming down on you
  [0.12, 0.2, 0.1],   // the vein: everything
  [0, 0, 0],          // the vault
];

/**
 * Hazards and the overclock, from their own stream off the seed so they never
 * move a find. Each sits midway in time between two finds. Boulders and stale
 * shares often land on the straight line between those finds — the lazy path —
 * so a clean run has to bend; a rockfall sometimes brings two or three in a
 * row; cave-ins come off a wall; gas hangs over one side or the middle. The
 * rich side of a fork carries its own. Every one leaves at least HAZARD_GAP
 * open in its lane, and none guard a nonce.
 */
function placeHazards(seed: number, plan: Partial, finds: Find[]): { hazards: Hazard[]; boost: Boost | null } {
  const rng = createRng(seed ^ 0x2545f491);
  const hazards: Hazard[] = [];
  let boost: Boost | null = null;
  const { passage, fork } = plan;

  // Gas first, so slot hazards can stay clear of a pocket.
  const gasCount = plan.archetype === "caverns" ? 3 : 1 + Math.floor(rng() * 3);
  const gasSpans: Array<[number, number]> = [];
  const from = plan.strataFrom[2]! + 0.5, to = plan.vaultOpensAt - GAS_SPAN - 1;
  const clashes = (t: number) =>
    (fork != null && t + GAS_SPAN > fork.t0 - 0.5 && t < fork.t1 + 0.5) ||
    gasSpans.some(([a, b]) => t < b + 1.5 && t + GAS_SPAN > a - 1.5);
  for (let g = 0; g < gasCount; g++) {
    const where = rng();
    // Spread through the deep rock and the vein, each in its own stretch; if
    // that stretch is taken (a fork, another pocket), look anywhere else.
    let t = lerp(from, to, (g + rng()) / gasCount);
    for (let tries = 0; tries < 8 && clashes(t); tries++) t = lerp(from, to, rng());
    if (clashes(t)) continue;
    const centre = passage.centreAt(t), hw = passage.halfWidthAt(t);
    const r = hw * 0.48;
    const x = where < 0.34 ? centre - hw + r : where < 0.67 ? centre + hw - r : centre;
    hazards.push({ kind: "gas", t, span: GAS_SPAN, x, r, side: 0 });
    gasSpans.push([t - 0.4, t + GAS_SPAN + 0.4]);
  }
  const nearGas = (t: number) => gasSpans.some(([a, b]) => t >= a && t <= b);
  const nearNonce = (t: number) => finds.some((f) => f.kind === "nonce" && Math.abs(f.t - t) < 0.4);

  // Roomy shafts are busier — caverns, and a forked shaft away from its safe
  // side — so the extra space is paid for and no shape is the easy one.
  const busy = plan.archetype === "caverns" ? 1.42 : plan.archetype === "forked" ? 1.3 : 1;
  let rockfall = 0;
  for (let i = 0; i + 1 < finds.length; i++) {
    const a = finds[i]!, b = finds[i + 1]!;
    const t = (a.t + b.t) / 2;
    const s = stratumIndexAt(plan, t);
    const pick = rng(), along = rng(), spot = rng(), cluster = rng();
    if (s === 0 || t > plan.vaultOpensAt - 0.5 || nearGas(t)) continue;
    const lanes = passage.lanesAt(t);
    const centre = passage.centreAt(t), hw = passage.halfWidthAt(t);

    // The overclock: the first quiet gap in the deep rock, out toward a wall.
    if (!boost && s === 2 && lanes.length === 1 && t > plan.strataFrom[2]! + 1 && a.kind === "hash" && b.kind === "hash") {
      const side = along < 0.5 ? -1 : 1;
      boost = { t, x: clamp(centre + side * hw * 0.72, 0.03, 0.97) };
      continue;
    }
    if (nearNonce(t)) continue;

    let kind: HazardKind | null;
    if (lanes.length === 2 && fork) {
      // The rich side of a fork earns its ore; the safe side is clear.
      kind = pick < 0.45 ? (pick < 0.2 ? "stale" : "rock") : null;
    } else if (rockfall > 0) {
      kind = "rock";
      rockfall--;
    } else {
      const odds = SLOT_ODDS[s]!.map((o) => o * busy) as [number, number, number];
      kind = pick < odds[0] ? "stale" : pick < odds[0] + odds[1] ? "rock" : pick < odds[0] + odds[1] + odds[2] ? "cavein" : null;
      // Sometimes the roof lets go properly: two or three boulders in a row.
      if (kind === "rock" && cluster < 0.22) rockfall = 1 + (cluster < 0.08 ? 1 : 0);
    }
    if (!kind) continue;

    const lane = lanes.length === 2 && fork ? (fork.rich < 0 ? lanes[0]! : lanes[1]!) : lanes[0]!;
    const lc = (lane[0] + lane[1]) / 2, lh = (lane[1] - lane[0]) / 2;

    if (kind === "cavein") {
      if (lanes.length === 2) continue;
      // Rubble off one wall, covering about half the passage.
      const side: -1 | 1 = along < 0.5 ? -1 : 1;
      const depth = Math.min(hw * (0.9 + spot * 0.25), 2 * hw - HAZARD_GAP);
      const wall = centre + side * hw;
      hazards.push({ kind, t, span: 0, x: wall - side * depth / 2, r: depth / 2, side });
      continue;
    }

    const r = HAZARD_RADIUS[kind];
    // On the line between the two finds, or anywhere across the lane.
    const raw = along < 0.5 ? (a.x + b.x) / 2 : lc + (spot * 2 - 1) * lh * 0.85;
    let x = clamp(raw, lane[0] + r, lane[1] - r);
    const leftRoom = x - r - lane[0];
    const rightRoom = lane[1] - (x + r);
    if (leftRoom < HAZARD_GAP && rightRoom < HAZARD_GAP) {
      if (2 * lh < 2 * r + HAZARD_GAP) continue;
      // Open up whichever side is already the roomier one.
      x = leftRoom >= rightRoom ? lane[0] + r + HAZARD_GAP : lane[1] - r - HAZARD_GAP;
    }
    hazards.push({ kind, t, span: 0, x, r, side: 0 });
  }
  hazards.sort((p, q) => p.t - q.t);
  return { hazards, boost };
}

/** Multiplier earned by a run of clean finds. */
export function multiplierFor(streak: number): number {
  return Math.min(MAX_MULT, 1 + Math.floor(streak / MULT_STEP_STREAK) * MULT_STEP);
}

/** What one find is worth right now. */
export function findValue(find: Find, streak: number): number {
  const inWindow = find.t >= RUN_SECONDS - BLOCK_WINDOW_SECONDS;
  return find.value * multiplierFor(streak) * (inWindow ? BLOCK_WINDOW_MULT : 1);
}

/** Ore on offer in a run at face value — no multipliers, no window, no bonus. The fairness band is pinned on this. */
export const oreOnOffer = (plan: Pick<RunPlan, "finds">): number => plan.finds.reduce((s, f) => s + f.value, 0);

/**
 * Round a raw run score into bankable ore, never above the economic ceiling.
 * Everything that reports a score goes through here, so no path — a scoring bug,
 * a retune, a lucky run — can quietly exceed the faucet's bound.
 */
export function bankableScore(raw: number): number {
  return Math.min(MAX_ORE_PER_RUN, Math.max(0, Math.round(raw)));
}

/**
 * What a finished run banks: the ore carried, plus the block bonus if you broke
 * in. A run lost in the dark keeps its ore and never sees the bonus.
 */
export const runOre = (score: number, won: boolean): number => bankableScore(score + (won ? BLOCK_BONUS : 0));
