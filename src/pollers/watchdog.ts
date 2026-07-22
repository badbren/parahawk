import { getUserStats } from "../data/parasite.js";
import { bus } from "../events.js";
import type { Store, WatchSubscription } from "../db/types.js";

const STUCK_MS = 2 * 60 * 60 * 1000; // alert if an order sits at 0% for >2h

interface OrderMemory {
  progress: number;
  zeroSince: number | null;
  alertedStuck: boolean;
  alertedFulfilled: boolean;
}

type OrderStateMap = Record<string, OrderMemory>;

/**
 * Order watchdog: for every watched address, alert once if a Refinery order sits
 * at 0% progress for more than 2 hours, and celebrate orders that become
 * fulfilled. Per-order bookkeeping is stored on the subscription so we neither
 * spam nor miss transitions across restarts (when backed by Supabase).
 */
export async function checkWatches(store: Store): Promise<void> {
  const subs = await store.listWatches();
  for (const sub of subs) {
    try {
      await checkOne(store, sub);
    } catch (err) {
      console.error(`[watchdog:${sub.address}]`, (err as Error).message);
    }
  }
}

async function checkOne(store: Store, sub: WatchSubscription): Promise<void> {
  if (sub.id === undefined) return;
  const user = await getUserStats(sub.address);
  const prev = (sub.lastOrderState as OrderStateMap | null) ?? {};
  const next: OrderStateMap = {};
  const now = Date.now();

  for (const order of user.orders) {
    const mem: OrderMemory =
      prev[order.id] ?? { progress: order.progressPercent, zeroSince: null, alertedStuck: false, alertedFulfilled: false };

    // fulfilled celebration
    if (order.status === "fulfilled" && !mem.alertedFulfilled) {
      bus.emitWatchAlert({
        channelId: sub.channelId,
        address: sub.address,
        kind: "fulfilled",
        orderId: order.id,
        detail: `Order ${order.id} fulfilled — ${order.requestedPhd} PHd delivered, best share ${order.bestShare.toExponential(2)}.`,
      });
      mem.alertedFulfilled = true;
    }

    // stuck-at-zero watchdog
    if (order.status === "active" && order.progressPercent === 0) {
      mem.zeroSince = mem.zeroSince ?? now;
      if (!mem.alertedStuck && now - mem.zeroSince > STUCK_MS) {
        bus.emitWatchAlert({
          channelId: sub.channelId,
          address: sub.address,
          kind: "stuck",
          orderId: order.id,
          detail: `Order ${order.id} has sat at 0% for over 2h (${order.requestedPhd} PHd requested).`,
        });
        mem.alertedStuck = true;
      }
    } else {
      mem.zeroSince = null;
      mem.alertedStuck = false;
    }

    mem.progress = order.progressPercent;
    next[order.id] = mem;
  }

  await store.updateWatchState(sub.id, { lastOrderState: next });
}
