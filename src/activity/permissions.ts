/**
 * What a signed-in address may do beyond reading — perks that come with a
 * Parahawk badge. The owner can always do everything.
 *
 *   edit_prices   update a hand-typed venue price (Kiss My Hash, …) on the
 *                 Marketplace when it has gone stale. Earned with the
 *                 "Trusted" badge (src/activity/badges.ts: TRUSTED_MIN_SECONDS
 *                 on the site over TRUSTED_MIN_DAYS different days).
 *
 * Read from the activity store (the same record the badges are drawn from),
 * with a short cache: a price edit checks this on every save.
 */
import { isTrusted } from "./badges.js";
import { countersOf } from "./rules.js";
import { sharedActivityStore, type ActivityStore } from "./store.js";

export type Permission = "edit_prices";

export interface PermissionQuery {
  /** True when the caller already knows this is the owner (isAdmin(session)). */
  admin?: boolean;
}

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; trusted: boolean }>();
let storeOverride: ActivityStore | null = null;

/** Swap the store this reads (tests). Clears the cache. */
export function usePermissionStore(store: ActivityStore | null): void {
  storeOverride = store;
  cache.clear();
}

/** Never throws: on any failure the answer is "no extra permissions". */
export async function permissionsFor(address: string, opts: PermissionQuery = {}): Promise<Set<Permission>> {
  if (opts.admin) return new Set<Permission>(["edit_prices"]);
  if (typeof address !== "string" || address === "") return new Set<Permission>();
  try {
    const now = Date.now();
    let hit = cache.get(address);
    if (!hit || now - hit.at >= CACHE_MS) {
      const rec = await (storeOverride ?? sharedActivityStore()).get(address);
      hit = { at: now, trusted: isTrusted(countersOf(rec)) };
      if (cache.size > 5_000) cache.clear();
      cache.set(address, hit);
    }
    return hit.trusted ? new Set<Permission>(["edit_prices"]) : new Set<Permission>();
  } catch (err) {
    console.warn("[activity] permission check failed:", (err as Error).message);
    return new Set<Permission>();
  }
}
