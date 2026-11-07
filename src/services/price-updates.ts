/**
 * Rules for visitors updating a hand-typed venue price (the "Trusted" badge's
 * perk — src/activity/permissions.ts). Pure, so they're tested on their own;
 * src/web/price-routes.ts applies them, and the owner skips them.
 *
 * Two guards, both explained to the person in one line:
 *   • bounds — against fat fingers and vandalism: the new price has to be in
 *     the same world as the one it replaces and as the live venues;
 *   • pace — one update per venue every 10 minutes, ten a day, per address.
 */
import { config } from "../config.js";
import type { PriceChange } from "./manual-prices.js";

/** One update per venue per address in this window. */
export const UPDATE_COOLDOWN_MS = 10 * 60_000;
/** Updates per address in any 24 hours. */
export const UPDATES_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60_000;
/** The new price stays within 1/3×–3× of the price it replaces. */
export const MAX_RATIO_VS_CURRENT = 3;
/** …and within 1/4×–4× of the live venues' median (NiceHash, MRR). */
export const MAX_RATIO_VS_MARKET = 4;
/** The USD box: a 1 PH / 24 h quote is tens of dollars, never thousands. */
export const MAX_USD_PER_PHD = 5_000;

/**
 * Venues whose board row is drawn from the hand-typed price
 * (src/data/venues/kissmyhash.ts). Braiins is listed in /admin too, but its
 * row ignores the figure until Parasite can be targeted there, so visitors
 * aren't offered it.
 */
export const COMMUNITY_VENUES: ReadonlySet<string> = new Set(["kissmyhash"]);

/** The live API venues whose median the bounds check against. */
export const MARKET_VENUES: ReadonlySet<string> = new Set(["nicehash", "miningrigrentals"]);

export type Verdict =
  | { ok: true }
  | { ok: false; status: number; error: string; retryAfterMs?: number };

const OK: Verdict = { ok: true };
const int = (n: number) => Math.round(n).toLocaleString("en-US");

export function median(xs: readonly number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** True when this is the owner's address (same test as /admin's isAdmin). */
export function isOwnerAddress(address: string | null | undefined): boolean {
  return Boolean(address && config.adminAddress && address.trim().toLowerCase() === config.adminAddress);
}

/** The USD box: a real, positive, sensible number. */
export function checkUsd(usd: unknown): Verdict {
  const n = typeof usd === "number" ? usd : typeof usd === "string" && usd.trim() !== "" ? Number(usd) : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, status: 400, error: "Enter the USD total for 1 PH / 24h, e.g. 38.04." };
  }
  if (n > MAX_USD_PER_PHD) {
    return { ok: false, status: 400, error: `$${int(n)} for 1 PH / 24h can't be right — enter the USD total for 1 PH for one day.` };
  }
  return OK;
}

export interface BoundsInput {
  newSats: number;
  /** The price it replaces, if there is one. */
  currentSats: number | null;
  /** Median of the live API venues, if any are up. */
  marketSats: number | null;
  venueName: string;
}

export function checkBounds({ newSats, currentSats, marketSats, venueName }: BoundsInput): Verdict {
  if (!(newSats > 0) || !Number.isFinite(newSats)) {
    return { ok: false, status: 400, error: "That price works out to nothing — enter the USD total for 1 PH / 24h." };
  }
  if (currentSats != null && currentSats > 0) {
    const r = newSats / currentSats;
    if (r > MAX_RATIO_VS_CURRENT || r < 1 / MAX_RATIO_VS_CURRENT) {
      return {
        ok: false, status: 400,
        error: `That's more than ${MAX_RATIO_VS_CURRENT}× off ${venueName}'s current price (${int(currentSats)} sats/PHd). Double-check you typed the USD total for 1 PH / 24h.`,
      };
    }
  }
  if (marketSats != null && marketSats > 0) {
    const r = newSats / marketSats;
    if (r > MAX_RATIO_VS_MARKET || r < 1 / MAX_RATIO_VS_MARKET) {
      return {
        ok: false, status: 400,
        error: `That's way off the live venues (NiceHash / MRR are around ${int(marketSats)} sats/PHd). Double-check the number.`,
      };
    }
  }
  return OK;
}

export interface PaceInput {
  venue: string;
  venueName: string;
  /** This address's own changes from the last 24 hours (any order). */
  recent: readonly PriceChange[];
  now: number;
}

export function checkPace({ venue, venueName, recent, now }: PaceInput): Verdict {
  const mine = recent.filter((c) => c.kind === "update" && c.at > now - DAY_MS);
  const lastHere = mine.filter((c) => c.venue === venue).reduce((t, c) => Math.max(t, c.at), 0);
  if (lastHere > 0 && now - lastHere < UPDATE_COOLDOWN_MS) {
    const waitMs = UPDATE_COOLDOWN_MS - (now - lastHere);
    const ago = Math.max(1, Math.round((now - lastHere) / 60_000));
    return {
      ok: false, status: 429, retryAfterMs: waitMs,
      error: `You updated ${venueName} ${ago} min ago — one update per venue every ${UPDATE_COOLDOWN_MS / 60_000} minutes.`,
    };
  }
  if (mine.length >= UPDATES_PER_DAY) {
    const oldest = mine.reduce((t, c) => Math.min(t, c.at), Number.POSITIVE_INFINITY);
    return {
      ok: false, status: 429, retryAfterMs: Math.max(60_000, oldest + DAY_MS - now),
      error: `That's ${UPDATES_PER_DAY} price updates in a day — thanks! Try again tomorrow.`,
    };
  }
  return OK;
}
