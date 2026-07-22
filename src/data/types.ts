/**
 * Typed shapes for Parasite Pool data. These are the contract the rest of the
 * app depends on; the real (undocumented) API is mapped into these in
 * parasite.ts. Fill the mapping once you paste real XHR samples.
 */

export interface PoolStats {
  /** Live pool hashrate in PH/s. */
  poolHashratePhs: number;
  /** Trailing averages shown on the gauge, PH/s. */
  avg1dPhs: number;
  avg6dPhs: number;
  avg9dPhs: number;
  /** Bitcoin block height Parasite last found a block at. */
  lastFoundHeight: number;
  /** Highest share difficulty seen since the last found block. */
  highestDiffSinceBlock: number;
  /** Network difficulty ("Minimum Needed Diff"), ~127e12. */
  networkDifficulty: number;
  /** Distinct users and workers currently on the pool. */
  users: number;
  workers: number;
  /** BTC spot price in USD (Parasite shows this; we also get it from mempool). */
  btcPriceUsd: number;
  /** Refinery hashprice in sats per PHd (~52,000 now). */
  hashpriceSatsPerPhd: number;
}

export type OrderStatus = "active" | "fulfilled" | "expired";

export interface RefineryOrder {
  id: string;
  status: OrderStatus;
  /** PHd of work requested by the order. */
  requestedPhd: number;
  /** Hashrate the order is running at, PH/s. */
  hashratePhs: number;
  /** Best share difficulty the order has produced. */
  bestShare: number;
  /** Progress toward fulfilment, 0–100. */
  progressPercent: number;
}

export interface UserStats {
  address: string;
  /** Live hashrate for this address, PH/s. */
  hashratePhs: number;
  /** Best difficulty this address has ever submitted. */
  bestDifficulty: number;
  /** Total accumulated work, in difficulty units. */
  totalWorkDiff: number;
  /** Refinery orders belonging to this address. */
  orders: RefineryOrder[];
}

export interface RefineryState {
  /** Current market hashprice, sats per PHd. */
  hashpriceSatsPerPhd: number;
  /** Optionally, a sample of live orders across the marketplace. */
  orders: RefineryOrder[];
}

/** Chain data from mempool.space. */
export interface ChainTip {
  height: number;
  difficulty: number;
  btcPriceUsd: number;
}

/** A data source can report itself stale so the UI can show a banner. */
export interface Freshness {
  ok: boolean;
  /** Unix ms of the last successful fetch, or null if never. */
  lastSuccess: number | null;
  /** Whether the value returned is cached/stale. */
  stale: boolean;
}
