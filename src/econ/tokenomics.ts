/**
 * Parahawk NFT tokenomics — the single source of truth.
 *
 * Every number the desktop shows (the "What is this place?" window, the Mint
 * window, the Game's ore ledger) is derived from the knobs at the top of this
 * file. Change a knob here and every screen follows; nothing downstream
 * hardcodes a price, a supply or a forge cost.
 *
 * The anchor that makes the whole thing hang together:
 *
 *     1 Black = 5,000 sats = 0.1 PHd      (at the ~50k sats/PHd Refinery rate)
 *     10 Blacks buy 1 PHd of Parasite hashpower
 *     20,000 Blacks = 100,000,000 sats = exactly 1.00 BTC = 2,000 PHd
 *
 * Supply only ever goes DOWN: forging burns N of a tier to mint 1 of the next,
 * so every forge is a net reduction in the number of Parahawk NFTs in
 * existence. 20,000 is the number minted, not the number that will exist.
 */

export const SATS_PER_BTC = 100_000_000;

/**
 * Refinery fair-value hashprice used for the "what does this buy the pool"
 * copy. The live number comes from src/math/hashprice.ts at runtime; this is
 * the baseline the published ratios were designed around (see README).
 */
export const BASELINE_HASHPRICE_SATS_PER_PHD = 50_000;

// ── Knobs ────────────────────────────────────────────────────────────────────

/** Mint price of one Black, in sats. */
export const BLACK_PRICE_SATS = 5_000;

/** Blacks that can ever be minted. Higher tiers are forged from these, never minted. */
export const GENESIS_SUPPLY = 20_000;

/** Slice of GENESIS_SUPPLY claimable through the game rather than bought. */
export const GAME_RESERVE = 2_000;

/** Cost of one game run, in sats — deliberately a tenth of a Black. */
export const PLAY_PRICE_SATS = 500;

/** Hard cap on paid runs per wallet. Fairness + faucet rate-limiting (see SYBIL_NOTE). */
export const MAX_PLAYS_PER_WALLET = 20;

/** Ore needed to claim one Black from the game reserve. */
export const ORE_PER_BLACK = 1_000;

/**
 * Hard ceiling on what one run can bank, whatever the game does.
 *
 * The faucet's exposure has to be a structural guarantee, not a statistical one:
 * this is what makes "a wallet can never extract more than 4 Blacks" true by
 * construction instead of true-on-current-tuning. The game is balanced so even
 * expert play lands just under it, so in practice it almost never binds — but
 * it means a scoring bug or a retune can never quietly drain the reserve.
 */
export const MAX_ORE_PER_RUN = 200;

/** Forge fee as basis points of the burned NFTs base value. 2000 = 20%. */
export const FORGE_FEE_BPS = 2_000;

/**
 * Payout-weight bonus per rung climbed, in basis points. 2500 = +25%.
 * This is the reason to forge: a tier is worth more than the sum of what it
 * burned, so climbing beats hoarding raw Blacks (see FORGE_PAYS_RATIO).
 */
export const FORGE_BONUS_BPS = 2_500;

// ── The ladder ───────────────────────────────────────────────────────────────

export type TierId = "black" | "orange" | "green" | "white" | "gold";

/** `burn` = how many of the PREVIOUS tier are destroyed to forge one of this tier. */
const LADDER: ReadonlyArray<{ id: TierId; name: string; color: string; burn: number; blurb: string }> = [
  { id: "black", name: "Black", color: "#5a5a5a", burn: 0, blurb: "Mined. The only tier you can buy or win." },
  { id: "orange", name: "Orange", color: "#ff7a1a", burn: 2, blurb: "Smelted from two Blacks." },
  { id: "green", name: "Green", color: "#8fd14f", burn: 3, blurb: "Three Oranges, refined." },
  { id: "white", name: "White", color: "#e6e6e6", burn: 4, blurb: "Four Greens, burned clean." },
  { id: "gold", name: "Gold", color: "#ffd24a", burn: 5, blurb: "Five Whites. The end of the line." },
];

export interface Tier {
  id: TierId;
  name: string;
  color: string;
  blurb: string;
  /** Rung index. 0 = Black. */
  rung: number;
  /** How many of the previous tier one of these burns. 0 for Black. */
  burn: number;
  /** How many Blacks this tier ultimately consumes. Black = 1. */
  blacks: number;
  /** Ceiling if every single Black were forged all the way up. Nobody gets close. */
  maxSupply: number;
  /** Base value of the NFTs burned to forge one, in sats. 0 for Black. */
  forgeBaseSats: number;
  /** What the forge itself costs, in sats. 0 for Black. */
  forgeFeeSats: number;
  /** Sats to build one from nothing: Blacks bought at mint, plus every forge fee on the way up. */
  allInSats: number;
  /** Share of the pool hashpower this tier earns, relative to Black = 1. */
  weight: number;
}

