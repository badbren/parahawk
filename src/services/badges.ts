import { getStore } from "../db/index.js";
import { getCadoData } from "./cados.js";
import { BADGE_DEFS, BLOCK_FINDERS } from "../data/badges.js";

/**
 * Badge index for the /badges tab.
 *
 * Most badges are served from the `account_badges` table Parahawk fills as
 * winners are snapshotted and wallets are searched — coverage grows over time.
 * Two badges are AUTHORITATIVE and deliberately bypass that noisy index:
 *
 *  • Bravocado    → the cados actually dispensed on-chain by the OMB dispensary
 *                   (getCadoData, ~60). That's the real reward for hitting a 10T+
 *                   share. The per-wallet index over-counts it wildly, so we
 *                   never use it here.
 *  • Block Finder → a tiny curated set of the wallets that actually solved a
 *                   Parasite block (data/badges.BLOCK_FINDERS). Parasite exposes
 *                   no block-finder feed, so this is the only honest source.
 *
 * The rest (refinery, block, miner, loyalty, dispenser) are still index-derived,
 * so their counts are "indexed coverage", not pool-wide totals — see the /badges
 * copy. Buttoning those up is the ongoing indexing-accuracy work.
 */

export interface BadgeHolder {
  address: string; // full or masked
  full: string | null; // clickable when present
  count: number;
}

export interface MostBadgesRow {
  address: string;
  full: string | null;
  distinct: number; // number of distinct badge types held
  total: number; // sum of all badge counts
  keys: string[]; // badge keys held (for icons)
}

export interface BadgesIndex {
  /** badge key → number of wallets known to hold it. */
  holders: Record<string, number>;
  /** badge key → summed count across all holders (total activity). */
  totals: Record<string, number>;
  mostBadges: MostBadgesRow[];
  indexedWallets: number;
}

/** Badges whose count comes from an authoritative source, never account_badges. */
const AUTHORITATIVE = new Set(["block_winner", "bravocado"]);

/** The pool's real block finders — authoritative curated set (data/badges.ts). */
export function getBlockFinders(): BadgeHolder[] {
  return BLOCK_FINDERS.map((f) => ({
    address: f.address,
    full: f.address,
    count: f.blocks ?? Math.max(1, f.heights?.length ?? 1),
  }));
}

/** Mask a full address to bc1…last4 for display when we don't want a link. */
function maskAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export async function getBadgesIndex(): Promise<BadgesIndex> {
  const [rows, cado] = await Promise.all([
    getStore().getAccountBadges(2000).catch(() => []),
    getCadoData().catch(() => null),
  ]);

  const holders: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const def of BADGE_DEFS) {
    holders[def.key] = 0;
    totals[def.key] = 0;
  }
  for (const r of rows) {
    for (const [k, n] of Object.entries(r.badges)) {
      // Skip the authoritative badges — their real counts are set below, so the
      // noisy per-wallet index never inflates them.
      if (AUTHORITATIVE.has(k)) continue;
      if (n > 0) {
        holders[k] = (holders[k] ?? 0) + 1;
        totals[k] = (totals[k] ?? 0) + n;
      }
    }
  }

  // Bravocado = real cados dispensed on-chain by the OMB dispensary (~60): the
  // miners who actually hit a 10T+ share. NOT the account_badges count.
  const cadoCount = cado?.count ?? 0;
  holders.bravocado = cadoCount;
  totals.bravocado = cadoCount;

  // Block Finder = the curated real block finders.
  const finders = getBlockFinders();
  holders.block_winner = finders.length;
  totals.block_winner = finders.reduce((s, f) => s + f.count, 0);

  const mostBadges: MostBadgesRow[] = rows
    .map((r) => {
      const entries = Object.entries(r.badges).filter(([k, n]) => k !== "block_winner" && n > 0);
      const keys = entries.map(([k]) => k);
      const total = entries.reduce((s, [, n]) => s + (n || 0), 0);
      return { address: r.address, full: r.address, distinct: keys.length, total, keys };
    })
    .filter((m) => m.distinct > 0)
    .sort((a, b) => b.distinct - a.distinct || b.total - a.total)
    .slice(0, 50);

  return { holders, totals, mostBadges, indexedWallets: rows.length };
}

/** Holders of a single badge type. */
export async function getBadgeHolders(type: string): Promise<BadgeHolder[]> {
  // Block Finder — curated authoritative set (never the noisy badge index).
  if (type === "block_winner") return getBlockFinders();

  // Bravocado — the wallets actually dispensed a cado on-chain (~60), newest
  // first. Recipients are ordinal (bc1p) wallets, not bc1q mining addresses, so
  // they're shown masked and don't link through to miner stats.
  if (type === "bravocado") {
    const cado = await getCadoData().catch(() => null);
    return [...(cado?.awards ?? [])]
      .sort((a, b) => b.ts - a.ts)
      .map((a) => ({ address: maskAddr(a.recipient), full: null, count: 1 }));
  }

  const rows = await getStore().getAccountBadges(2000).catch(() => []);
  return rows
    .filter((r) => (r.badges[type] ?? 0) > 0)
    .map((r) => ({ address: r.address, full: r.address, count: r.badges[type] ?? 0 }))
    .sort((a, b) => b.count - a.count);
}
