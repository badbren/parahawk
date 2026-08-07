import { getStore } from "../db/index.js";
import { PHD_TO_DIFF } from "../math/constants.js";

/**
 * Delivery Auditor — "did you get what you paid for?"
 *
 * Compares the PHd a rental promised against the PHd actually delivered to a
 * bitcoin address over a window, measured pool-side from the monotonic
 * total-work counter Parahawk already snapshots (totalWork is in difficulty
 * units; 1 PHd = PHD_TO_DIFF units). It is honest about resolution: if we don't
 * have snapshots spanning most of the window, it says so rather than pretend to
 * a precision it doesn't have.
 */

export type DeliveryVerdict = "delivered" | "partial" | "under" | "insufficient";

export interface DeliveryAudit {
  address: string;
  promisedPhd: number;
  windowHours: number;
  deliveredPhd: number | null;
  pct: number | null;
  verdict: DeliveryVerdict;
  /** Hours actually covered by the snapshots we have. */
  coveredHours: number;
  caveat: string | null;
  /** One-line summary suitable for pasting into Discord. */
  shareLine: string;
}

export async function auditDelivery(
  address: string,
  promisedPhd: number,
  windowHours: number,
): Promise<DeliveryAudit> {
  const now = Date.now();
  const cutoff = now - windowHours * 3_600_000;

  const snaps = (await getStore().getAddressSnapshots(address, 1000).catch(() => []))
    .filter((s) => s.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts);

  const base: Omit<DeliveryAudit, "deliveredPhd" | "pct" | "verdict" | "coveredHours" | "caveat" | "shareLine"> = {
    address,
    promisedPhd,
    windowHours,
  };

  if (snaps.length < 2) {
    return {
      ...base,
      deliveredPhd: null,
      pct: null,
      verdict: "insufficient",
      coveredHours: 0,
      caveat: "Not enough pool-side samples for this address/window yet — Parahawk builds this history forward as it polls.",
      shareLine: `⚠️ Not enough data yet to audit ${short(address)} over ${windowHours}h.`,
    };
  }

  const first = snaps[0]!;
  const last = snaps[snaps.length - 1]!;
  const coveredHours = (last.ts - first.ts) / 3_600_000;
  const deliveredPhd = Math.max(0, (last.totalWork - first.totalWork) / PHD_TO_DIFF);
  const pct = promisedPhd > 0 ? (deliveredPhd / promisedPhd) * 100 : 0;

  let verdict: DeliveryVerdict;
  if (pct >= 95) verdict = "delivered";
  else if (pct >= 80) verdict = "partial";
  else verdict = "under";

  const coarse = coveredHours < windowHours * 0.5;
  const caveat = coarse
    ? `Snapshots only cover ~${coveredHours.toFixed(1)}h of the ${windowHours}h window, so this is a coarse read.`
    : null;

  const emoji = verdict === "delivered" ? "✅" : verdict === "partial" ? "🟡" : "⚠️";
  const shareLine =
    `${emoji} Parahawk delivery audit — ${short(address)}: ${pct.toFixed(1)}% ` +
    `(${deliveredPhd.toFixed(1)} PHd delivered vs ${promisedPhd.toFixed(1)} promised, ${windowHours}h)` +
    (coarse ? " · coarse sample" : "");

  return { ...base, deliveredPhd, pct, verdict, coveredHours, caveat, shareLine };
}

function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr;
}
