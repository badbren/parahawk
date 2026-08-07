/**
 * Hashrate marketplace — venue adapter contract.
 *
 * Parahawk is a price *router*, never a wallet: every adapter's only job is to
 * report what one rental venue currently charges, normalized to the single unit
 * that matters — sats per PHd (petahash-day). No adapter ever touches funds.
 *
 * Each adapter reports HOW its quote was obtained (`source`) and WHEN
 * (`fetchedAt`) so the board can show freshness honestly and never present a
 * stale scrape as a live price.
 */

/** How a quote was obtained — surfaced on the board so users can judge it. */
export type VenueSource = "api" | "scraped" | "manual";

export interface VenueQuote {
  /** Display name, e.g. "NiceHash". */
  venue: string;
  /** Stable slug / id, e.g. "nicehash". */
  slug: string;
  /** The one currency that matters: sats per petahash-day. */
  satsPerPhd: number;
  /** Available capacity in PHd, when the venue exposes it. */
  capacityPhd?: number;
  /** Smallest order the venue will take, in PHd. */
  minOrderPhd?: number;
  /** How the quote was obtained. */
  source: VenueSource;
  /** Link to the venue (order page / listing). */
  url: string;
  /** Short honest caveat, e.g. pool-target limitations. */
  note?: string;
  /** When this quote was obtained (epoch ms). */
  fetchedAt: number;
  /** False when the number is a cached last-good value or a manual entry that
   * may be stale — the board shows it differently from a fresh live quote. */
  live: boolean;
  /** Set when the venue was unreachable; the row shows "unreachable" + cache. */
  error?: string;
}

/** Context handed to every adapter so it needn't re-fetch shared chain data. */
export interface VenueContext {
  /** Live BTC price (USD) for the USD/PHd column. */
  btcPriceUsd: number;
  /** Parasite-native live hashprice (sats/PHd) — the Refinery adapter's source. */
  refineryHashpriceSatsPerPhd: number;
}

export type BoardVerdict = "good" | "normal" | "expensive";

/**
 * Chip verdict for a board price against the ~50k sats/PHd fair-value baseline:
 *   🟢 good      ≤ 52k   (meaningfully cheap)
 *   ⚪ normal    52–58k  (around fair value)
 *   🔴 expensive > 58k   (paying a premium)
 * Absolute thresholds (not a ratio) so the chip reads the same regardless of
 * where the baseline drifts — deliberately distinct from math/hashprice.ts's
 * ratio-based Refinery evaluation, which answers a different question.
 */
export const BOARD_GOOD_MAX_SATS = 52_000;
export const BOARD_NORMAL_MAX_SATS = 58_000;

export function boardVerdict(satsPerPhd: number): BoardVerdict {
  if (satsPerPhd <= BOARD_GOOD_MAX_SATS) return "good";
  if (satsPerPhd <= BOARD_NORMAL_MAX_SATS) return "normal";
  return "expensive";
}
