/**
 * A wallet's pool numbers in a nutshell, for the Profile's Parahawk section —
 * the headline figures of its wallet page (/address/<addr>), from the same
 * sources and the same math (services/round-stake.ts).
 *
 * READ-ONLY on purpose. The wallet page also indexes the wallet (snapshots,
 * tracked address, badges) as a side effect of being viewed; this does none of
 * that, so opening a Profile never writes to the database.
 */
import { getUserStats } from "../data/parasite.js";
import { BADGE_DEFS } from "../data/badges.js";
import { getStore } from "../db/index.js";
import type { AddressSnapshot } from "../db/types.js";
import { computeOdometer } from "../math/work.js";
import { getOverview } from "../services/overview.js";
import { potMathFromOverview } from "../services/potmath.js";
import { roundStake } from "../services/round-stake.js";

export interface PoolHeadline {
  address: string;
  hashratePhs: number;
  bestDifficulty: number;
  /** Best share as a percentage of a block's difficulty. */
  bestDiffBlockPercent: number;
  lifetimePhd: number;
  luckRatio: number;
  cadosWon: number;
  blocksFound: number;
  blocksParticipated: number;
  /** Lifetime Refinery rental orders (Parasite's count), and how many are running now. */
  refineryOrders: number;
  activeOrders: number;
  /** "Your cut if the pot cracked right now", as on the wallet page. */
  stake: { sats: number; usd: number; pct: number; assumedFull: boolean };
  /** The same, from active rentals alone — null when there are none. */
  rentalStake: { sats: number; usd: number } | null;
  /** Parasite badges this wallet has earned. */
  parasiteBadges: Array<{ key: string; emoji: string; name: string; count: number }>;
  potAgeHours: number;
  generatedAt: number;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; v: PoolHeadline }>();

export async function getPoolHeadline(address: string, now = Date.now()): Promise<PoolHeadline> {
  const hit = cache.get(address);
  if (hit && now - hit.at < CACHE_MS) return hit.v;

  const [o, u, snaps] = await Promise.all([
    getOverview(),
    getUserStats(address),
    getStore().getAddressSnapshots(address, 500).catch(() => [] as AddressSnapshot[]),
  ]);
  const pm = potMathFromOverview(o);
  const odo = computeOdometer(u.totalWorkDiff, u.bestDifficulty, o.pool.networkDifficulty);
  const st = roundStake({
    now, potAgeHours: o.potAge.hours, potW: pm.W, btcUsd: o.pool.btcPriceUsd,
    totalWorkDiff: u.totalWorkDiff, orders: u.orders, snapshots: snaps,
  });
  const badges = u.badges ?? {};

  const v: PoolHeadline = {
    address,
    hashratePhs: u.hashratePhs,
    bestDifficulty: odo.bestDiff,
    bestDiffBlockPercent: odo.bestDiffBlockPercent,
    lifetimePhd: odo.lifetimePhd,
    luckRatio: odo.luckRatio,
    cadosWon: u.cadosWon ?? 0,
    blocksFound: u.blocksFound ?? 0,
    blocksParticipated: u.blocksParticipated ?? 0,
    refineryOrders: u.refineryOrderCount ?? u.orders.length,
    activeOrders: u.orders.filter((x) => x.status === "active").length,
    stake: { sats: st.stakeSats, usd: st.stakeUsd, pct: st.roundPct, assumedFull: st.assumedFull },
    rentalStake: st.rentalRoundPhd > 0 ? { sats: st.rentalStakeSats, usd: st.rentalStakeUsd } : null,
    parasiteBadges: BADGE_DEFS
      .filter((b) => (badges[b.key] ?? 0) > 0)
      .map((b) => ({ key: b.key, emoji: b.emoji, name: b.name, count: badges[b.key] ?? 0 })),
    potAgeHours: o.potAge.hours,
    generatedAt: now,
  };
  if (cache.size > 500) cache.clear();
  cache.set(address, { at: now, v });
  return v;
}
