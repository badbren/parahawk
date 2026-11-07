/**
 * Badges next to a name: the Parasite Pool's own badges FIRST, Parahawk's after
 * them (owner, 2026-11-06: "prio showing PARASITE.POOL badges over ours in the
 * chat and everywhere, ours at the end. not as important just for fun").
 *
 * The pool badges come from what Parahawk already indexes — account_badges,
 * filled as wallets are searched and winners snapshotted — plus the two
 * authoritative lists the /badges page trusts over that index: the curated
 * block finders and the on-chain Bravocado awards. One read every few minutes
 * for everyone, never an upstream call per chat poll. Never throws.
 */
import { getStore } from "../db/index.js";
import { BADGE_DEFS } from "../data/badges.js";
import { getBlockFinders } from "../services/badges.js";
import { getCadoData } from "../services/cados.js";
import { canonicalAddress } from "../profile/rules.js";
import { earnedBadgesFor, type BadgeChip } from "./public.js";

const TTL_MS = 5 * 60_000;

/** canonical address → pool badge key → count. */
type PoolIndex = Map<string, Record<string, number>>;

async function loadIndex(): Promise<PoolIndex> {
  const [rows, cado] = await Promise.all([
    getStore().getAccountBadges(2000).catch(() => []),
    getCadoData().catch(() => null),
  ]);
  const by: PoolIndex = new Map();
  const add = (address: string, key: string, n: number) => {
    const k = canonicalAddress(address);
    const held = by.get(k) ?? {};
    held[key] = (held[key] ?? 0) + n;
    by.set(k, held);
  };
  for (const r of rows) {
    for (const [key, n] of Object.entries(r.badges)) {
      // The index over-counts these two; the authoritative lists below decide them.
      if (n > 0 && key !== "block_winner" && key !== "bravocado") add(r.address, key, n);
    }
  }
  for (const f of getBlockFinders()) if (f.full) add(f.full, "block_winner", f.count);
  for (const a of cado?.awards ?? []) add(a.recipient, "bravocado", 1);
  return by;
}

let source: () => Promise<PoolIndex> = loadIndex;
let cached: { at: number; index: PoolIndex } | null = null;
let inflight: Promise<PoolIndex> | null = null;

/** Swap where the pool badges come from (tests). Clears the cache. */
export function usePoolBadgeSource(next: (() => Promise<PoolIndex>) | null): void {
  source = next ?? loadIndex;
  cached = null;
  inflight = null;
}

async function index(now: number): Promise<PoolIndex> {
  if (cached && now - cached.at < TTL_MS) return cached.index;
  try {
    inflight ??= source().finally(() => { inflight = null; });
    const fresh = await inflight;
    cached = { at: now, index: fresh };
    return fresh;
  } catch (err) {
    console.warn("[badges] pool badge index failed:", (err as Error).message);
    return cached?.index ?? new Map(); // better a few minutes stale than none
  }
}

/** Parasite Pool badges per address, in the pool's own order (Block Finder first). Absent = none. */
export async function poolBadgesFor(addresses: readonly string[], now = Date.now()): Promise<Map<string, BadgeChip[]>> {
  const out = new Map<string, BadgeChip[]>();
  const idx = await index(now);
  for (const a of new Set(addresses)) {
    if (typeof a !== "string" || a === "") continue;
    const held = idx.get(canonicalAddress(a));
    if (!held) continue;
    const chips = BADGE_DEFS
      .filter((d) => (held[d.key] ?? 0) > 0)
      .map((d): BadgeChip => ({ id: `pool:${d.key}`, emoji: d.emoji, name: d.name, kind: "pool" }));
    if (chips.length > 0) out.set(a, chips);
  }
  return out;
}

/**
 * Every badge chip for each name, pool badges first, then Parahawk's.
 * `showPool(address)` says whether that person's pool badges may show — false
 * for someone private, because pool badges belong to the wallet and would tie
 * their name to it.
 */
export async function nameBadgesFor(
  addresses: readonly string[],
  showPool: (address: string) => boolean = () => true,
): Promise<Map<string, BadgeChip[]>> {
  const list = [...new Set(addresses)];
  const [pool, ours] = await Promise.all([
    poolBadgesFor(list.filter((a) => showPool(a))),
    earnedBadgesFor(list),
  ]);
  const out = new Map<string, BadgeChip[]>();
  for (const a of list) {
    const chips = [...(pool.get(a) ?? []), ...(ours.get(a) ?? []).map((c): BadgeChip => ({ ...c, kind: c.kind ?? "parahawk" }))];
    if (chips.length > 0) out.set(a, chips);
  }
  return out;
}