function buildTiers(): Tier[] {
  const out: Tier[] = [];
  for (const spec of LADDER) {
    const prev = out[out.length - 1];
    const blacks = prev ? prev.blacks * spec.burn : 1;
    const forgeBaseSats = prev ? blacks * BLACK_PRICE_SATS : 0;
    const forgeFeeSats = Math.round((forgeBaseSats * FORGE_FEE_BPS) / 10_000);
    out.push({
      id: spec.id,
      name: spec.name,
      color: spec.color,
      blurb: spec.blurb,
      rung: out.length,
      burn: spec.burn,
      blacks,
      maxSupply: Math.floor(GENESIS_SUPPLY / blacks),
      forgeBaseSats,
      forgeFeeSats,
      allInSats: prev ? prev.allInSats * spec.burn + forgeFeeSats : BLACK_PRICE_SATS,
      weight: prev ? (prev.weight * spec.burn * (10_000 + FORGE_BONUS_BPS)) / 10_000 : 1,
    });
  }
  return out;
}

export const TIERS: ReadonlyArray<Tier> = buildTiers();

export const BLACK: Tier = TIERS[0]!;
export const TOP_TIER: Tier = TIERS[TIERS.length - 1]!;

export const getTier = (id: TierId): Tier | undefined => TIERS.find((t) => t.id === id);

/** The tier one rung up from `id`, or undefined at the top of the ladder. */
export const nextTier = (id: TierId): Tier | undefined => {
  const t = getTier(id);
  return t ? TIERS[t.rung + 1] : undefined;
};

// ── Derived headline numbers ─────────────────────────────────────────────────

/** Sats raised if every Black mints. By design this is exactly 1.00 BTC. */
export const FULL_MINT_SATS = GENESIS_SUPPLY * BLACK_PRICE_SATS;

/** Petahash-days the full mint buys at the baseline hashprice. By design, 2,000. */
export const FULL_MINT_PHD = FULL_MINT_SATS / BASELINE_HASHPRICE_SATS_PER_PHD;

/** Blacks that buy one PHd. By design, 10. */
export const BLACKS_PER_PHD = BASELINE_HASHPRICE_SATS_PER_PHD / BLACK_PRICE_SATS;

/** Sats a wallet can spend on the game before it is capped out. */
export const MAX_SPEND_PER_WALLET_SATS = PLAY_PRICE_SATS * MAX_PLAYS_PER_WALLET;

/**
 * Building the top tier costs this many Blacks-equivalent all-in, but earns
 * TOP_TIER.weight. Above 1.0 means forging beats hoarding — the ratio is
 * structural: (1 + FORGE_BONUS_BPS/1e4)^rungs divided by (allIn / base).
 */
export const FORGE_PAYS_RATIO = TOP_TIER.weight / (TOP_TIER.allInSats / BLACK_PRICE_SATS);

/**
 * Why the per-wallet play cap does not need to be sybil-proof: plays are paid,
 * and the ore rate is tuned so a maxed wallet earns Blacks at the same sats
 * each as minting them. Spinning up wallets buys effort, not discount.
 */
export const SYBIL_NOTE =
  "Plays are paid and the ore rate matches the mint rate, so farming extra wallets costs the same per Black as just minting. The cap is for fairness, not security.";

// ── Formatting ───────────────────────────────────────────────────────────────

export const fmtSats = (sats: number): string => sats.toLocaleString("en-US") + " sats";

/** Sats to USD at a live BTC price. Returns null when we have no price yet. */
export function satsToUsd(sats: number, btcUsd: number | null | undefined): number | null {
  if (!btcUsd || !Number.isFinite(btcUsd) || btcUsd <= 0) return null;
  return (sats / SATS_PER_BTC) * btcUsd;
}

/** "$5.00" / "$0.50" / "$1,080" — cents only below $10, where they matter. */
export function fmtUsd(usd: number): string {
  const digits = usd < 10 ? 2 : 0;
  return "$" + usd.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** "5,000 sats (~$5.00)" — the USD half is dropped until a BTC price is known. */
export function fmtSatsUsd(sats: number, btcUsd: number | null | undefined): string {
  const usd = satsToUsd(sats, btcUsd);
  return usd == null ? fmtSats(sats) : `${fmtSats(sats)} (~${fmtUsd(usd)})`;
}

/** Petahash-days a sat amount buys at the baseline rate. */
export const satsToPhd = (sats: number): number => sats / BASELINE_HASHPRICE_SATS_PER_PHD;
