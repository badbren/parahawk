import { describe, expect, it } from "vitest";
import { stakeValue } from "../math/potmath.js";
import { PHD_TO_DIFF } from "../math/constants.js";
import { roundStake, type RoundStakeInput } from "./round-stake.js";

/**
 * The wallet page's inline math exactly as it was before it moved into
 * roundStake() (src/web/pages/address.ts, 2026-11-06), so the move can be
 * shown to change nothing.
 */
function before(i: RoundStakeInput) {
  const lastBlockMs = i.now - i.potAgeHours * 3_600_000;
  const roundMs = Math.max(1, i.now - lastBlockMs);
  const wDiff = i.potW * 1e12;
  const inRound = i.snapshots.filter((s) => s.ts >= lastBlockMs && s.totalWork > 0).sort((a, b) => a.ts - b.ts);
  const baseline = inRound[0] ?? null;
  const nearStart = baseline !== null && baseline.ts - lastBlockMs < 0.2 * roundMs;
  let roundWorkDiff: number;
  let assumedFull: boolean;
  if (nearStart && i.totalWorkDiff >= baseline!.totalWork) {
    roundWorkDiff = Math.max(0, i.totalWorkDiff - baseline!.totalWork);
    assumedFull = false;
  } else {
    roundWorkDiff = Math.min(i.totalWorkDiff, wDiff);
    assumedFull = true;
  }
  const roundG = roundWorkDiff / 1e9;
  const roundPhd = roundWorkDiff / PHD_TO_DIFF;
  const roundPct = wDiff > 0 ? (roundWorkDiff / wDiff) * 100 : 0;
  const stakeSats = stakeValue(roundG, i.potW);
  const stakeUsd = i.btcUsd > 0 ? (stakeSats / 1e8) * i.btcUsd : 0;
  const rentalRoundPhd = i.orders
    .filter((ord) => ord.status === "active")
    .reduce((s, ord) => s + (ord.deliveredPhd ?? (ord.requestedPhd * ord.progressPercent) / 100), 0);
  const rentalStakeSats = stakeValue((rentalRoundPhd * PHD_TO_DIFF) / 1e9, i.potW);
  const rentalStakeUsd = i.btcUsd > 0 ? (rentalStakeSats / 1e8) * i.btcUsd : 0;
  return { wDiff, roundWorkDiff, roundPhd, roundPct, assumedFull, stakeSats, stakeUsd, rentalRoundPhd, rentalStakeSats, rentalStakeUsd };
}

/** A small seeded PRNG so the cases are the same every run. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

describe("roundStake", () => {
  it("matches the wallet page's previous inline math on 500 random wallets", () => {
    const r = rng(20261106);
    const now = Date.UTC(2026, 10, 6, 12);
    for (let k = 0; k < 500; k++) {
      const potAgeHours = r() * 2_000;
      const lastBlock = now - potAgeHours * 3_600_000;
      const snaps = Array.from({ length: Math.floor(r() * 6) }, () => ({
        ts: lastBlock + (r() - 0.3) * potAgeHours * 3_600_000,
        totalWork: r() < 0.1 ? 0 : r() * 1e18,
      }));
      const i: RoundStakeInput = {
        now, potAgeHours, potW: r() < 0.05 ? 0 : r() * 400, btcUsd: r() < 0.1 ? 0 : 60_000 + r() * 50_000,
        totalWorkDiff: r() * 2e18,
        orders: Array.from({ length: Math.floor(r() * 4) }, () => ({
          status: r() < 0.5 ? "active" as const : "fulfilled" as const,
          requestedPhd: r() * 500, progressPercent: r() * 100,
          ...(r() < 0.5 ? { deliveredPhd: r() * 400 } : {}),
        })),
        snapshots: snaps,
      };
      expect(roundStake(i)).toEqual(before(i));
    }
  });

  it("measures exactly from a round-start baseline", () => {
    const now = Date.UTC(2026, 10, 6, 12);
    const s = roundStake({
      now, potAgeHours: 10, potW: 100, btcUsd: 100_000, totalWorkDiff: 5e13, orders: [],
      snapshots: [{ ts: now - 10 * 3_600_000 + 60_000, totalWork: 4e13 }],
    });
    // W = 100T of pool work this round; this wallet did 10T of it since the baseline.
    expect(s.assumedFull).toBe(false);
    expect(s.roundWorkDiff).toBe(1e13);
    expect(s.roundPct).toBeCloseTo(10, 10);
  });
});
