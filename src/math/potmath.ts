/**
 * Pot Math — the four headline formulas for a Parasite Pool round.
 *
 * These are the single source of truth: the website, the Discord bot, and the
 * client-side /calc widget all consume THESE functions (or the browser mirror
 * generated from them — see potmath-client.ts, which is drift-tested against
 * this module). Never re-derive a formula anywhere else.
 *
 * Units, using the exact labels on the parasite.space dashboard:
 *   W = "Total Work Since Last Block", in T (trillions of difficulty units)
 *   D = "Minimum Needed Diff" = network difficulty, in T
 *   H = pool hashrate, in PH/s
 *
 * W and D are the same kind of unit (difficulty), so their ratio is a pure
 * number — that is the whole trick behind depth/luck/rarity.
 */

/**
 * MeekaD share-price constant: sats paid per G of banked work when the pot holds
 * exactly 1T of total work. Subsidy only — excludes transaction fees.
 * satsPerG scales as 212,500 / W(T).
 */
export const SATS_PER_G_AT_1T = 212_500;

const TWO_POW_32 = 4_294_967_296; // 2^32 hashes per difficulty unit
const SECONDS_PER_DAY = 86_400;
const H_PER_PH = 1e15; // hashes per second in 1 PH/s

/**
 * Round depth — how many average rounds' worth of work this pot holds.
 * depth = W / D. At W=184T, D=126.4T → 1.456×.
 */
export function roundDepth(wT: number, dT: number): number {
  if (dT <= 0) return 0;
  return wT / dT;
}

/**
 * Round luck as a percentage — the inverse of depth.
 * luck = 100 × D / W. At W=184T, D=126.4T → 68.7% (found "quicker" than the
 * work suggests would be 100%+; a deep pot reads as <100% luck).
 */
export function luckPct(wT: number, dT: number): number {
  if (wT <= 0) return 0;
  return (100 * dT) / wT;
}

/**
 * Round rarity — the probability an average round runs at least this deep.
 * Mining is memoryless, so round depth is exponentially distributed:
 * P(round ≥ W) = e^(−W/D). At W=184T, D=126.4T → 0.233 (~23%, about 1 in 4).
 */
export function roundRarity(wT: number, dT: number): number {
  if (dT <= 0) return 0;
  return Math.exp(-wT / dT);
}

/**
 * Share price — sats paid per G of banked work at the current pot size.
 * satsPerG = 212,500 / W(T)  (MeekaD formula; subsidy only, excludes tx fees).
 * At W=184T → ~1,155 sats/G. Grows as the pot is younger (less work to split).
 */
export function satsPerG(wT: number): number {
  if (wT <= 0) return 0;
  return SATS_PER_G_AT_1T / wT;
}

/**
 * Value of a miner's banked work in the *current* pot, in sats:
 * stake = userWorkG × satsPerG(W). This is the projected payout if the pot
 * cracked right now (subsidy only).
 */
export function stakeValue(userWorkG: number, wT: number): number {
  if (userWorkG <= 0) return 0;
  return userWorkG * satsPerG(wT);
}

/**
 * Work needed to find an average block, in PHd (petahash-days), derived from
 * first principles rather than the ~6,300 PHd rule of thumb:
 *   PHd = D · 2^32 / 86400 / 1e15
 * At D=126.4T → ~6,283 PHd (the "~6,300 PHd per block" constant, recomputed).
 */
export function phdNeededForBlock(dT: number): number {
  if (dT <= 0) return 0;
  const dAbs = dT * 1e12;
  return (dAbs * TWO_POW_32) / SECONDS_PER_DAY / H_PER_PH;
}

/**
 * Expected days until the pool finds a block at hashrate H:
 * expectedDays = phdNeededForBlock(D) / H.
 * At D=126.4T, H=99 PH/s → ~63.5 days (dashboard shows "63d 10h").
 * Use the 1-day-average hashrate for the smoother, rental-adjusted figure.
 */
export function expectedWaitDays(dT: number, hPhs: number): number {
  if (hPhs <= 0) return Infinity;
  return phdNeededForBlock(dT) / hPhs;
}

export interface PotMathResult {
  /** Inputs echoed back. */
  W: number;
  D: number;
  H: number;
  /** depth = W/D. */
  depth: number;
  /** luck = 100·D/W (%). */
  luckPct: number;
  /** rarity = e^(−W/D), a probability 0–1. */
  rarity: number;
  /** sats per G of banked work at this pot size (subsidy only). */
  satsPerG: number;
  /** PHd of work an average block takes at difficulty D. */
  phdNeeded: number;
  /** expected days to a block at hashrate H. */
  expectedDays: number;
}

/**
 * Compute all four headline numbers at once. Everything downstream (homepage
 * card, /calc, bot /pot) formats the fields on this one object.
 */
export function computePotMath(wT: number, dT: number, hPhs: number): PotMathResult {
  return {
    W: wT,
    D: dT,
    H: hPhs,
    depth: roundDepth(wT, dT),
    luckPct: luckPct(wT, dT),
    rarity: roundRarity(wT, dT),
    satsPerG: satsPerG(wT),
    phdNeeded: phdNeededForBlock(dT),
    expectedDays: expectedWaitDays(dT, hPhs),
  };
}
