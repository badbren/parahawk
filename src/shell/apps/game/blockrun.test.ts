import { describe, expect, it } from "vitest";
import { MAX_ORE_PER_RUN, ORE_PER_BLACK } from "../../../econ/tokenomics.js";
import {
  BLOCK_BONUS,
  BLOCK_WINDOW_SECONDS,
  MAX_MULT,
  MAX_NONCES,
  MULT_STEP_STREAK,
  NONCE_VALUE,
  RUN_SECONDS,
  SKILLS,
  VAULT_SECONDS,
  type Skill,
  bankableScore,
  buildPassage,
  buildRun,
  createRng,
  findValue,
  isAgainstWall,
  isChamber,
  multiplierFor,
  simulateRun,
  stratumAt,
} from "./blockrun.js";

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 13);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const scoresAt = (skill: Skill) =>
  SEEDS.map((s) => simulateRun(buildRun(s), skill, createRng(s ^ 0xabcdef)).score);
/** Sample a run at a fine interval — most passage claims are "at every moment". */
const moments = (step = 0.05) => {
  const out: number[] = [];
  for (let t = 0; t <= RUN_SECONDS; t += step) out.push(t);
  return out;
};

describe("the passage", () => {
  it("is reproducible from a seed and different between seeds", () => {
    const a = buildPassage(2024), b = buildPassage(2024), c = buildPassage(2025);
    for (const t of moments(0.5)) {
      expect(a.centreAt(t)).toBe(b.centreAt(t));
      expect(a.halfWidthAt(t)).toBe(b.halfWidthAt(t));
    }
    expect(moments(0.5).some((t) => a.centreAt(t) !== c.centreAt(t))).toBe(true);
  });

  it("never runs off the edge of the shaft", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const p = buildPassage(seed);
      for (const t of moments(0.1)) {
        expect(p.centreAt(t) - p.halfWidthAt(t)).toBeGreaterThanOrEqual(0);
        expect(p.centreAt(t) + p.halfWidthAt(t)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is always wide enough to fly down", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const p = buildPassage(seed);
      for (const t of moments(0.1)) expect(p.halfWidthAt(t)).toBeGreaterThan(0.08);
    }
  });

  it("wanders — it is not a straight drop", () => {
    const p = buildPassage(99);
    const xs = moments(0.5).map((t) => p.centreAt(t));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.15);
  });

  it("tightens as you go deeper", () => {
    const p = buildPassage(7);
    // Compare averages, since chambers make any single moment a poor witness.
    const near = avg(moments(0.1).filter((t) => t < 8).map((t) => p.halfWidthAt(t)));
    const deep = avg(moments(0.1).filter((t) => t > 30 && t < RUN_SECONDS - VAULT_SECONDS).map((t) => p.halfWidthAt(t)));
    expect(deep).toBeLessThan(near);
  });

  it("opens out into the vault at the bottom", () => {
    const p = buildPassage(3);
    const justBefore = p.halfWidthAt(RUN_SECONDS - VAULT_SECONDS - 0.5);
    expect(p.halfWidthAt(RUN_SECONDS)).toBeGreaterThan(justBefore * 2);
  });

  it("opens a handful of chambers, not a constant ripple", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const p = buildPassage(seed);
      const inChamber = moments(0.1).filter((t) => isChamber(p, t)).length * 0.1;
      // A few seconds of a 45s run. Rare enough to feel like arriving somewhere.
      expect(inChamber).toBeGreaterThan(2);
      expect(inChamber).toBeLessThan(12);
    }
  });

  it("knows when you are against the wall", () => {
    const p = buildPassage(11);
    expect(isAgainstWall(p, 5, p.centreAt(5))).toBe(false);
    expect(isAgainstWall(p, 5, p.centreAt(5) + p.halfWidthAt(5) + 0.05)).toBe(true);
  });
});

describe("strata", () => {
  it("descends through every layer in order", () => {
    const seen: string[] = [];
    for (const t of moments(0.1)) {
      const name = stratumAt(t / RUN_SECONDS).name;
      if (seen[seen.length - 1] !== name) seen.push(name);
    }
    expect(seen).toEqual(["Surface rock", "The mempool", "Deep rock", "The vein", "The vault"]);
  });

  it("starts at the surface and ends in the vault", () => {
    expect(stratumAt(0).name).toBe("Surface rock");
    expect(stratumAt(1).name).toBe("The vault");
  });
});

