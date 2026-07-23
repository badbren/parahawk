import { describe, it, expect } from "vitest";
import {
  probabilityAtLeastOne,
  expectedHits,
  daysToExpectedHit,
  phdFromHashrate,
  oddsForWork,
} from "./odds.js";
import {
  diffToPhd,
  phdToDiff,
  bestDiffAsBlockPercent,
  computeOdometer,
} from "./work.js";
import { computePotAge, integratePhd } from "./pot.js";
import {
  evaluateHashprice,
  satsPerPhdToUsd,
  hashpriceSatsPerPhd,
  blockSubsidyBtc,
} from "./hashprice.js";
import {
  RATE_10T_PHD,
  RATE_21T_PHD,
  RATE_BLOCK_PHD,
  PHD_TO_DIFF,
} from "./constants.js";

describe("Poisson hit probability", () => {
  it("500 PHd → 63.2% chance of a 10T share", () => {
    // 1 − e^(−500/500) = 1 − e^(−1) = 0.6321...
    const p = probabilityAtLeastOne(500, RATE_10T_PHD);
    expect(p).toBeCloseTo(0.6321, 3);
  });

  it("one rate's worth of work is always 1 − 1/e regardless of tier", () => {
    expect(probabilityAtLeastOne(RATE_21T_PHD, RATE_21T_PHD)).toBeCloseTo(0.6321, 3);
    expect(probabilityAtLeastOne(RATE_BLOCK_PHD, RATE_BLOCK_PHD)).toBeCloseTo(0.6321, 3);
  });

  it("is 0 at no work and approaches 1 for large work", () => {
    expect(probabilityAtLeastOne(0, RATE_10T_PHD)).toBe(0);
    expect(probabilityAtLeastOne(5000, RATE_10T_PHD)).toBeGreaterThan(0.9999);
  });

  it("expectedHits is linear in work", () => {
    expect(expectedHits(1000, RATE_10T_PHD)).toBeCloseTo(2, 10);
  });
});

describe("time to expected hit", () => {
  it("75 PH/s → one 10T share per ~6.6 days", () => {
    // rate / hashrate = 500 / 75 = 6.667 days
    expect(daysToExpectedHit(75, RATE_10T_PHD)).toBeCloseTo(6.667, 2);
  });

  it("phdFromHashrate matches: 75 PH/s for 6.667 days ≈ 500 PHd", () => {
    expect(phdFromHashrate(75, 500 / 75)).toBeCloseTo(500, 6);
  });
});

describe("oddsForWork", () => {
  it("orders tiers correctly (10T easiest, block hardest)", () => {
    const o = oddsForWork(500);
    expect(o.tenTChance).toBeGreaterThan(o.twentyOneTChance);
    expect(o.twentyOneTChance).toBeGreaterThan(o.blockChance);
    expect(o.expectedPlebReturn).toBeCloseTo(0.65, 10);
  });
});

describe("work / difficulty conversions", () => {
  it("1 PHd == 20.1G difficulty units, round-trips", () => {
    expect(phdToDiff(1)).toBeCloseTo(PHD_TO_DIFF, 6);
    expect(diffToPhd(PHD_TO_DIFF)).toBeCloseTo(1, 10);
    expect(diffToPhd(phdToDiff(123))).toBeCloseTo(123, 8);
  });

  it("best diff as % of a 127T block", () => {
    expect(bestDiffAsBlockPercent(127e12, 127e12)).toBeCloseTo(100, 6);
    expect(bestDiffAsBlockPercent(12.7e12, 127e12)).toBeCloseTo(10, 6);
  });

  it("computeOdometer produces lifetime PHd and luck ratio", () => {
    const totalWork = 100 * PHD_TO_DIFF; // 100 PHd of work
    const odo = computeOdometer(totalWork, 150 * PHD_TO_DIFF, 127e12);
    expect(odo.lifetimePhd).toBeCloseTo(100, 6);
    // expected best diff mid = (1.0 + 1.5)/2 = 1.25× total work; observed 1.5× → luck > 1
    expect(odo.luckRatio).toBeCloseTo(1.5 / 1.25, 6);
  });
});

describe("pot age", () => {
  it("144 blocks == 1 day, verdict aging boundary is >1d", () => {
    const pot = computePotAge(1000 + 144, 1000);
    expect(pot.blocks).toBe(144);
    expect(pot.days).toBeCloseTo(1, 6);
    expect(pot.verdict).toBe("aging"); // exactly 1 day is not < 1
  });

  it("fresh under a day, stale over two days", () => {
    expect(computePotAge(1050, 1000).verdict).toBe("fresh"); // 50 blocks
    expect(computePotAge(1000 + 300, 1000).verdict).toBe("stale"); // >2 days
  });

  it("never negative", () => {
    expect(computePotAge(900, 1000).blocks).toBe(0);
  });
});

describe("integratePhd", () => {
  it("constant 75 PH/s for 1 day → 75 PHd", () => {
    const day = 86_400_000;
    const phd = integratePhd([
      { ts: 0, hashratePhs: 75 },
      { ts: day, hashratePhs: 75 },
    ]);
    expect(phd).toBeCloseTo(75, 6);
  });

  it("returns 0 for fewer than 2 samples", () => {
    expect(integratePhd([{ ts: 0, hashratePhs: 100 }])).toBe(0);
  });
});

describe("hashprice", () => {
  it("USD conversion from sats/PHd", () => {
    // 50,000 sats = 0.0005 BTC; at $100,000/BTC that is $50/PHd
    expect(satsPerPhdToUsd(50_000, 100_000)).toBeCloseTo(50, 6);
  });

  it("verdict good/normal/expensive around the 50k baseline", () => {
    expect(evaluateHashprice(40_000, 100_000).verdict).toBe("good");
    expect(evaluateHashprice(52_000, 100_000).verdict).toBe("normal");
    expect(evaluateHashprice(70_000, 100_000).verdict).toBe("expensive");
  });

  it("block subsidy halves on schedule", () => {
    expect(blockSubsidyBtc(0)).toBe(50);
    expect(blockSubsidyBtc(210_000)).toBe(25);
    expect(blockSubsidyBtc(840_000)).toBe(3.125); // 2024 halving
    expect(blockSubsidyBtc(959_200)).toBe(3.125);
  });

  it("computes bitcoin hashprice ~49.5k sats/PHd at 127T diff, 3.125 subsidy", () => {
    const hp = hashpriceSatsPerPhd(127e12, 959_200);
    expect(hp).toBeGreaterThan(48_000);
    expect(hp).toBeLessThan(51_000);
  });
});
