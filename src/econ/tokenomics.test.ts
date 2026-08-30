import { describe, expect, it } from "vitest";
import {
  BLACK,
  BLACKS_PER_PHD,
  BLACK_PRICE_SATS,
  FORGE_PAYS_RATIO,
  FULL_MINT_PHD,
  FULL_MINT_SATS,
  GAME_RESERVE,
  GENESIS_SUPPLY,
  MAX_PLAYS_PER_WALLET,
  MAX_SPEND_PER_WALLET_SATS,
  ORE_PER_BLACK,
  PLAY_PRICE_SATS,
  SATS_PER_BTC,
  TIERS,
  TOP_TIER,
  fmtSatsUsd,
  fmtUsd,
  nextTier,
  satsToUsd,
} from "./tokenomics.js";

/**
 * These are the numbers the public "What is this place?" copy promises. If a
 * knob change breaks one of them, the published story is wrong — either retune
 * the knob or rewrite the copy, but do not just update the expectation.
 */
describe("headline invariants", () => {
  it("the full mint is exactly one bitcoin", () => {
    expect(FULL_MINT_SATS).toBe(SATS_PER_BTC);
    expect(FULL_MINT_SATS / SATS_PER_BTC).toBe(1);
  });

  it("the full mint buys 2,000 PHd and ten Blacks buy one", () => {
    expect(FULL_MINT_PHD).toBe(2_000);
    expect(BLACKS_PER_PHD).toBe(10);
  });

  it("a play costs exactly a tenth of a Black", () => {
    expect(BLACK_PRICE_SATS / PLAY_PRICE_SATS).toBe(10);
  });

  it("a maxed-out wallet spends two Blacks worth on the game", () => {
    expect(MAX_SPEND_PER_WALLET_SATS).toBe(2 * BLACK_PRICE_SATS);
  });

  it("the game reserve is a tenth of supply", () => {
    expect(GAME_RESERVE).toBe(GENESIS_SUPPLY / 10);
  });
});

describe("the ladder", () => {
  it("climbs Black to Gold with escalating burns", () => {
    expect(TIERS.map((t) => t.id)).toEqual(["black", "orange", "green", "white", "gold"]);
    expect(TIERS.map((t) => t.burn)).toEqual([0, 2, 3, 4, 5]);
  });

  it("compounds Blacks consumed down the chain", () => {
    expect(TIERS.map((t) => t.blacks)).toEqual([1, 2, 6, 24, 120]);
  });

  it("caps each tier at supply divided by the Blacks it eats", () => {
    expect(TIERS.map((t) => t.maxSupply)).toEqual([20_000, 10_000, 3_333, 833, 166]);
  });

  it("charges 20% of burned base value to forge", () => {
    expect(TIERS.map((t) => t.forgeFeeSats)).toEqual([0, 2_000, 6_000, 24_000, 120_000]);
    for (const t of TIERS.slice(1)) {
      expect(t.forgeFeeSats).toBe(t.forgeBaseSats * 0.2);
      expect(t.forgeBaseSats).toBe(t.blacks * BLACK_PRICE_SATS);
    }
  });

  it("prices a Gold built from scratch at 1,080,000 sats", () => {
    expect(TOP_TIER.allInSats).toBe(1_080_000);
    // Base Blacks plus fees, and the fees land at exactly 80% of base.
    const base = TOP_TIER.blacks * BLACK_PRICE_SATS;
    expect(base).toBe(600_000);
    expect(TOP_TIER.allInSats - base).toBe(base * 0.8);
  });

  it("makes forging pay better than hoarding the raw Blacks", () => {
    expect(FORGE_PAYS_RATIO).toBeGreaterThan(1);
    expect(FORGE_PAYS_RATIO).toBeCloseTo(1.356, 3);
    // Weight has to beat the all-in cost at every forged rung, or that rung is
    // a trap nobody should climb. Black is the base case: it IS the unit, so it
    // sits at exactly 1.0 rather than above it.
    expect(BLACK.weight).toBe(BLACK.allInSats / BLACK_PRICE_SATS);
    for (const t of TIERS.slice(1)) expect(t.weight).toBeGreaterThan(t.allInSats / BLACK_PRICE_SATS);
  });

  it("weights Gold like ~293 Blacks", () => {
    expect(TOP_TIER.weight).toBeCloseTo(292.969, 3);
  });

  it("walks up the ladder and stops at the top", () => {
    expect(nextTier("black")?.id).toBe("orange");
    expect(nextTier("white")?.id).toBe("gold");
    expect(nextTier("gold")).toBeUndefined();
  });
});

describe("the game faucet never undercuts the mint", () => {
  /** Ore for a run: what an ordinary player clears, vs the theoretical ceiling. */
  const TYPICAL_ORE_PER_PLAY = 130;
  const PERFECT_ORE_PER_PLAY = 200;
  const blacksFrom = (orePerPlay: number) =>
    Math.floor((orePerPlay * MAX_PLAYS_PER_WALLET) / ORE_PER_BLACK);

  it("pays a typical player at exactly mint parity", () => {
    expect(blacksFrom(TYPICAL_ORE_PER_PLAY)).toBe(2);
    const satsEach = MAX_SPEND_PER_WALLET_SATS / blacksFrom(TYPICAL_ORE_PER_PLAY);
    expect(satsEach).toBe(BLACK_PRICE_SATS);
  });

  it("hard-caps what one wallet can ever extract", () => {
    // Skill earns a discount; the 20-play cap bounds it. Even a player who
    // clears a perfect run 20 times running tops out here, and the most a
    // wallet can gain over minting is this bounded sats figure.
    expect(blacksFrom(PERFECT_ORE_PER_PLAY)).toBe(4);
    const bestCaseValue = blacksFrom(PERFECT_ORE_PER_PLAY) * BLACK_PRICE_SATS;
    expect(bestCaseValue - MAX_SPEND_PER_WALLET_SATS).toBe(10_000);
  });

  it("cannot drain more than the reserve allows", () => {
    const worstCaseWalletsToDrain = GAME_RESERVE / blacksFrom(PERFECT_ORE_PER_PLAY);
    expect(worstCaseWalletsToDrain).toBe(500);
  });
});

describe("formatting", () => {
  it("converts sats to USD at a live price", () => {
    expect(satsToUsd(5_000, 100_000)).toBeCloseTo(5, 6);
    expect(satsToUsd(500, 100_000)).toBeCloseTo(0.5, 6);
  });

  it("has no opinion without a price", () => {
    expect(satsToUsd(5_000, null)).toBeNull();
    expect(satsToUsd(5_000, 0)).toBeNull();
    expect(fmtSatsUsd(5_000, null)).toBe("5,000 sats");
  });

  it("shows cents only where they matter", () => {
    expect(fmtUsd(0.5)).toBe("$0.50");
    expect(fmtUsd(5)).toBe("$5.00");
    expect(fmtUsd(1080)).toBe("$1,080");
  });

  it("pairs sats with USD when it can", () => {
    expect(fmtSatsUsd(5_000, 100_000)).toBe("5,000 sats (~$5.00)");
  });
});
