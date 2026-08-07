import { config } from "../config.js";
import { getAllTimeTopDifficulty, getRouterOrders } from "../data/parasite.js";

/**
 * The all-time Bravocado ("cado") winners: every miner whose best-ever share is
 * ≥10T. Sourced from the all-time difficulty leaderboard (masked addresses).
 *
 * Parasite masks leaderboard addresses as `bc1q…<last4>`, but the Refinery order
 * book (`/api/router/orders`) carries FULL addresses — so a masked winner who
 * has ever rented can be matched back to their full address by last-4 (only when
 * that last-4 is unique in the order book, to avoid false joins). Matched
 * winners become clickable through to their full wallet stats page; the rest
 * stay masked. Cached ~10 min.
 */

const TEN_T = 10e12;
const TTL_MS = 10 * 60 * 1000;

export interface CadoWinner {
  /** rank by best difficulty (1 = biggest). */
  rank: number;
  /** masked address exactly as the leaderboard reports it (bc1q…xxxx). */
  maskedAddress: string;
  /** full bc1q address if uniquely matched via the order book, else null. */
  fullAddress: string | null;
  /** best-ever share difficulty, in difficulty units. */
  bestDiff: number;
  /** blocks participated in (from the leaderboard), 0 if unknown. */
  blocks: number;
}

export interface CadoWinnersData {
  winners: CadoWinner[];
  total: number;
  /** how many resolved to a full (clickable) address. */
  matched: number;
}

let cache: { at: number; data: CadoWinnersData } | null = null;

/** Deterministic demo winners for mock mode — a mix of clickable + masked. */
function mockWinners(): CadoWinnersData {
  const rows: Array<[number, string | null, number]> = [
    [63.3e12, "bc1qmockwinneralpha00000000000000000000abcd", 2811],
    [40.2e12, "bc1qmockwinnerbravo00000000000000000000wxyz", 1204],
    [22.1e12, null, 640],
    [15.7e12, "bc1qmockwinnerdelta000000000000000000009vkv", 412],
    [11.4e12, null, 88],
  ];
  const winners = rows.map(([diff, full, blocks], i) => ({
    rank: i + 1,
    maskedAddress: full ? `bc1q…${full.slice(-4)}` : `bc1q…${["z7t0", "9x2n"][i % 2]}`,
    fullAddress: full,
    bestDiff: diff,
    blocks,
  }));
  return { winners, total: winners.length, matched: winners.filter((w) => w.fullAddress).length };
}

export async function getCadoWinners(): Promise<CadoWinnersData> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (config.mockData) {
    const data = mockWinners();
    cache = { at: Date.now(), data };
    return data;
  }

  try {
    const [rows, orders] = await Promise.all([
      getAllTimeTopDifficulty(100),
      getRouterOrders().catch(() => []),
    ]);
    const overs = rows.filter((r) => (r.bestDiff ?? 0) >= TEN_T);

    // last-4 → full addresses seen in the order book (for the masked→full join).
    const byLast4 = new Map<string, string[]>();
    for (const o of orders) {
      const a = o.address;
      if (!a || !a.startsWith("bc1")) continue;
      const k = a.slice(-4);
      const arr = byLast4.get(k) ?? [];
      if (!arr.includes(a)) arr.push(a);
      byLast4.set(k, arr);
    }

    const winners = overs
      .slice()
      .sort((a, b) => (b.bestDiff ?? 0) - (a.bestDiff ?? 0))
      .map((r, i) => {
        const masked = String(r.address);
        const cand = byLast4.get(masked.slice(-4)) ?? [];
        return {
          rank: i + 1,
          maskedAddress: masked,
          fullAddress: cand.length === 1 ? cand[0]! : null,
          bestDiff: r.bestDiff ?? 0,
          blocks: r.blocks ?? 0,
        };
      });

    const data: CadoWinnersData = {
      winners,
      total: winners.length,
      matched: winners.filter((w) => w.fullAddress).length,
    };
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return cache?.data ?? { winners: [], total: 0, matched: 0 };
  }
}

/** Just the matched full addresses — used by the poller to snapshot winners. */
export async function getCadoWinnerAddresses(): Promise<string[]> {
  const { winners } = await getCadoWinners();
  return winners.map((w) => w.fullAddress).filter((a): a is string => !!a);
}

/**
 * A masked→full address resolver built from the Refinery order book, so masked
 * leaderboard entries (bc1q…last4) can be linked to their real wallet page when
 * the last-4 is unique. Returns a function; null when no unique full match.
 * Cached ~30s via getRouterOrders' own cache.
 */
export type AddressResolver = (masked: string) => string | null;

export async function getAddressResolver(): Promise<AddressResolver> {
  if (config.mockData) {
    // In mock mode every masked leaderboard addr resolves to a demo wallet so the
    // "click through" affordance is visible in dev.
    return (masked) => `bc1qmock${String(masked).replace(/[^a-z0-9]/gi, "").slice(-6)}0000000000000000000000`;
  }
  const orders = await getRouterOrders().catch(() => []);
  const byLast4 = new Map<string, string[]>();
  for (const o of orders) {
    const a = o.address;
    if (!a || !a.startsWith("bc1")) continue;
    const k = a.slice(-4);
    const arr = byLast4.get(k) ?? [];
    if (!arr.includes(a)) arr.push(a);
    byLast4.set(k, arr);
  }
  return (masked: string) => {
    const c = byLast4.get(String(masked).slice(-4)) ?? [];
    return c.length === 1 ? c[0]! : null;
  };
}
