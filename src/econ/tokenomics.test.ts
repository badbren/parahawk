import { describe, expect, it } from "vitest";
import {
  FEES_TO_TOP_SATS,
  FULL_MINT_PHD,
  FULL_MINT_SATS,
  GAME_RESERVE,
  GENESIS_SUPPLY,
  HOLDER_FEE_BPS,
  MAX_PLAYS_PER_WALLET,
  MAX_SPEND_PER_WALLET_SATS,
  MINT_PRICE_SATS,
  ORE_PER_WHITE,
  PLAY_PRICE_SATS,
  SATS_PER_BTC,
  TIERS,
  TOKENS_DESTROYED_TO_TOP,
  TOP_TIER,
  TOP_TIER_BILL,
  TOTAL_WEIGHT_AT_CEILING,
  TRADE_FEE_BPS,
  TREASURY_FEE_BPS,
  UPGRADES_TO_TOP,
  WHITE,
  WHITES_PER_LOSS,
  WHITES_PER_PHD,
  WHITES_PER_WIN,
  PLAY_PRICE_USD,
  allInUsd,
  fmtDollars,
  fmtSatsUsd,
  fmtShare,
  fmtUsd,
  fmtUsdSats,
  nextTier,
  satsToUsd,
  tierShareAtCeiling,
  tokenShareAtCeiling,
  usdToSats,
} from "./tokenomics.js";

