import { describe, it, expect } from "vitest";
import {
  computePoolHealth,
  durationHistogram,
  type PotCycle,
} from "./poolhealth.js";
import { phdNeededForBlock } from "../math/potmath.js";

const D = 126.4; // current network difficulty, T
const EXP = phdNeededForBlock(D); // ~6,283 PHd per average block

function cycle(height: number, foundAt: number, hours: number, estPhd: number): PotCycle {
  return {
    height,
    foundAt,
    durationBlocks: Math.round((hours * 60) / 10),
    durationHours: hours,
    estPhd,
  };
}

describe("computePoolHealth — luck index", () => {
  it("no cycles → empty snapshot, no crash", () => {
    const h = computePoolHealth([], D);
    expect(h.count).toBe(0);
    expect(h.allLuck).toBeNull();
    expect(h.rollingLuck).toBeNull();
    expect(h.verdict).toBe("none");
    expect(h.longestDrought).toBeNull();
    expect(h.histogram).toEqual([]);
  });

  it("per-cycle luck = expected / actual (>1 = lucky, found quicker)", () => {
    const half = EXP / 2; // banked only half an average block → very lucky
    const dbl = EXP * 2; // took two blocks' worth → unlucky
    const h = computePoolHealth([cycle(1, 100, 10, half), cycle(2, 200, 40, dbl)], D);
    const byHeight = new Map(h.cycles.map((c) => [c.height, c]));
    expect(byHeight.get(1)!.luck).toBeCloseTo(2, 6);
    expect(byHeight.get(2)!.luck).toBeCloseTo(0.5, 6);
    expect(h.expectedPhd).toBeCloseTo(EXP, 6);
  });

  it("aggregate luck uses expected / mean(actual), not mean of ratios", () => {
    // actuals EXP and 3·EXP → mean 2·EXP → aggregate luck 0.5.
    // (mean of ratios would be (1 + 1/3)/2 = 0.667 — deliberately different.)
    const h = computePoolHealth([cycle(1, 1, 10, EXP), cycle(2, 2, 10, 3 * EXP)], D);
    expect(h.allLuck).toBeCloseTo(0.5, 6);
  });

  it("orders cycles by foundAt and rolls over the last N", () => {
    // Feed out of order; rolling window of 2 should take the two newest.
    const cycles = [
      cycle(3, 300, 10, EXP * 4), // newest, unlucky
      cycle(1, 100, 10, EXP), // oldest, even
      cycle(2, 200, 10, EXP * 2), // middle
    ];
    const h = computePoolHealth(cycles, D, 2);
    expect(h.cycles.map((c) => c.height)).toEqual([1, 2, 3]);
    expect(h.rollingCount).toBe(2);
    // last two actuals: 2·EXP and 4·EXP → mean 3·EXP → luck 1/3
    expect(h.rollingLuck).toBeCloseTo(1 / 3, 6);
  });

  it("verdict is lucky/unlucky/even with a deadband, mapped to an emoji", () => {
    const lucky = computePoolHealth([cycle(1, 1, 10, EXP / 2)], D);
    expect(lucky.verdict).toBe("lucky");
    expect(lucky.emoji).toBe("🍀");

    const unlucky = computePoolHealth([cycle(1, 1, 10, EXP * 2)], D);
    expect(unlucky.verdict).toBe("unlucky");
    expect(unlucky.emoji).toBe("🥲");

    const even = computePoolHealth([cycle(1, 1, 10, EXP)], D);
    expect(even.verdict).toBe("even");
  });

  it("ignores non-positive actuals without dividing by zero", () => {
    const h = computePoolHealth([cycle(1, 1, 10, 0), cycle(2, 2, 10, EXP)], D);
    expect(h.cycles.find((c) => c.height === 1)!.luck).toBe(0);
    expect(h.allLuck).toBeCloseTo(1, 6); // only the valid actual counts
  });
});

describe("computePoolHealth — distribution & hall of fame", () => {
  const cycles: PotCycle[] = [
    cycle(1, 100, 5, 3000),
    cycle(2, 200, 50, 30000), // longest drought + biggest pot
    cycle(3, 300, 2, 1200), // shortest pot
    cycle(4, 400, 20, 12000),
    cycle(5, 500, 12, 7000),
  ];

  it("reports median / shortest / longest pot durations", () => {
    const h = computePoolHealth(cycles, D);
    expect(h.shortestHours).toBe(2);
    expect(h.longestHours).toBe(50);
    expect(h.medianHours).toBe(12); // sorted 2,5,12,20,50 → 12
  });

  it("picks the hall-of-fame cycles correctly", () => {
    const h = computePoolHealth(cycles, D);
    expect(h.longestDrought!.height).toBe(2);
    expect(h.shortestPot!.height).toBe(3);
    expect(h.biggestPot!.height).toBe(2);
  });

  it("median of an even count averages the two middle values", () => {
    const h = computePoolHealth([cycle(1, 1, 4, 10), cycle(2, 2, 10, 10)], D);
    expect(h.medianHours).toBe(7);
  });
});

describe("durationHistogram", () => {
  it("empty input → no bins", () => {
    expect(durationHistogram([])).toEqual([]);
  });

  it("all-equal values collapse to one bin", () => {
    const bins = durationHistogram([8, 8, 8]);
    expect(bins).toHaveLength(1);
    expect(bins[0]!.count).toBe(3);
  });

  it("counts every value exactly once and puts the max in the last bin", () => {
    const hours = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const bins = durationHistogram(hours);
    const total = bins.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(hours.length);
    expect(bins[bins.length - 1]!.count).toBeGreaterThan(0); // max=10 lands in last bin
  });
});
