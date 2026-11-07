/**
 * When each Parahawk badge was earned — for the owner's dashboard ("who earned a
 * badge, and when"). Each activity record carries earnedAt: { badgeId: ms }.
 *
 * Stamped right after the activity that earns it — a heartbeat (time on site,
 * days) or an event (a search, a chat message) — so the time is real. A record
 * from before tracking began (earnedAt missing) is backfilled on its first
 * stamp: every badge it already holds gets 0, "before tracking", since nobody
 * knows when it happened.
 *
 * Two kinds of badge are never stamped here:
 *  - Renter: it comes from the Marketplace order log, not from activity, and its
 *    time is the first real order's own placedAt (the dashboard reads it there).
 *  - The owner's: the owner holds every badge outright (badges.ts); that isn't
 *    earning anything, so the owner is never stamped and never listed as an earner.
 */
import { PARAHAWK_BADGES, evaluateBadges } from "./badges.js";
import { isOwnerAddress } from "./owner.js";
import { countersOf, type ActivityRecord } from "./rules.js";
import type { ActivityStore } from "./store.js";

/** Badge ids that activity alone can't decide (the Marketplace order log does). */
export const ORDER_BADGES: ReadonlySet<string> = new Set(PARAHAWK_BADGES.filter((d) => d.metric === "rentals").map((d) => d.id));

/** The activity-decided badges this record holds right now. */
export function earnedFromActivity(rec: ActivityRecord, now: number): string[] {
  const views = evaluateBadges({
    counters: countersOf(rec),
    rentals: 0,
    firstSeen: rec.firstSeen > 0 ? rec.firstSeen : null,
    now,
  });
  return views.filter((v) => v.earned && !ORDER_BADGES.has(v.id)).map((v) => v.id);
}

/**
 * The stamps to add: `now` for each badge newly held. A record from before
 * tracking is backfilled instead — every badge it holds gets 0 — and gets an
 * (empty) map even when it holds none, so what it earns next is timed. Null =
 * nothing to write.
 */
export function stampsFor(rec: ActivityRecord, earned: readonly string[], now: number): Record<string, number> | null {
  if (rec.earnedAt == null) return Object.fromEntries(earned.map((id) => [id, 0]));
  const fresh = earned.filter((id) => !Object.prototype.hasOwnProperty.call(rec.earnedAt, id));
  return fresh.length > 0 ? Object.fromEntries(fresh.map((id) => [id, now])) : null;
}

/**
 * Stamp whatever this record has just earned. Fire-and-forget from the
 * heartbeat and recordActivity: never throws, writes only when something new
 * was earned (or the record is being backfilled).
 */
export async function stampAfterActivity(
  store: ActivityStore,
  rec: ActivityRecord,
  now: number,
  isOwner: (address: string) => boolean = isOwnerAddress,
): Promise<void> {
  try {
    if (isOwner(rec.address)) return;
    const stamps = stampsFor(rec, earnedFromActivity(rec, now), now);
    if (stamps) await store.stampEarned(rec.address, stamps);
  } catch (err) {
    console.warn("[activity] badge stamp failed:", (err as Error).message);
  }
}