describe("finds", () => {
  it("are reproducible from a seed", () => {
    expect(buildRun(4242).finds).toEqual(buildRun(4242).finds);
  });

  it("always sit inside the passage, so nothing is uncatchable", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const plan = buildRun(seed);
      for (const f of plan.finds) {
        const centre = plan.passage.centreAt(f.t);
        const hw = plan.passage.halfWidthAt(f.t);
        expect(Math.abs(f.x - centre)).toBeLessThanOrEqual(hw + 1e-9);
      }
    }
  });

  it("stop before the vault, which belongs to the block", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const plan = buildRun(seed);
      for (const f of plan.finds) expect(f.t).toBeLessThan(plan.vaultOpensAt);
    }
  });

  it("hide the nonces in chambers, out toward the wall", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const plan = buildRun(seed);
      const nonces = plan.finds.filter((f) => f.kind === "nonce");
      expect(nonces.length).toBeLessThanOrEqual(MAX_NONCES);
      for (const n of nonces) {
        expect(isChamber(plan.passage, n.t)).toBe(true);
        expect(n.value).toBe(NONCE_VALUE);
        // Off the easy centre line — reaching one has to cost something.
        const offset = Math.abs(n.x - plan.passage.centreAt(n.t));
        expect(offset).toBeGreaterThan(plan.passage.halfWidthAt(n.t) * 0.5);
      }
    }
  });

  it("offers the full set of nonces on essentially every run", () => {
    const counts = SEEDS.map((s) => buildRun(s).finds.filter((f) => f.kind === "nonce").length);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(MAX_NONCES - 1);
    expect(avg(counts)).toBeGreaterThan(MAX_NONCES - 0.5);
  });
});

describe("scoring", () => {
  it("steps the multiplier up on streaks and caps it", () => {
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(MULT_STEP_STREAK - 1)).toBe(1);
    expect(multiplierFor(MULT_STEP_STREAK)).toBeGreaterThan(1);
    expect(multiplierFor(10_000)).toBe(MAX_MULT);
  });

  it("pays double inside the block window", () => {
    const hash = { t: 1, x: 0.5, kind: "hash", value: 1, glyph: "a" } as const;
    const late = { ...hash, t: RUN_SECONDS - BLOCK_WINDOW_SECONDS + 1 };
    expect(findValue(late, 0)).toBe(findValue(hash, 0) * 2);
  });

  it("makes a nonce worth many ordinary finds", () => {
    const hash = { t: 1, x: 0.5, kind: "hash", value: 1, glyph: "a" } as const;
    const nonce = { t: 1, x: 0.5, kind: "nonce", value: NONCE_VALUE, glyph: "◆" } as const;
    expect(findValue(nonce, 0)).toBe(findValue(hash, 0) * NONCE_VALUE);
  });

  it("never banks more than the economic ceiling", () => {
    expect(bankableScore(10_000)).toBe(MAX_ORE_PER_RUN);
    expect(bankableScore(120.4)).toBe(120);
    expect(bankableScore(-5)).toBe(0);
  });
});

describe("tuning against the tokenomics", () => {
  it("pays a typical player the ~130 the ore rates assume", () => {
    const m = avg(scoresAt(SKILLS.typical));
    expect(m).toBeGreaterThan(118);
    expect(m).toBeLessThan(142);
  });

  it("keeps even expert play under the faucet ceiling", () => {
    const scores = scoresAt(SKILLS.expert);
    for (const s of scores) expect(s).toBeLessThanOrEqual(MAX_ORE_PER_RUN);
    expect(avg(scores)).toBeGreaterThan(175);
  });

  it("keeps the gap between a first run and an expert one near 2x", () => {
    // This is the fairness property the fixed block bonus exists to create. If
    // it ever runs away, the game has started punishing newcomers.
    const ratio = avg(scoresAt(SKILLS.expert)) / avg(scoresAt(SKILLS.first));
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.3);
  });

  it("never sends anyone home with nothing", () => {
    // Everyone reaches the block, so every run banks at least the bonus.
    const worst = Math.min(...scoresAt(SKILLS.first));
    expect(worst).toBeGreaterThanOrEqual(BLOCK_BONUS);
    expect(worst / ORE_PER_BLACK).toBeGreaterThan(0.05);
  });

  it("rewards skill monotonically", () => {
    const first = avg(scoresAt(SKILLS.first));
    const typical = avg(scoresAt(SKILLS.typical));
    const good = avg(scoresAt(SKILLS.good));
    const expert = avg(scoresAt(SKILLS.expert));
    expect(typical).toBeGreaterThan(first);
    expect(good).toBeGreaterThan(typical);
    expect(expert).toBeGreaterThan(good);
  });

  it("still caps a maxed-out wallet at four Blacks", () => {
    expect(Math.floor((MAX_ORE_PER_RUN * 20) / ORE_PER_BLACK)).toBe(4);
  });
});
