import { describe, expect, it } from "vitest";
import { MAX_ORE_PER_RUN } from "../econ/tokenomics.js";
import {
  ARCHETYPES,
  BLOCK_BONUS,
  BLOCK_WINDOW_SECONDS,
  DAMAGE,
  GAS_DRAIN_PER_SECOND,
  GAS_SPAN,
  HAZARD_GAP,
  HAZARD_RADIUS,
  LAMP_MAX,
  MAX_MULT,
  MAX_NONCES,
  MIN_HALF_WIDTH,
  MIN_LANE,
  MULT_STEP_STREAK,
  NONCE_VALUE,
  RUN_SECONDS,
  STRATA,
  VAULT_SECONDS,
  VIEW_AHEAD_FASTEST,
  VIEW_AHEAD_TOP,
  adjustmentAt,
  bankableScore,
  buildRun,
  dsin,
  findValue,
  hazardCovers,
  multiplierFor,
  oreOnOffer,
  runOre,
  stratumIndexAt,
  viewAheadAt,
} from "./blockrun.js";

const SEEDS = Array.from({ length: 160 }, (_, i) => (i * 2654435761 + 977) >>> 0);
const moments = (step = 0.1) => { const out: number[] = []; for (let t = 0; t <= RUN_SECONDS; t += step) out.push(t); return out; };

describe("deterministic maths", () => {
  it("dsin matches Math.sin to well under a pixel anywhere a run can ask", () => {
    for (let x = -50; x < 400; x += 0.0137) expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-10);
  });

  it("uses no engine maths for its answer: the same input is the same bits", () => {
    expect(dsin(1.234567)).toBe(dsin(1.234567));
    expect(Object.is(dsin(0), 0)).toBe(true);
  });
});

describe("the shaft", () => {
  it("is reproducible from a seed and different between seeds", () => {
    const a = buildRun(2024), b = buildRun(2024), c = buildRun(2025);
    for (const t of moments(0.5)) {
      expect(a.passage.centreAt(t)).toBe(b.passage.centreAt(t));
      expect(a.passage.halfWidthAt(t)).toBe(b.passage.halfWidthAt(t));
    }
    expect(a.finds).toEqual(b.finds);
    expect(a.hazards).toEqual(b.hazards);
    expect(moments(0.5).some((t) => a.passage.centreAt(t) !== c.passage.centreAt(t))).toBe(true);
  });

  it("comes in every archetype", () => {
    const seen = new Set(SEEDS.map((s) => buildRun(s).archetype));
    expect([...seen].sort()).toEqual([...ARCHETYPES].sort());
  });

  it("never runs off the edge, and is always wide enough to get down", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const p = buildRun(seed).passage;
      for (const t of moments(0.1)) {
        const lanes = p.lanesAt(t);
        expect(lanes[0]![0]).toBeGreaterThanOrEqual(0);
        expect(lanes[lanes.length - 1]![1]).toBeLessThanOrEqual(1);
        expect(p.halfWidthAt(t)).toBeGreaterThanOrEqual(MIN_HALF_WIDTH - 1e-12);
        for (const [a, b] of lanes) expect(b - a).toBeGreaterThanOrEqual(MIN_LANE - 1e-9);
      }
    }
  });

  it("splits round a pillar only in a forked shaft, into two lanes", () => {
    for (const seed of SEEDS) {
      const plan = buildRun(seed);
      const split = moments(0.1).some((t) => plan.passage.lanesAt(t).length === 2);
      expect(split).toBe(plan.archetype === "forked");
      if (plan.fork) expect(plan.fork.t1 - plan.fork.t0).toBeGreaterThan(3);
    }
  });

  it("opens out into the vault at the bottom", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const p = buildRun(seed).passage;
      expect(p.halfWidthAt(RUN_SECONDS)).toBeGreaterThan(p.halfWidthAt(RUN_SECONDS - VAULT_SECONDS - 0.5) * 1.6);
    }
  });
});

describe("strata", () => {
  it("always run surface, mempool, deep rock, vein, vault — and where each starts moves", () => {
    const starts = SEEDS.map((s) => buildRun(s).strataFrom);
    for (const from of starts) {
      expect(from.length).toBe(STRATA.length);
      expect(from[0]).toBe(0);
      for (let i = 1; i < from.length; i++) expect(from[i]!).toBeGreaterThan(from[i - 1]!);
      expect(from[4]).toBeCloseTo(RUN_SECONDS - VAULT_SECONDS, 9);
    }
    for (const i of [1, 2, 3]) {
      const xs = starts.map((f) => f[i]!);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2.5);
    }
  });

  it("speed up at every new layer, and open out for the vault", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const plan = buildRun(seed);
      expect(viewAheadAt(plan, 0)).toBe(VIEW_AHEAD_TOP);
      let prev = Infinity;
      for (const t of moments(0.1).filter((t) => t < plan.vaultOpensAt)) {
        const v = viewAheadAt(plan, t);
        expect(v).toBeLessThanOrEqual(prev + 1e-12);
        expect(v).toBeGreaterThanOrEqual(VIEW_AHEAD_FASTEST - 1e-12);
        prev = v;
      }
      expect(viewAheadAt(plan, RUN_SECONDS)).toBeGreaterThan(VIEW_AHEAD_TOP);
      expect(adjustmentAt(plan, plan.vaultOpensAt - 0.01)).toBe(3);
      expect(stratumIndexAt(plan, RUN_SECONDS)).toBe(4);
    }
    expect(VIEW_AHEAD_TOP / VIEW_AHEAD_FASTEST).toBeGreaterThan(1.5);
  });
});

