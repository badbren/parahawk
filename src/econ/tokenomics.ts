/**
 * Parahawk NFT tokenomics — the single source of truth.
 *
 * The collection is the Snipers (the art lives in src/art/), and these are the
 * rules from the Snipers whitepaper, moved from Robinhood Chain to Bitcoin:
 * priced in sats instead of a dollar peg, and pointed at Parasite hashpower.
 * Every number the desktop shows — "What is this place?", the Collection
 * window, the game's ore ledger — is derived from the knobs at the top of this
 * file. Change a knob here and every screen follows; nothing downstream
 * hardcodes a price, a supply or a fee.
 *
 * The anchor that makes the whole thing hang together:
 *
 *     1 White = 2,500 sats                 the mint price, and the only way in
 *     40,000 Whites = 100,000,000 sats = exactly 1.00 BTC
 *     1.00 BTC buys 2,000 PHd of Parasite hashpower (at the ~50k sats/PHd Refinery rate)
 *
 * Supply only ever goes DOWN: an upgrade burns two of a tier to mint one of the
 * next, so every upgrade is a net reduction in the number of Snipers in
 * existence. 40,000 is the number minted, not the number that will exist.
 *
 * The previous design — 20,000 Blacks at 5,000 sats on a 2/3/4/5 forge ladder,
 * with the Parasite mite as the art — is archived at the git tag
 * mite-collection-v1, decisions and all.
 */

export const SATS_PER_BTC = 100_000_000;

/**
 * Refinery fair-value hashprice used for the "what does this buy the pool"
 * copy. The live number comes from src/math/hashprice.ts at runtime; this is
 * the baseline the published ratios were designed around.
 */
export const BASELINE_HASHPRICE_SATS_PER_PHD = 50_000;

// ── Knobs ────────────────────────────────────────────────────────────────────

/** Mint price of one White, in sats. Priced in sats outright — no peg, no keeper. */
export const MINT_PRICE_SATS = 2_500;

/** Whites that can ever be minted. Every other tier is made by burning, never sold. */
export const GENESIS_SUPPLY = 40_000;

/** Tokens burned per upgrade. Two of a tier make one of the next, on every rung. */
export const BURN_PER_UPGRADE = 2;

/**
 * The fee to climb triples every rung: 1, 3, 9, 27, 81 Whites' worth, priced by
 * the tier you climb INTO. Upgrades halve in number each rung, so a fee that
 * merely doubled would cost every tier the same in aggregate and the last step
 * would feel like nothing. Tripling is what makes the top expensive.
 */
export const UPGRADE_FEE_GROWTH = 3;

/** Both burned tokens must be at least this old: a fresh output cannot be fed straight back in. */
export const UPGRADE_COOLDOWN_HOURS = 24;

/**
 * Fee on every secondary sale, in basis points, and the holders' half of it.
 * The holder share is a floor: it can be raised and never lowered. The other
 * half is the treasury's, and the treasury buys Parasite hashpower.
 */
export const TRADE_FEE_BPS = 1_000;
export const HOLDER_FEE_BPS = 500;
export const TREASURY_FEE_BPS = TRADE_FEE_BPS - HOLDER_FEE_BPS;

/** Slice of GENESIS_SUPPLY claimable through Block Hunt rather than bought. */
export const GAME_RESERVE = 4_000;

/** Cost of one game run, in sats — deliberately a tenth of a White. */
export const PLAY_PRICE_SATS = 250;

/** Hard cap on paid runs per wallet. Fairness + faucet rate-limiting (see SYBIL_NOTE). */
export const MAX_PLAYS_PER_WALLET = 20;

/** Ore needed to claim one White from the game reserve. */
export const ORE_PER_WHITE = 1_000;

/**
 * Hard ceiling on what one run can bank, whatever the game does.
 *
 * The faucet's exposure has to be a structural guarantee, not a statistical one:
 * this is what makes "a wallet can never extract more than 4 Whites" true by
 * construction instead of true-on-current-tuning. The game is balanced so even
 * expert play lands just under it, so in practice it almost never binds — but
 * it means a scoring bug or a retune can never quietly drain the reserve.
 */
export const MAX_ORE_PER_RUN = 200;

// ── Play to mint (the owner's rules, 2026-10-22) ─────────────────────────────
//
// These replace the sats-priced mint above, which stays only until the game
// and the whitepaper move over to them. There is no straight mint any more:
// a run of Block Hunt is the only way a White comes into existence. Prices are
// set in dollars and always shown with their live sats price beside them. The
// run is never refunded — it pays for minting its Whites, and whatever is left
// goes to the treasury, which buys Parasite hashpower every week for holders.

/** One run of Block Hunt, in US dollars. */
export const PLAY_PRICE_USD = 1;

/** Whites one run mints: two for a win, one for a loss. Nobody leaves with nothing. */
export const WHITES_PER_WIN = 2;
export const WHITES_PER_LOSS = 1;

/**
 * The upgrade fee climbs a dollar a rung, priced by the tier you climb INTO:
 * $1 for an Orange, $2 for a Green … $5 for a Prismatic. Kept cheap on
 * purpose — the community decides what the top is worth, not the fee.
 */