/** The owner's play-to-mint rules (2026-10-22): $1 a run, 2 Whites for a win, 1 for a loss, fees +$1 a rung. */
describe("play to mint", () => {
  it("a run is a dollar and nobody leaves with nothing", () => {
    expect(PLAY_PRICE_USD).toBe(1);
    expect(WHITES_PER_WIN).toBe(2);
    expect(WHITES_PER_LOSS).toBe(1);
  });

  it("the upgrade fee climbs a dollar a rung, $1 into Orange to $5 into Prismatic", () => {
    expect(TIERS.map((t) => t.upgradeFeeUsd)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("fees inside a token are two of the tier below's plus its own", () => {
    expect(TIERS.map((t) => t.feesInsideUsd)).toEqual([0, 1, 4, 11, 26, 57]);
  });

  it("a Prismatic costs $73–89 all in: 32 Whites at 50¢–$1 plus $57 of fees", () => {
    expect(allInUsd(TOP_TIER)).toEqual({ lo: 73, hi: 89 });
    expect(allInUsd(WHITE)).toEqual({ lo: 0.5, hi: 1 });
  });

  it("dollars show with live sats, and never with a guessed price", () => {
    expect(usdToSats(1, 81_199)).toBe(1_232);
    expect(usdToSats(1, null)).toBeNull();
    expect(fmtUsdSats(1, 81_199)).toBe("$1 (1,232 sats)");
    expect(fmtUsdSats(1, 0)).toBe("$1");
    expect(fmtDollars(0.5)).toBe("$0.50");
    expect(fmtDollars(1_080)).toBe("$1,080");
  });
});

/**
 * These are the numbers the whitepaper ("What is this place?") promises. If a
 * knob change breaks one of them, the published story is wrong — either retune
 * the knob or rewrite the copy, but do not just update the expectation.
 */
describe("headline invariants", () => {
  it("the full mint is exactly one bitcoin", () => {
    expect(FULL_MINT_SATS).toBe(SATS_PER_BTC);
  });

  it("the full mint buys 2,000 PHd and twenty Whites buy one", () => {
    expect(FULL_MINT_PHD).toBe(2_000);
    expect(WHITES_PER_PHD).toBe(20);
  });

  it("a play costs exactly a tenth of a White", () => {
    expect(MINT_PRICE_SATS / PLAY_PRICE_SATS).toBe(10);
  });

  it("a maxed-out wallet spends two Whites' worth on the game", () => {
    expect(MAX_SPEND_PER_WALLET_SATS).toBe(2 * MINT_PRICE_SATS);
  });

  it("the game reserve is a tenth of supply", () => {
    expect(GAME_RESERVE).toBe(GENESIS_SUPPLY / 10);
  });
});

describe("the ladder", () => {
  it("climbs White to Prismatic, two for one, with Red above Blue", () => {
    expect(TIERS.map((t) => t.id)).toEqual(["white", "orange", "green", "blue", "red", "prismatic"]);
    expect(TIERS.map((t) => t.burn)).toEqual([0, 2, 2, 2, 2, 2]);
    expect(TIERS.map((t) => t.whites)).toEqual([1, 2, 4, 8, 16, 32]);
  });

  it("halves the ceiling every rung", () => {
    expect(TIERS.map((t) => t.maxSupply)).toEqual([40_000, 20_000, 10_000, 5_000, 2_500, 1_250]);
  });

  it("triples the fee every rung: 1, 3, 9, 27, 81 Whites' worth", () => {
    expect(TIERS.map((t) => t.upgradeFeeSats / MINT_PRICE_SATS)).toEqual([0, 1, 3, 9, 27, 81]);
  });

  it("costs exactly 3^rung Whites to build any tier from scratch", () => {
    // Two of the tier below plus the tripling fee collapses to a power of three.
    expect(TIERS.map((t) => t.allInSats / MINT_PRICE_SATS)).toEqual([1, 3, 9, 27, 81, 243]);
  });

  it("builds a Prismatic for 607,500 sats: 32 Whites and 527,500 in fees", () => {
    expect(TOP_TIER.allInSats).toBe(607_500);
    expect(FEES_TO_TOP_SATS).toBe(527_500);
    expect(TOP_TIER.whites * MINT_PRICE_SATS + FEES_TO_TOP_SATS).toBe(TOP_TIER.allInSats);
  });

  it("takes 31 upgrades and destroys 62 tokens to get there", () => {
    expect(UPGRADES_TO_TOP).toBe(31);
    expect(TOKENS_DESTROYED_TO_TOP).toBe(62);
    expect(TOP_TIER_BILL.reduce((n, s) => n + s.upgrades, 0)).toBe(UPGRADES_TO_TOP);
    expect(TOP_TIER_BILL.map((s) => s.upgrades)).toEqual([16, 8, 4, 2, 1]);
    expect(TOP_TIER_BILL.reduce((n, s) => n + s.subtotalSats, 0)).toBe(FEES_TO_TOP_SATS);
  });

  it("unlocks one rung a day, so a Prismatic cannot exist inside five days", () => {
    expect(TIERS.map((t) => t.unlockDay)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("walks up the ladder and stops at the top", () => {
    expect(nextTier("white")?.id).toBe("orange");
    expect(nextTier("blue")?.id).toBe("red");
    expect(nextTier("red")?.id).toBe("prismatic");
    expect(nextTier("prismatic")).toBeUndefined();
  });
});

describe("the holder pool", () => {
  it("pays White nothing — it is an access pass, not an income position", () => {
    expect(WHITE.weight).toBe(0);
  });

  it("doubles the weight every earning rung", () => {
    expect(TIERS.map((t) => t.weight)).toEqual([0, 2, 4, 8, 16, 32]);
  });

  it("gives every earning tier the same share at the ceiling: burning concentrates, it creates nothing", () => {
    expect(TOTAL_WEIGHT_AT_CEILING).toBe(200_000);
    for (const t of TIERS.slice(1)) expect(tierShareAtCeiling(t)).toBeCloseTo(0.2, 12);
    expect(tierShareAtCeiling(WHITE)).toBe(0);
    expect(tokenShareAtCeiling(TOP_TIER)).toBeCloseTo(0.00016, 12);
  });

  it("raises price three times for every doubling of weight, so the top is rank, not yield", () => {
    const orange = TIERS[1]!;
    expect(TOP_TIER.weight / orange.weight).toBe(16);
    expect(TOP_TIER.allInSats / orange.allInSats).toBe(81);
  });

  it("splits the 10% trade fee down the middle", () => {
    expect(TRADE_FEE_BPS).toBe(1_000);
    expect(HOLDER_FEE_BPS).toBe(500);
    expect(TREASURY_FEE_BPS).toBe(500);
  });
});

describe("the game faucet never undercuts the mint", () => {
  /** Ore for a run: what an ordinary player clears, vs the theoretical ceiling. */
  const TYPICAL_ORE_PER_PLAY = 130;
  const PERFECT_ORE_PER_PLAY = 200;
  const whitesFrom = (orePerPlay: number) =>
    Math.floor((orePerPlay * MAX_PLAYS_PER_WALLET) / ORE_PER_WHITE);

  it("pays a typical player at exactly mint parity", () => {
    expect(whitesFrom(TYPICAL_ORE_PER_PLAY)).toBe(2);
    const satsEach = MAX_SPEND_PER_WALLET_SATS / whitesFrom(TYPICAL_ORE_PER_PLAY);
    expect(satsEach).toBe(MINT_PRICE_SATS);
  });

  it("hard-caps what one wallet can ever extract", () => {
    // Skill earns a discount; the 20-play cap bounds it.
    expect(whitesFrom(PERFECT_ORE_PER_PLAY)).toBe(4);
    const bestCaseValue = whitesFrom(PERFECT_ORE_PER_PLAY) * MINT_PRICE_SATS;
    expect(bestCaseValue - MAX_SPEND_PER_WALLET_SATS).toBe(5_000);
  });

  it("cannot drain more than the reserve allows", () => {
    const worstCaseWalletsToDrain = GAME_RESERVE / whitesFrom(PERFECT_ORE_PER_PLAY);
    expect(worstCaseWalletsToDrain).toBe(1_000);
  });
});

describe("formatting", () => {
  it("converts sats to USD at a live price", () => {
    expect(satsToUsd(2_500, 100_000)).toBeCloseTo(2.5, 6);
    expect(satsToUsd(250, 100_000)).toBeCloseTo(0.25, 6);
  });

  it("has no opinion without a price", () => {
    expect(satsToUsd(2_500, null)).toBeNull();
    expect(satsToUsd(2_500, 0)).toBeNull();
    expect(fmtSatsUsd(2_500, null)).toBe("2,500 sats");
  });

  it("shows cents only where they matter", () => {
    expect(fmtUsd(0.5)).toBe("$0.50");
    expect(fmtUsd(5)).toBe("$5.00");
    expect(fmtUsd(1080)).toBe("$1,080");
  });

  it("pairs sats with USD when it can", () => {
    expect(fmtSatsUsd(2_500, 100_000)).toBe("2,500 sats (~$2.50)");
  });

  it("keeps small shares honest", () => {
    expect(fmtShare(0.2)).toBe("20.0%");
    expect(fmtShare(0.00016)).toBe("0.016%");
    expect(fmtShare(0.00001)).toBe("0.001%");
  });
});
