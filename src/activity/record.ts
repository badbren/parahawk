/**
 * Site activity, write side — what other features report so the Parahawk badges
 * can count it (src/activity/badges.ts). Fire-and-forget: callers never wait on
 * it and it never throws.
 *
 *   Chat          recordActivity(address, "chat_message")
 *   Suggestions   recordActivity(address, "suggestion")
 *   /address/:a   recordActivity(viewer, viewer === a ? "self_search" : "wallet_search", a)
 *
 * Time on site is not reported here: the desktop's heartbeat posts to
 * /api/activity/ping (src/web/activity-routes.ts).
 */
import { stampAfterActivity } from "./earned.js";
import { sharedActivityStore } from "./store.js";

export type ActivityKind =
  /** Looked up their OWN wallet on the site (signed-in address === searched address). */
  | "self_search"
  /** Looked up someone else's wallet. */
  | "wallet_search"
  /** Posted in Chat. */
  | "chat_message"
  /** Sent a suggestion. */
  | "suggestion";

/**
 * Count one event for a signed-in address. For a wallet search, pass the
 * searched address too: when it is the address they told us they mine to
 * (Profile → Parahawk), it counts as looking themselves up.
 */
export async function recordActivity(address: string, kind: ActivityKind, searched?: string): Promise<void> {
  try {
    const store = sharedActivityStore();
    let k = kind;
    if (k === "wallet_search" && searched) {
      const rec = await store.get(address);
      if (rec?.poolAddress && rec.poolAddress.toLowerCase() === searched.toLowerCase()) k = "self_search";
    }
    const now = Date.now();
    const rec = await store.bump(address, k, now);
    // A first chat message or a self-lookup can earn a badge: note when (never throws).
    await stampAfterActivity(store, rec, now);
  } catch (err) {
    console.error("[activity] record failed:", (err as Error).message);
  }
}