export const UPGRADE_FEE_USD_PER_RUNG = 1;

// ── The ladder ───────────────────────────────────────────────────────────────

export type TierId = "white" | "orange" | "green" | "blue" | "red" | "prismatic";

/**
 * Bottom to top. Red sits above Blue on purpose — that is the order the art and
 * the contracts were built around, not a typo. Colours are the tiers' laser
 * colours from the art, so a chip always matches the picture.
 */
const LADDER: ReadonlyArray<{ id: TierId; name: string; color: string; blurb: string }> = [
  { id: "white", name: "White", color: "#f2f6ff", blurb: "Minted. The only tier you can buy or win." },
  { id: "orange", name: "Orange", color: "#ffa02e", blurb: "Two Whites, burned." },
  { id: "green", name: "Green", color: "#19e894", blurb: "Two Oranges, burned." },
  { id: "blue", name: "Blue", color: "#2b7bff", blurb: "Two Greens, burned." },
  { id: "red", name: "Red", color: "#ff3f33", blurb: "Two Blues, burned." },
  { id: "prismatic", name: "Prismatic", color: "#ffffff", blurb: "Two Reds. Every tier at once, and the end of the line." },
];

/**
 * Prismatic deals the five colours below it across separate strands and never
 * blends them — averaging five hues gives grey, which is a poor reward for
 * sixty-two burned tokens. Its swatch does the same.
 */
const PRISMATIC_SWATCH = `linear-gradient(90deg,${LADDER.slice(0, 5).map((t) => t.color).join(",")})`;

export interface Tier {
  id: TierId;
  name: string;
  /** A solid colour for text and borders. */
  color: string;
  /** A CSS background for chips — Prismatic's is every colour below it. */
  swatch: string;
  blurb: string;
  /** Rung index. 0 = White. */
  rung: number;
  /** How many of the previous tier one of these burns. 0 for White. */
  burn: number;
  /** How many Whites this tier ultimately consumes. White = 1. */
  whites: number;
  /** Ceiling if every single White climbed to exactly here. Nobody gets close. */
  maxSupply: number;
  /** The fee to climb INTO this tier, in sats. 0 for White. */
  upgradeFeeSats: number;
  /** Sats to build one from nothing: Whites at the mint price plus every fee on the way up. */
  allInSats: number;
  /** The fee to climb INTO this tier, in US dollars. 0 for White. */
  upgradeFeeUsd: number;
  /** Every upgrade fee paid building one of these from Whites, in US dollars. */
  feesInsideUsd: number;
  /** Share of the holder fee pool, per token. White earns 0; above it the weight doubles. */
  weight: number;
  /** Days after the mint opens before this rung can be climbed into. Locked until then. */
  unlockDay: number;
}

function buildTiers(): Tier[] {
  const out: Tier[] = [];
  for (const spec of LADDER) {
    const prev = out[out.length - 1];
    const rung = out.length;
    const upgradeFeeSats = prev ? MINT_PRICE_SATS * UPGRADE_FEE_GROWTH ** (rung - 1) : 0;
    const upgradeFeeUsd = rung * UPGRADE_FEE_USD_PER_RUNG;
    out.push({
      ...spec,
      swatch: spec.id === "prismatic" ? PRISMATIC_SWATCH : spec.color,
      rung,
      burn: prev ? BURN_PER_UPGRADE : 0,
      whites: prev ? prev.whites * BURN_PER_UPGRADE : 1,
      maxSupply: Math.floor(GENESIS_SUPPLY / BURN_PER_UPGRADE ** rung),
      upgradeFeeSats,
      allInSats: prev ? prev.allInSats * BURN_PER_UPGRADE + upgradeFeeSats : MINT_PRICE_SATS,
      upgradeFeeUsd,
      feesInsideUsd: prev ? prev.feesInsideUsd * BURN_PER_UPGRADE + upgradeFeeUsd : 0,
      weight: prev ? BURN_PER_UPGRADE ** rung : 0,
      unlockDay: rung,
    });
  }
  return out;
}

export const TIERS: ReadonlyArray<Tier> = buildTiers();

export const WHITE: Tier = TIERS[0]!;
export const TOP_TIER: Tier = TIERS[TIERS.length - 1]!;

export const getTier = (id: TierId): Tier | undefined => TIERS.find((t) => t.id === id);

/** The tier one rung up from `id`, or undefined at the top of the ladder. */
export const nextTier = (id: TierId): Tier | undefined => {
  const t = getTier(id);
  return t ? TIERS[t.rung + 1] : undefined;
};

// ── Derived headline numbers ─────────────────────────────────────────────────

/** Sats raised if every White mints. By design this is exactly 1.00 BTC. */
export const FULL_MINT_SATS = GENESIS_SUPPLY * MINT_PRICE_SATS;

/** Petahash-days the full mint buys at the baseline hashprice. By design, 2,000. */
export const FULL_MINT_PHD = FULL_MINT_SATS / BASELINE_HASHPRICE_SATS_PER_PHD;

