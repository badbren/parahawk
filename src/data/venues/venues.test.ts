import { describe, it, expect } from "vitest";
import {
  nicehashBtcPerPhDayToSatsPerPhd,
  nicehashOrderPriceToSatsPerPhd,
  nicehashVwapSatsPerPhd,
} from "./nicehash.js";
import { mrrRigToSatsPerPhd, mrrBestThreeAverageSatsPerPhd, mrrAlgoPriceToSatsPerPhd } from "./miningrigrentals.js";
import { boardVerdict } from "./types.js";

describe("NiceHash price normalization", () => {
  it("converts BTC/PH/day to sats/PHd (× 1e8)", () => {
    expect(nicehashBtcPerPhDayToSatsPerPhd(0.000518)).toBeCloseTo(51_800, 6);
  });
  it("is linear", () => {
    expect(nicehashBtcPerPhDayToSatsPerPhd(0.001)).toBe(100_000);
  });
});

describe("NiceHash order-book normalization", () => {
  it("normalizes a BTC/EH/day price via marketFactor (1e18 = EH)", () => {
    // 0.7705 BTC/EH/day → 77,050 sats/PHd.
    expect(nicehashOrderPriceToSatsPerPhd(0.7705, 1e18)).toBeCloseTo(77_050, 3);
  });
  it("returns 0 for a non-positive marketFactor", () => {
    expect(nicehashOrderPriceToSatsPerPhd(0.5, 0)).toBe(0);
  });
  it("VWAPs only alive, filled orders", () => {
    const sats = nicehashVwapSatsPerPhd({
      marketFactor: 1e18,
      orders: [
        { price: 0.6, acceptedSpeed: 0.001, alive: true }, // counts
        { price: 0.8, acceptedSpeed: 0.001, alive: true }, // counts
        { price: 0.1, acceptedSpeed: 0, alive: true }, // no accepted speed → ignored
        { price: 0.1, acceptedSpeed: 0.5, alive: false }, // dead → ignored
      ],
    });
    // VWAP of 0.6 and 0.8 (equal weight) = 0.7 BTC/EH/day → 70,000 sats/PHd.
    expect(sats).toBeCloseTo(70_000, 2);
  });
  it("returns 0 when nothing is being filled", () => {
    expect(nicehashVwapSatsPerPhd({ marketFactor: 1e18, orders: [] })).toBe(0);
  });
});

describe("MRR algo-price normalization", () => {
  it("converts BTC per ph*day to sats/PHd", () => {
    expect(mrrAlgoPriceToSatsPerPhd(0.00069, "ph*day")).toBeCloseTo(69_000, 6);
  });
  it("converts BTC per th*day (×1000 units per PH)", () => {
    expect(mrrAlgoPriceToSatsPerPhd(0.00000069, "th*day")).toBeCloseTo(69_000, 6);
  });
  it("returns 0 for an unknown unit", () => {
    expect(mrrAlgoPriceToSatsPerPhd(0.001, "kh*day")).toBe(0);
  });
});

describe("MRR rig normalization", () => {
  it("converts a rig's BTC/day + speed to effective sats/PHd", () => {
    // 0.000542 BTC/day for a 1 PH/s rig → 54,200 sats/PHd.
    expect(mrrRigToSatsPerPhd(0.000542, 1)).toBeCloseTo(54_200, 6);
  });
  it("scales by rig speed (a 2 PH/s rig at double price is the same per-PHd)", () => {
    expect(mrrRigToSatsPerPhd(0.001084, 2)).toBeCloseTo(54_200, 6);
  });
  it("returns 0 for a zero-speed rig rather than dividing by zero", () => {
    expect(mrrRigToSatsPerPhd(0.0005, 0)).toBe(0);
  });

  it("averages the cheapest three and ignores scam-priced outliers", () => {
    const rigs = [
      { pricePerDayBtc: 0.00053, speedPhs: 1 }, // 53,000
      { pricePerDayBtc: 0.00054, speedPhs: 1 }, // 54,000
      { pricePerDayBtc: 0.00055, speedPhs: 1 }, // 55,000
      { pricePerDayBtc: 0.00090, speedPhs: 1 }, // 90,000 outlier — excluded
    ];
    // (53k + 54k + 55k) / 3 = 54,000; the 90k outlier must not drag it up.
    expect(mrrBestThreeAverageSatsPerPhd(rigs)).toBeCloseTo(54_000, 6);
  });

  it("returns 0 when there are no priced rigs", () => {
    expect(mrrBestThreeAverageSatsPerPhd([])).toBe(0);
  });
});

describe("board verdict thresholds", () => {
  it("🟢 good at or below 52k", () => {
    expect(boardVerdict(51_800)).toBe("good");
    expect(boardVerdict(52_000)).toBe("good");
  });
  it("⚪ normal in the 52–58k band", () => {
    expect(boardVerdict(54_200)).toBe("normal");
    expect(boardVerdict(58_000)).toBe("normal");
  });
  it("🔴 expensive above 58k", () => {
    expect(boardVerdict(59_500)).toBe("expensive");
  });
});
