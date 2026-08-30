/**
 * Block Hunt — the descent model. Pure, deterministic, no DOM.
 *
 * A run is 45 seconds of burrowing down a winding passage and breaking into a
 * block at the bottom. The shape of the whole thing is a journey, not an
 * obstacle course: the passage meanders, occasionally opens into a chamber, and
 * narrows as you go deeper, until the last few seconds where it opens out into
 * the vault and the block is simply there, waiting.
 *
 * Two properties this model exists to guarantee:
 *
 *  - **You always reach the block.** There is no fail state. A bad run banks
 *    less, never nothing. Breaking in pays a large fixed bonus, which is what
 *    keeps a first run and an expert run inside about 2x of each other — the
 *    fairness the ore rates in src/econ/tokenomics.ts depend on.
 *  - **Everything derives from one 32-bit seed.** The passage, the finds, the
 *    chambers. That keeps this testable and means a server can one day hand out
 *    a seed, take the player's inputs back, and replay a claimed score rather
 *    than trusting the client. Never use Math.random() here.
 */
import { MAX_ORE_PER_RUN } from "../../../econ/tokenomics";

export const RUN_SECONDS = 45;
/** The closing stretch where finds pay double and the block is in sight. */
export const BLOCK_WINDOW_SECONDS = 8;
/** The final chamber. The passage opens out and the grail is just there. */
export const VAULT_SECONDS = 4.5;
/** How often the passage offers something worth having. */
export const FIND_INTERVAL_MS = 590;

export const HASH_VALUE = 1;
/** The rare find. Sits in chambers, off the easy line — the reason to explore. */
export const NONCE_VALUE = 10;
export const MAX_NONCES = 3;

/** Clean finds needed for each step up the multiplier. */
export const MULT_STEP_STREAK = 8;
export const MULT_STEP = 0.25;
export const MAX_MULT = 1.75;
export const BLOCK_WINDOW_MULT = 2;
/** Paid to everyone who reaches the block. The equaliser — see the note above. */
export const BLOCK_BONUS = 67;

/** Half-width of the passage, as a fraction of the shaft, at the surface and at depth. */
const HALF_WIDTH_TOP = 0.3;
const HALF_WIDTH_DEEP = 0.12;
/** How far a chamber bulges beyond the base passage. */
const CHAMBER_BULGE = 0.15;
/**
 * How pronounced the bulge must be to count as a chamber. Deliberately keyed to
 * the bulge and not to absolute width: the passage is naturally wide near the
 * surface, and calling that a chamber would make two fifths of every run
 * "special", which is the same as none of it being special.
 */
export const CHAMBER_THRESHOLD = 0.5;
/** Half-width of the vault at the very bottom. */
const VAULT_HALF_WIDTH = 0.46;

const GLYPHS = "0123456789abcdef";

/** xorshift32 — small, fast, identical in every JS engine. */
export function createRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

/** The layers you descend through. `from` is the fraction of the run they start at. */
export const STRATA = [
  { from: 0, name: "Surface rock", accent: "#6f7a63" },
  { from: 0.2, name: "The mempool", accent: "#8fd14f" },
  { from: 0.45, name: "Deep rock", accent: "#a08050" },
  { from: 0.7, name: "The vein", accent: "#ffd24a" },
  { from: 0.91, name: "The vault", accent: "#ffe9a3" },
] as const;

export type Stratum = (typeof STRATA)[number];

export function stratumAt(progress: number): Stratum {
  let out: Stratum = STRATA[0];
  for (const s of STRATA) if (progress >= s.from) out = s;
  return out;
}

export type FindKind = "hash" | "nonce";

export interface Find {
  /** Seconds into the run when this reaches the miner. */
  t: number;
  /** Position across the shaft, 0..1. Always inside the passage. */
  x: number;
  kind: FindKind;
  value: number;
  /** Character drawn for the find. Cosmetic. */
  glyph: string;
}