describe("finds", () => {
  it("always sit in an open lane, and stop before the vault", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const plan = buildRun(seed);
      for (const f of plan.finds) {
        expect(f.t).toBeLessThan(plan.vaultOpensAt);
        expect(plan.passage.lanesAt(f.t).some(([a, b]) => f.x >= a - 1e-9 && f.x <= b + 1e-9)).toBe(true);
      }
    }
  });

  it("offer all three nonces on every run, off the easy line", () => {
    for (const seed of SEEDS) {
      const plan = buildRun(seed);
      const nonces = plan.finds.filter((f) => f.kind === "nonce");
      expect(nonces.length).toBe(MAX_NONCES);
      for (const n of nonces) {
        const [a, b] = plan.passage.lanesAt(n.t).find(([l, r]) => n.x >= l - 1e-9 && n.x <= r + 1e-9)!;
        expect(Math.abs(n.x - (a + b) / 2)).toBeGreaterThan(((b - a) / 2) * 0.55);
      }
    }
  });

  it("keep the ore on offer in a narrow band, whatever the shape", () => {
    const offers = SEEDS.map((s) => oreOnOffer(buildRun(s)));
    expect(Math.min(...offers)).toBeGreaterThanOrEqual(90);
    expect(Math.max(...offers)).toBeLessThanOrEqual(102);
  });
});

describe("hazards", () => {
  it("leave the surface rock alone, stop before the vault, and come in time order", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const plan = buildRun(seed);
      for (let i = 0; i < plan.hazards.length; i++) {
        const hz = plan.hazards[i]!;
        expect(hz.t).toBeGreaterThanOrEqual(plan.strataFrom[1]!);
        expect(hz.t + hz.span).toBeLessThan(plan.vaultOpensAt);
        if (i > 0) expect(hz.t).toBeGreaterThanOrEqual(plan.hazards[i - 1]!.t);
      }
    }
  });

  it("always leave a way past in their lane", () => {
    for (const seed of SEEDS.slice(0, 80)) {
      const plan = buildRun(seed);
      for (const hz of plan.hazards) {
        if (hz.kind === "gas") continue;
        const lane = plan.passage.lanesAt(hz.t).find(([a, b]) => hz.x >= a - 1e-9 && hz.x <= b + 1e-9)!;
        expect(lane).toBeDefined();
        expect(hz.x - hz.r).toBeGreaterThanOrEqual(lane[0] - 1e-9);
        expect(hz.x + hz.r).toBeLessThanOrEqual(lane[1] + 1e-9);
        expect(Math.max(hz.x - hz.r - lane[0], lane[1] - (hz.x + hz.r))).toBeGreaterThanOrEqual(HAZARD_GAP - 1e-9);
      }
    }
  });

  it("bring every kind, with the heavy ones only from the deep rock down", () => {
    const plans = SEEDS.map((s) => buildRun(s));
    expect(new Set(plans.flatMap((p) => p.hazards.map((h) => h.kind)))).toEqual(new Set(["stale", "rock", "cavein", "gas"]));
    for (const p of plans) {
      for (const h of p.hazards) if (h.kind === "cavein") expect(h.t).toBeGreaterThanOrEqual(p.strataFrom[2]!);
      const gas = p.hazards.filter((h) => h.kind === "gas").length;
      expect(gas).toBeGreaterThanOrEqual(1);
      expect(gas).toBeLessThanOrEqual(3);
    }
  });

  it("come off a wall when they are cave-ins", () => {
    for (const seed of SEEDS.slice(0, 80)) {
      const plan = buildRun(seed);
      for (const h of plan.hazards.filter((x) => x.kind === "cavein")) {
        const c = plan.passage.centreAt(h.t), hw = plan.passage.halfWidthAt(h.t);
        expect(h.side).not.toBe(0);
        expect(Math.abs(h.x + h.side * h.r - (c + h.side * hw))).toBeLessThan(1e-9);
      }
    }
  });

  it("never guard a nonce", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const plan = buildRun(seed);
      for (const n of plan.finds.filter((f) => f.kind === "nonce")) {
        for (const hz of plan.hazards.filter((h) => h.kind !== "gas")) expect(Math.abs(hz.t - n.t)).toBeGreaterThan(0.3);
      }
    }
  });

  it("know who they cover", () => {
    const h = { kind: "rock", t: 20, span: 0, x: 0.5, r: HAZARD_RADIUS.rock, side: 0 } as const;
    expect(hazardCovers(h, 0.5)).toBe(true);
    expect(hazardCovers(h, 0.5 + HAZARD_RADIUS.rock + 0.001)).toBe(false);
  });

  it("can never put out a full lamp in one go", () => {
    for (const d of Object.values(DAMAGE)) expect(d).toBeLessThan(LAMP_MAX / 2);
    expect(GAS_DRAIN_PER_SECOND * GAS_SPAN).toBeLessThan(LAMP_MAX / 2);
  });

  it("put the overclock in the deep rock, on every run", () => {
    for (const seed of SEEDS) {
      const plan = buildRun(seed);
      expect(plan.boost).not.toBeNull();
      expect(stratumIndexAt(plan, plan.boost!.t)).toBe(2);
    }
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
    expect(findValue({ ...hash, kind: "nonce", value: NONCE_VALUE, glyph: "◆" }, 0)).toBe(findValue(hash, 0) * NONCE_VALUE);
  });

  it("pays the block bonus only to a run that breaks in, and never past the ceiling", () => {
    expect(runOre(50, true)).toBe(50 + BLOCK_BONUS);
    expect(runOre(50, false)).toBe(50);
    expect(bankableScore(10_000)).toBe(MAX_ORE_PER_RUN);
    expect(bankableScore(120.4)).toBe(120);
    expect(bankableScore(-5)).toBe(0);
  });
});
