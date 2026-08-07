import { describe, it, expect } from "vitest";
import {
  hashValuePerPhd,
  breakEvenVerdict,
  blockProbWithin,
  BLOCK_SUBSIDY_SATS,
} from "./renting.js";
import { phdNeededForBlock, expectedWaitDays } from "./potmath.js";

// Anchor to today's dashboard values, same as the Pot Math tests.
const D = 126.4; // Minimum Needed Diff (T)
const H = 99; // pool hashrate gauge (PH/s)

describe("break-even hashprice (raw hashvalue)", () => {
  it("subsidy constant is the post-2024 3.125 BTC in sats", () => {
    expect(BLOCK_SUBSIDY_SATS).toBe(312_500_000);
  });

  it("hashValuePerPhd = blockReward / phdNeededForBlock(D)", () => {
    const hv = hashValuePerPhd(D, BLOCK_SUBSIDY_SATS);
    expect(hv).toBeCloseTo(BLOCK_SUBSIDY_SATS / phdNeededForBlock(D), 6);
  });

  it("D=126.4 → ~49,700 sats/PHd (why hashprice hovers near 50k)", () => {
    const hv = hashValuePerPhd(D, BLOCK_SUBSIDY_SATS);
    expect(hv).toBeGreaterThan(49_000);
    expect(hv).toBeLessThan(50_500);
  });

  it("degrades gracefully at zero", () => {
    expect(hashValuePerPhd(0, BLOCK_SUBSIDY_SATS)).toBe(0);
    expect(hashValuePerPhd(D, 0)).toBe(0);
  });
});

describe("break-even verdict", () => {
  const be = 49_700;
  it("paying well under the work's worth → cheap (+EV)", () => {
    const v = breakEvenVerdict(45_000, be);
    expect(v.verdict).toBe("cheap");
    expect(v.ratio).toBeLessThan(1);
  });
  it("paying well over → expensive", () => {
    expect(breakEvenVerdict(55_000, be).verdict).toBe("expensive");
  });
  it("within the neutral band → parity", () => {
    expect(breakEvenVerdict(50_000, be).verdict).toBe("parity");
    expect(breakEvenVerdict(be, be).verdict).toBe("parity");
  });
  it("band edges are inclusive on the outside", () => {
    // exactly 2% under counts as cheap, exactly 2% over counts as expensive
    expect(breakEvenVerdict(be * 0.98, be).verdict).toBe("cheap");
    expect(breakEvenVerdict(be * 1.02, be).verdict).toBe("expensive");
  });
  it("ratio is live / break-even", () => {
    expect(breakEvenVerdict(60_000, 50_000).ratio).toBeCloseTo(1.2, 6);
  });
});

describe("block probability within a window", () => {
  const expectedDays = expectedWaitDays(D, H); // ≈ 63.5

  it("P(≥1 within t) = 1 − e^(−t/expectedDays)", () => {
    expect(blockProbWithin(7, expectedDays)).toBeCloseTo(1 - Math.exp(-7 / expectedDays), 10);
  });
  it("1 day ≈ 1.6%, 7 days ≈ 10.4% at ~63.5-day expectation", () => {
    expect(blockProbWithin(1, expectedDays)).toBeCloseTo(0.0156, 3);
    expect(blockProbWithin(7, expectedDays)).toBeCloseTo(0.1044, 3);
  });
  it("monotonic — a longer window is never less likely", () => {
    const p1 = blockProbWithin(1, expectedDays);
    const p6 = blockProbWithin(6, expectedDays);
    const p24 = blockProbWithin(24, expectedDays);
    expect(p6).toBeGreaterThan(p1);
    expect(p24).toBeGreaterThan(p6);
  });
  it("approaches (but never reaches) certainty over a long horizon", () => {
    const p = blockProbWithin(500, expectedDays);
    expect(p).toBeGreaterThan(0.99);
    expect(p).toBeLessThan(1);
  });
  it("guards zero / non-finite inputs", () => {
    expect(blockProbWithin(0, expectedDays)).toBe(0);
    expect(blockProbWithin(-5, expectedDays)).toBe(0);
    expect(blockProbWithin(1, 0)).toBe(0);
    expect(blockProbWithin(1, Infinity)).toBe(0);
  });
});