/** The passage geometry, sampled at any moment of the run. */
export interface Passage {
  /** Centre of the passage at time t, 0..1. */
  centreAt(t: number): number;
  /** Half-width of the passage at time t, as a fraction of the shaft. */
  halfWidthAt(t: number): number;
  /**
   * How much of a chamber this moment is, 0..1. Drives where nonces hide and
   * lets the renderer light the walls as one opens up.
   */
  bulgeAt(t: number): number;
  /**
   * Which opening this moment belongs to. Chambers are the peaks of one slow
   * sine, so a half-period identifies each one — that is what lets the layout
   * put at most a single nonce in any given chamber.
   */
  chamberIdAt(t: number): number;
}

/** True where the passage has opened into a chamber worth looking around. */
export const isChamber = (passage: Passage, t: number): boolean =>
  passage.bulgeAt(t) >= CHAMBER_THRESHOLD;

export interface RunPlan {
  seed: number;
  passage: Passage;
  finds: Find[];
  windowOpensAt: number;
  vaultOpensAt: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Build the passage from a seed.
 *
 * The centre line is a sum of three sines at unrelated frequencies, which gives
 * a wander that never repeats over a run and is smooth enough to follow by eye.
 * The width narrows with depth, bulges into occasional chambers, and finally
 * opens right out for the vault.
 */
export function buildPassage(seed: number): Passage {
  const rng = createRng(seed ^ 0x5bf03635);
  const p1 = rng() * Math.PI * 2, p2 = rng() * Math.PI * 2, p3 = rng() * Math.PI * 2, p4 = rng() * Math.PI * 2;
  const vaultFrom = (RUN_SECONDS - VAULT_SECONDS) / RUN_SECONDS;

  // pow(...,6) keeps chambers rare and brief rather than a constant ripple:
  // roughly three openings across a run, a couple of seconds each.
  const CHAMBER_FREQ = 0.42;
  const bulgeAt = (t: number): number => Math.pow(Math.max(0, Math.sin(CHAMBER_FREQ * t + p4)), 6);
  const chamberIdAt = (t: number): number => Math.floor((CHAMBER_FREQ * t + p4) / Math.PI);

  const halfWidthAt = (t: number): number => {
    const progress = clamp(t / RUN_SECONDS, 0, 1);
    const base = lerp(HALF_WIDTH_TOP, HALF_WIDTH_DEEP, progress);
    const hw = base + CHAMBER_BULGE * bulgeAt(t);
    if (progress < vaultFrom) return hw;
    // The last stretch opens out into the vault.
    const into = (progress - vaultFrom) / (1 - vaultFrom);
    return lerp(hw, VAULT_HALF_WIDTH, Math.min(1, into * 1.4));
  };

  const centreAt = (t: number): number => {
    const raw = 0.5 + 0.24 * Math.sin(0.55 * t + p1) + 0.12 * Math.sin(1.13 * t + p2) + 0.05 * Math.sin(2.07 * t + p3);
    const hw = halfWidthAt(t);
    // Keep the whole passage on screen, whatever the wander does.
    return clamp(raw, hw + 0.02, 1 - hw - 0.02);
  };

  return { centreAt, halfWidthAt, bulgeAt, chamberIdAt };
}

export function buildRun(seed: number): RunPlan {
  const rng = createRng(seed);
  const passage = buildPassage(seed);
  const finds: Find[] = [];
  const count = Math.floor((RUN_SECONDS * 1000) / FIND_INTERVAL_MS);
  const vaultOpensAt = RUN_SECONDS - VAULT_SECONDS;
  let nonces = 0;
  // At most one nonce per chamber, so the rare find is spread down the whole
  // descent instead of all three landing in the first opening.
  const usedChambers = new Set<number>();

  for (let i = 0; i < count; i++) {
    const t = (i * FIND_INTERVAL_MS) / 1000;
    // Nothing to catch in the vault — that stretch belongs to the block.
    if (t >= vaultOpensAt) break;
    const centre = passage.centreAt(t);
    const hw = passage.halfWidthAt(t);

    // Chambers hide the rare find, and it sits out toward the wall so it costs
    // something to reach. That is the whole reason to look around.
    const chamber = passage.chamberIdAt(t);
    if (isChamber(passage, t) && nonces < MAX_NONCES && !usedChambers.has(chamber)) {
      usedChambers.add(chamber);
      nonces++;
      const side = rng() < 0.5 ? -1 : 1;
      finds.push({ t, x: clamp(centre + side * hw * 0.78, 0.03, 0.97), kind: "nonce", value: NONCE_VALUE, glyph: "◆" });
      continue;
    }

    // Ordinary finds sit anywhere across the passage, so you are always steering.
    const offset = (rng() * 2 - 1) * hw * 0.82;
    finds.push({
      t,
      x: clamp(centre + offset, 0.03, 0.97),
      kind: "hash",
      value: HASH_VALUE,
      glyph: GLYPHS[Math.floor(rng() * GLYPHS.length)]!,
    });
  }

  return { seed, passage, finds, windowOpensAt: RUN_SECONDS - BLOCK_WINDOW_SECONDS, vaultOpensAt };
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

/** True when x is outside the passage at time t — a wall scrape. */
export function isAgainstWall(passage: Passage, t: number, x: number): boolean {
  return Math.abs(x - passage.centreAt(t)) > passage.halfWidthAt(t);
}

/**
 * Round a raw run score into bankable ore, never above the economic ceiling.
 * Everything that reports a score goes through here, so no path — a scoring bug,
 * a retune, a lucky run — can quietly exceed the faucet's bound.
 */
export function bankableScore(raw: number): number {
  return Math.min(MAX_ORE_PER_RUN, Math.max(0, Math.round(raw)));
}

export interface Skill {
  /** Chance of reaching an ordinary find. */
  find: number;
  /** Chance of also reaching a nonce, which sits further out. */
  nonce: number;
  /** Chance of staying off the wall when a find is missed. 1 = never scrapes. */
  clean: number;
}

export interface RunResult {
  score: number;
  found: number;
  nonces: number;
  scrapes: number;
  bestStreak: number;
}

/**
 * Play a plan at a given skill level. The tuning tests use this to check the
 * score band against the tokenomics before any of it reaches a browser.
 */
export function simulateRun(plan: RunPlan, skill: Skill, rng: () => number): RunResult {
  let score = 0, streak = 0, found = 0, nonces = 0, scrapes = 0, bestStreak = 0;

  for (const find of plan.finds) {
    const reach = find.kind === "nonce" ? skill.nonce : skill.find;
    if (rng() < reach) {
      score += findValue(find, streak);
      streak++;
      found++;
      if (find.kind === "nonce") nonces++;
      if (streak > bestStreak) bestStreak = streak;
      continue;
    }
    // Missing a find means you were somewhere else, and the deeper and tighter
    // the passage the likelier that somewhere else was a wall.
    const tightness = 1 - plan.passage.halfWidthAt(find.t) / HALF_WIDTH_TOP;
    if (rng() > skill.clean && rng() < Math.max(0.1, tightness)) { streak = 0; scrapes++; }
  }

  return { score: bankableScore(score + BLOCK_BONUS), found, nonces, scrapes, bestStreak };
}

/** Reference skill levels the tuning targets are stated against. */
export const SKILLS = {
  first: { find: 0.34, nonce: 0.15, clean: 0.45 },
  typical: { find: 0.56, nonce: 0.4, clean: 0.72 },
  good: { find: 0.75, nonce: 0.68, clean: 0.88 },
  expert: { find: 0.9, nonce: 0.92, clean: 0.97 },
} as const satisfies Record<string, Skill>;
