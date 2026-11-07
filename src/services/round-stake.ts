import { stakeValue } from "../math/potmath.js";
import { PHD_TO_DIFF } from "../math/constants.js";
import type { RefineryOrder } from "../data/types.js";
import type { AddressSnapshot } from "../db/types.js";

/**
 * A wallet's stake in the CURRENT pot — "your cut if the pot cracked right now"
 * on the wallet page (src/web/pages/address.ts), and the same number in the
 * Profile's Parahawk section. Pure: the caller fetches the inputs.
 *
 * Stake = (your work this round / pool work this round) × pot. Parasite exposes
 * no per-wallet round work — but total_diff is this wallet's LIFETIME
 * cumulative work (a monotonic counter stored in every snapshot), so
 * work-this-round = current total_diff − total_diff at the last block. The
 * delta of two total_diff readings is EXACT work done between them. Each
 * tracked wallet is baselined at round start; accurate for wallets tracked
 * since the last block, a floor for ones only just being watched.
 */
export interface RoundStakeInput {
  now: number;
  /** Hours since the pool's last block (overview potAge.hours). */
  potAgeHours: number;
  /** The pool's total round work W, in T (potMath W). */
  potW: number;
  btcUsd: number;
  /** This wallet's lifetime work (total_diff), in difficulty units. */
  totalWorkDiff: number;
  orders: ReadonlyArray<Pick<RefineryOrder, "status" | "deliveredPhd" | "requestedPhd" | "progressPercent">>;
  snapshots: ReadonlyArray<Pick<AddressSnapshot, "ts" | "totalWork">>;
}

export interface RoundStake {
  /** The pool's total round work, in difficulty units. */
  wDiff: number;
  roundWorkDiff: number;
  roundPhd: number;
  /** This wallet's share of the round's work, in percent. */
  roundPct: number;
  /** True when all-time work stands in for this round's (no round-start baseline). */
  assumedFull: boolean;
  stakeSats: number;
  stakeUsd: number;
  /** Delivered work on ACTIVE Refinery orders, and the stake it alone is worth. */
  rentalRoundPhd: number;
  rentalStakeSats: number;
  rentalStakeUsd: number;
}

export function roundStake(i: RoundStakeInput): RoundStake {
  const lastBlockMs = i.now - i.potAgeHours * 3_600_000;
  const roundMs = Math.max(1, i.now - lastBlockMs);
  const wDiff = i.potW * 1e12; // pool's total round work, in difficulty units
  const inRound = i.snapshots
    .filter((s) => s.ts >= lastBlockMs && s.totalWork > 0)
    .sort((a, b) => a.ts - b.ts);
  const baseline = inRound[0] ?? null;
  // A baseline only helps if we captured it NEAR round start; otherwise it just
  // marks when we began watching (mid-round) and would undercount badly.
  const nearStart = baseline !== null && baseline.ts - lastBlockMs < 0.2 * roundMs;
  let roundWorkDiff: number;
  let assumedFull: boolean;
  if (nearStart && i.totalWorkDiff >= baseline!.totalWork) {
    // Exact: growth in total_diff since a round-start baseline.
    roundWorkDiff = Math.max(0, i.totalWorkDiff - baseline!.totalWork);
    assumedFull = false;
  } else {
    // No round-start baseline — treat this wallet's ALL-TIME work as this round's.
    // Exact for anyone who started at/after the last block (most renters + new
    // miners); an over-estimate for miners who ran in earlier rounds too. Capped
    // at the pool's total round work as a sanity bound.
    roundWorkDiff = Math.min(i.totalWorkDiff, wDiff);
    assumedFull = true;
  }
  const roundG = roundWorkDiff / 1e9;
  const roundPhd = roundWorkDiff / PHD_TO_DIFF;
  const roundPct = wDiff > 0 ? (roundWorkDiff / wDiff) * 100 : 0;
  const stakeSats = stakeValue(roundG, i.potW);
  const stakeUsd = i.btcUsd > 0 ? (stakeSats / 1e8) * i.btcUsd : 0;

  // Rental-based estimate: delivered work on this wallet's ACTIVE Refinery orders
  // (running now = this round). A data-grounded figure for renters that works
  // even before a total_diff baseline exists.
  const rentalRoundPhd = i.orders
    .filter((ord) => ord.status === "active")
    .reduce((s, ord) => s + (ord.deliveredPhd ?? (ord.requestedPhd * ord.progressPercent) / 100), 0);
  const rentalStakeSats = stakeValue((rentalRoundPhd * PHD_TO_DIFF) / 1e9, i.potW);
  const rentalStakeUsd = i.btcUsd > 0 ? (rentalStakeSats / 1e8) * i.btcUsd : 0;

  return { wDiff, roundWorkDiff, roundPhd, roundPct, assumedFull, stakeSats, stakeUsd, rentalRoundPhd, rentalStakeSats, rentalStakeUsd };
}
