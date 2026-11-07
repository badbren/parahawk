import { describe, expect, it } from "vitest";
import { MAX_ORE_PER_RUN } from "../econ/tokenomics.js";
import { checkBurn, minRealMsFor, statsFromResult, WHITES_FOR_LOSS, WHITES_FOR_WIN } from "./rules.js";

describe("statsFromResult", () => {
  it("pays 2 Whites for a win and 1 for a loss, from the server's verdict", () => {
    expect(WHITES_FOR_WIN).toBe(2);
    expect(WHITES_FOR_LOSS).toBe(1);
    const base = { score: 120, nonces: 2, stale: 1, scrapes: 3, ticks: 2700 };
    expect(statsFromResult(9, { ...base, won: true }, 60)).toEqual({
      seed: 9, score: 120, won: true, nonces: 2, stale: 1, scrapes: 3, durationMs: 45_000, whitesAwarded: 2,
    });
    expect(statsFromResult(9, { ...base, won: false }, 60).whitesAwarded).toBe(1);
  });

  it("clamps whatever the simulation says into the board's ranges", () => {
    const s = statsFromResult(1, { score: 1e9, won: true, nonces: -4, stale: Number.NaN, scrapes: 2.7, ticks: 60 }, 60);
    expect(s).toMatchObject({ score: MAX_ORE_PER_RUN, nonces: 0, stale: 0, scrapes: 2, durationMs: 1000 });
  });
});

describe("minRealMsFor", () => {
  it("asks for 95% of the run's simulated length", () => {
    expect(minRealMsFor(2700, 60)).toBeCloseTo(42_750, 6);
  });
});

describe("checkBurn", () => {
  it("accepts a burn into the tier directly above", () => {
    expect(checkBurn({ fromTier: "white", toTier: "orange" })).toEqual({ ok: true, value: { fromTier: "white", toTier: "orange" } });
    expect(checkBurn({ fromTier: "red", toTier: "prismatic" }).ok).toBe(true);
  });

  it("refuses skipped rungs, unknown tiers and the top of the ladder", () => {
    expect(checkBurn({ fromTier: "white", toTier: "green" }).ok).toBe(false);
    expect(checkBurn({ fromTier: "gold", toTier: "orange" }).ok).toBe(false);
    expect(checkBurn({ fromTier: "prismatic", toTier: "prismatic" }).ok).toBe(false);
    expect(checkBurn(null).ok).toBe(false);
  });
});