/** Whites that buy one PHd. By design, 20. */
export const WHITES_PER_PHD = BASELINE_HASHPRICE_SATS_PER_PHD / MINT_PRICE_SATS;

/**
 * Total earning weight with every earning tier at its own ceiling at once. That
 * state cannot physically occur (a Prismatic is made by destroying the Whites
 * that would fill the first row); it is the arithmetic that shows the shape.
 */
export const TOTAL_WEIGHT_AT_CEILING = TIERS.reduce((sum, t) => sum + t.maxSupply * t.weight, 0);

/** A tier's share of the holder pool with every earning tier at its ceiling. Each earning tier lands on the same share. */
export const tierShareAtCeiling = (t: Tier): number => (t.maxSupply * t.weight) / TOTAL_WEIGHT_AT_CEILING;

/** One token's share of the holder pool in that same ceiling state. */
export const tokenShareAtCeiling = (t: Tier): number => t.weight / TOTAL_WEIGHT_AT_CEILING;

/** Upgrades it takes to build one top-tier token from Whites. */
export const UPGRADES_TO_TOP = TOP_TIER.whites - 1;

/** Tokens destroyed doing it — every upgrade burns two. */
export const TOKENS_DESTROYED_TO_TOP = UPGRADES_TO_TOP * BURN_PER_UPGRADE;

/** Upgrade fees alone, all the way up. */
export const FEES_TO_TOP_SATS = TOP_TIER.allInSats - TOP_TIER.whites * MINT_PRICE_SATS;

/** One step of building the top tier from Whites: how many upgrades, at what fee. */
export interface BuildStep { from: Tier; to: Tier; upgrades: number; feeEachSats: number; subtotalSats: number }

/** The manufacturing bill for one top-tier token, rung by rung. */
export const TOP_TIER_BILL: ReadonlyArray<BuildStep> = TIERS.slice(1).map((to) => {
  const upgrades = TOP_TIER.whites / to.whites;
  return { from: TIERS[to.rung - 1]!, to, upgrades, feeEachSats: to.upgradeFeeSats, subtotalSats: upgrades * to.upgradeFeeSats };
});

/** Sats a wallet can spend on the game before it is capped out. */
export const MAX_SPEND_PER_WALLET_SATS = PLAY_PRICE_SATS * MAX_PLAYS_PER_WALLET;

/**
 * Why the per-wallet play cap does not need to be sybil-proof: plays are paid,
 * and the ore rate is tuned so a maxed wallet earns Whites at the same sats
 * each as minting them. Spinning up wallets buys effort, not discount.
 */
export const SYBIL_NOTE =
  "Plays are paid and the ore rate matches the mint rate, so farming extra wallets costs the same per White as just minting. The cap is for fairness, not security.";

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

/** "2,500 sats (~$2.03)" — the USD half is dropped until a BTC price is known. */
export function fmtSatsUsd(sats: number, btcUsd: number | null | undefined): string {
  const usd = satsToUsd(sats, btcUsd);
  return usd == null ? fmtSats(sats) : `${fmtSats(sats)} (~${fmtUsd(usd)})`;
}

/** Petahash-days a sat amount buys at the baseline rate. */
export const satsToPhd = (sats: number): number => sats / BASELINE_HASHPRICE_SATS_PER_PHD;

/** "20.0%" / "0.016%" — enough digits to stay honest about very small shares. */
export function fmtShare(share: number): string {
  if (share >= 0.001) return (share * 100).toFixed(1) + "%";
  if (share >= 0.00001) return (share * 100).toFixed(3) + "%";
  return (share * 100).toFixed(4) + "%";
}

// ── Dollars, shown with sats ─────────────────────────────────────────────────

/** What one White costs through the game: a win mints two for one run, a loss one. */
export const WHITE_COST_USD = {
  best: PLAY_PRICE_USD / WHITES_PER_WIN,
  worst: PLAY_PRICE_USD / WHITES_PER_LOSS,
} as const;

/** Dollars to build one of a tier from nothing: its Whites through the game, plus every fee inside it. */
export const allInUsd = (t: Tier): { lo: number; hi: number } => ({
  lo: t.whites * WHITE_COST_USD.best + t.feesInsideUsd,
  hi: t.whites * WHITE_COST_USD.worst + t.feesInsideUsd,
});

/** Dollars to sats at a live BTC price, to the nearest sat. Null when we have no price yet. */
export function usdToSats(usd: number, btcUsd: number | null | undefined): number | null {
  if (!btcUsd || !Number.isFinite(btcUsd) || btcUsd <= 0) return null;
  return Math.round((usd / btcUsd) * SATS_PER_BTC);
}

/** "$1" / "$0.50" / "$1,080" — whole dollars stay whole. */
export function fmtDollars(usd: number): string {
  const digits = Number.isInteger(usd) ? 0 : 2;
  return "$" + usd.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** "$1 (1,232 sats)" — the sats half waits for a BTC price; it is never guessed. */
export function fmtUsdSats(usd: number, btcUsd: number | null | undefined): string {
  const sats = usdToSats(usd, btcUsd);
  return sats == null ? fmtDollars(usd) : `${fmtDollars(usd)} (${fmtSats(sats)})`;
}
