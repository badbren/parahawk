/**
 * Parahawk badges as other people see them: the little chips next to a name in
 * Chat and on someone's profile.
 *
 * Chat asks on every poll for the authors in view, so this is batched and
 * cached: ONE store read per call for whichever addresses aren't cached
 * (store.getMany), answers kept CACHE_MS. The Renter badge needs the
 * Marketplace order log, which is per address and changes rarely — kept longer,
 * and given up on quickly rather than holding up a chat poll.
 *
 * Chips show only the top tier of each ladder, most impressive first
 * (badges.ts chipBadges). The owner holds every badge (badges.ts).
 */
import { chipBadges, evaluateBadges } from "./badges.js";
import { isOwnerAddress } from "./owner.js";
import { countersOf } from "./rules.js";
import { sharedActivityStore, type ActivityStore } from "./store.js";
import { getWizardOrders } from "../services/wizard-orders.js";

export interface BadgeChip {
  id: string;
  /** The badge's small icon (emoji), drawn as the chip. */
  emoji: string;
  /** Its name, for the chip's tooltip. */
  name: string;
  /** "pool" = a Parasite Pool badge (shown first); absent or "parahawk" = one of ours. */
  kind?: "pool" | "parahawk";
}

const CACHE_MS = 30_000;
const RENTALS_MS = 5 * 60_000;
/** A slow order log costs the Renter badge for one round, not the whole poll. */
const RENTALS_WAIT_MS = 1_500;
const MAX_CACHED = 5_000;

export interface PublicBadgeDeps {
  store?: ActivityStore;
  /** Real (not dry-run) Marketplace rentals placed through Parahawk by this address. */
  rentals?: (address: string) => Promise<number>;
  owner?: (address: string) => boolean;
  now?: () => number;
}

let deps: PublicBadgeDeps = {};
const chips = new Map<string, { at: number; v: BadgeChip[] }>();
const rentalCache = new Map<string, { at: number; n: number; ttl: number }>();

/** Swap what this reads (tests). Clears the caches. */
export function usePublicBadgeDeps(next: PublicBadgeDeps | null): void {
  deps = next ?? {};
  chips.clear();
  rentalCache.clear();
}

const realRentals = async (address: string): Promise<number> =>
  (await getWizardOrders(address, 100)).filter((o) => o.status !== "dryrun").length;

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });
}

async function rentalsOf(address: string, now: number): Promise<number> {
  const hit = rentalCache.get(address);
  if (hit && now - hit.at < hit.ttl) return hit.n;
  try {
    const n = await within((deps.rentals ?? realRentals)(address), RENTALS_WAIT_MS);
    if (rentalCache.size > MAX_CACHED) rentalCache.clear();
    rentalCache.set(address, { at: now, n, ttl: RENTALS_MS });
    return n;
  } catch {
    // Slow or failing: keep what we knew, and ask again on the next chat-cache round.
    const n = hit?.n ?? 0;
    rentalCache.set(address, { at: now, n, ttl: CACHE_MS });
    return n;
  }
}

/** Earned Parahawk badges per address, most impressive first. Addresses with none are absent. Never throws. */
export async function earnedBadgesFor(addresses: readonly string[]): Promise<Map<string, BadgeChip[]>> {
  const out = new Map<string, BadgeChip[]>();
  const now = (deps.now ?? Date.now)();
  const misses: string[] = [];
  for (const a of new Set(addresses)) {
    if (typeof a !== "string" || a === "") continue;
    const hit = chips.get(a);
    if (hit && now - hit.at < CACHE_MS) {
      if (hit.v.length > 0) out.set(a, hit.v);
    } else {
      misses.push(a);
    }
  }
  if (misses.length === 0) return out;

  try {
    const [records, rentals] = await Promise.all([
      (deps.store ?? sharedActivityStore()).getMany(misses),
      Promise.all(misses.map((a) => rentalsOf(a, now))),
    ]);
    if (chips.size > MAX_CACHED) chips.clear();
    const owner = deps.owner ?? isOwnerAddress;
    misses.forEach((a, i) => {
      const rec = records.get(a) ?? null;
      const views = evaluateBadges({ counters: countersOf(rec), rentals: rentals[i] ?? 0, firstSeen: rec?.firstSeen ?? null, now, owner: owner(a) });
      const v = chipBadges(views).map(({ id, emoji, name }) => ({ id, emoji, name }));
      chips.set(a, { at: now, v });
      if (v.length > 0) out.set(a, v);
    });
  } catch (err) {
    console.warn("[activity] badge chips failed:", (err as Error).message);
    // Better last minute's chips than none.
    for (const a of misses) {
      const stale = chips.get(a)?.v;
      if (stale && stale.length > 0) out.set(a, stale);
    }
  }
  return out;
}
