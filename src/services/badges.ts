import { getStore } from "../db/index.js";
import { getCadoWinners } from "./winners.js";
import { BADGE_DEFS } from "../data/badges.js";

/**
 * Badge index for the /badges tab. There's no badges endpoint, so we serve from
 * the `account_badges` table Parahawk fills as winners are snapshotted and
 * wallets are searched (see the poller + address page). Coverage grows over time
 * — the ONE exception is the Bravocado badge, whose complete holder set is the
 * all-time ≥10T winners (getCadoWinners), so that one is authoritative day one.
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

export async function getBadgesIndex(): Promise<BadgesIndex> {
  const [rows, winners] = await Promise.all([
    getStore().getAccountBadges(2000).catch(() => []),
    getCadoWinners().catch(() => ({ winners: [], total: 0, matched: 0 })),
  ]);

  const holders: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const def of BADGE_DEFS) {
    holders[def.key] = 0;
    totals[def.key] = 0;
  }
  for (const r of rows) {
    for (const [k, n] of Object.entries(r.badges)) {
      if (n > 0) {
        holders[k] = (holders[k] ?? 0) + 1;
        totals[k] = (totals[k] ?? 0) + n;
      }
    }
  }
  // Bravocado holder count is authoritative from the winners list.
  holders.bravocado = Math.max(holders.bravocado ?? 0, winners.total);
  totals.bravocado = Math.max(totals.bravocado ?? 0, winners.total);

  const mostBadges: MostBadgesRow[] = rows
    .map((r) => {
      const keys = Object.entries(r.badges)
        .filter(([, n]) => n > 0)
        .map(([k]) => k);
      const total = Object.values(r.badges).reduce((s, n) => s + (n || 0), 0);
      return { address: r.address, full: r.address, distinct: keys.length, total, keys };
    })
    .filter((m) => m.distinct > 0)
    .sort((a, b) => b.distinct - a.distinct || b.total - a.total)
    .slice(0, 50);

  return { holders, totals, mostBadges, indexedWallets: rows.length };
}

/** Holders of a single badge type. Bravocado uses the complete winners list. */
export async function getBadgeHolders(type: string): Promise<BadgeHolder[]> {
  if (type === "bravocado") {
    const { winners } = await getCadoWinners();
    return winners.map((w) => ({
      address: w.fullAddress ?? w.maskedAddress,
      full: w.fullAddress,
      count: 1,
    }));
  }
  const rows = await getStore().getAccountBadges(2000).catch(() => []);
  return rows
    .filter((r) => (r.badges[type] ?? 0) > 0)
    .map((r) => ({ address: r.address, full: r.address, count: r.badges[type] ?? 0 }))
    .sort((a, b) => b.count - a.count);
}
