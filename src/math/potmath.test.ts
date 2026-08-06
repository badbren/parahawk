import { describe, it, expect } from "vitest";
import {
  roundDepth,
  luckPct,
  roundRarity,
  satsPerG,
  stakeValue,
  phdNeededForBlock,
  expectedWaitDays,
  computePotMath,
  SATS_PER_G_AT_1T,
} from "./potmath.js";
import { RATE_BLOCK_PHD, PHD_TO_DIFF } from "./constants.js";
import { POTMATH_CLIENT_JS } from "../web/potmath-client.js";

// Today's dashboard values, the anchor for every hand-math check.
const W = 184; // Total Work Since Last Block (T)
const D = 126.4; // Minimum Needed Diff (T)
const H = 99; // pool hashrate gauge (PH/s)

describe("round depth & luck", () => {
  it("W=184, D=126.4 → depth ≈ 1.456", () => {
    expect(roundDepth(W, D)).toBeCloseTo(1.456, 2);
  });
  it("W=184, D=126.4 → luck ≈ 68.7%", () => {
    expect(luckPct(W, D)).toBeCloseTo(68.7, 1);
  });
  it("luck is the inverse of depth (luck = 100/depth)", () => {
    expect(luckPct(W, D)).toBeCloseTo(100 / roundDepth(W, D), 6);
  });
  it("degrades gracefully at zero", () => {
    expect(roundDepth(184, 0)).toBe(0);
    expect(luckPct(0, 126.4)).toBe(0);
  });
});

describe("round rarity", () => {
  it("W=184, D=126.4 → P(round ≥ W) ≈ 0.233 (~23%)", () => {
    expect(roundRarity(W, D)).toBeCloseTo(0.233, 3);
  });
  it("a fresh pot (W=0) has rarity 1 — every round runs at least this deep", () => {
    expect(roundRarity(0, D)).toBe(1);
  });
  it("rarity = e^(−depth)", () => {
    expect(roundRarity(W, D)).toBeCloseTo(Math.exp(-roundDepth(W, D)), 10);
  });
});

describe("share price (MeekaD, subsidy only)", () => {
  it("W=184 → ≈ 1,155 sats/G", () => {
    expect(satsPerG(W)).toBeCloseTo(1155, 0);
  });
  it("satsPerG scales as 212,500 / W", () => {
    expect(satsPerG(1)).toBe(SATS_PER_G_AT_1T);
    expect(satsPerG(2)).toBeCloseTo(SATS_PER_G_AT_1T / 2, 6);
  });
  it("stakeValue = userWorkG × satsPerG", () => {
    expect(stakeValue(100, W)).toBeCloseTo(100 * satsPerG(W), 6);
    // e.g. 100 G banked in today's pot ≈ 115,489 sats
    expect(stakeValue(100, W)).toBeCloseTo(115_489, 0);
  });
  it("empty pot → no price / no stake (no divide-by-zero)", () => {
    expect(satsPerG(0)).toBe(0);
    expect(stakeValue(100, 0)).toBe(0);
  });
});

describe("expected wait", () => {
  it("work per block from first principles ≈ 6,300 PHd at D=126.4", () => {
    const phd = phdNeededForBlock(D);
    expect(phd).toBeGreaterThan(6200);
    expect(phd).toBeLessThan(6400);
    // agrees with the RATE_BLOCK_PHD rule of thumb to within a few %
    expect(phd / RATE_BLOCK_PHD).toBeCloseTo(1, 1);
  });
  it("D=126.4, H=99 → ≈ 63.5 days (dashboard '63d 10h')", () => {
    expect(expectedWaitDays(D, H)).toBeCloseTo(63.5, 0);
  });
  it("1-day-avg hashrate gives the smoother, rental-adjusted figure", () => {
    // at 111 PH/s (1D avg) the same pot works out faster than the spiky gauge
    expect(expectedWaitDays(D, 111)).toBeLessThan(expectedWaitDays(D, 99));
  });
  it("zero hashrate never crashes", () => {
    expect(expectedWaitDays(D, 0)).toBe(Infinity);
  });
});

describe("computePotMath bundles all four", () => {
  it("returns today's numbers in one object", () => {
    const pm = computePotMath(W, D, H);
    expect(pm.depth).toBeCloseTo(1.456, 2);
    expect(pm.luckPct).toBeCloseTo(68.7, 1);
    expect(pm.rarity).toBeCloseTo(0.233, 3);
    expect(pm.satsPerG).toBeCloseTo(1155, 0);
    expect(pm.expectedDays).toBeCloseTo(63.5, 0);
  });
});

describe("PHD_TO_DIFF ↔ work-in-G helper sanity", () => {
  it("1 PHd = 20.1G, so work in G = PHd × 20.1", () => {
    // a miner with 10 PHd of lifetime work has banked 201 G
    expect((10 * PHD_TO_DIFF) / 1e9).toBeCloseTo(201, 6);
  });
});

describe("browser mirror agrees with the module (no drift)", () => {
  // Evaluate the client string in a bare sandbox and pull out PotMath.
  const sandbox: { PotMath?: any } = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("g", `${POTMATH_CLIENT_JS.replace("typeof window!==\"undefined\"?window:this", "g")}`)(sandbox);
  const P = sandbox.PotMath;

  const cases: Array<[number, number, number]> = [
    [184, 126.4, 99],
    [50, 126.4, 111],
    [300, 127, 205],
    [0, 126.4, 99],
    [184, 127, 0],
  ];

  it("client PotMath is defined", () => {
    expect(P).toBeTruthy();
    expect(typeof P.computePotMath).toBe("function");
  });

  for (const [w, d, h] of cases) {
    it(`matches on W=${w} D=${d} H=${h}`, () => {
      const a = computePotMath(w, d, h);
      const b = P.computePotMath(w, d, h);
      expect(b.depth).toBeCloseTo(a.depth, 9);
      expect(b.luckPct).toBeCloseTo(a.luckPct, 9);
      expect(b.rarity).toBeCloseTo(a.rarity, 9);
      expect(b.satsPerG).toBeCloseTo(a.satsPerG, 9);
      expect(b.phdNeeded).toBeCloseTo(a.phdNeeded, 6);
      expect(b.expectedDays === Infinity ? 1e18 : b.expectedDays).toBeCloseTo(
        a.expectedDays === Infinity ? 1e18 : a.expectedDays,
        6,
      );
      expect(P.stakeValue(100, w)).toBeCloseTo(stakeValue(100, w), 6);
    });
  }
});
