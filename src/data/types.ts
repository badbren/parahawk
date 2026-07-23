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
  /** Refinery hashprice in sats per PHd (~52,000 now). 0 when unavailable. */
  hashpriceSatsPerPhd: number;
  /** Total work accumulated since the last found block, in difficulty units. */
  workSinceLastBlockDiff?: number;
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
  /** Delivery route, from the worker username suffix (Refinery/Rigly/MRR/…). */
  provider?: string;
}

export interface WorkerRig {
  name: string;
  /** Live hashrate for this worker, PH/s. */
  hashratePhs: number;
  /** Best difficulty this worker has submitted. */
  bestDiff: number;
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
  /** Number of workers/rigs on this address. */
  workers?: number;
  /** Individual rigs (Bitaxe, NerdQAxe, …) with live hashrate + best diff. */
  rigs?: WorkerRig[];
  /** Blocks this address has participated in (from account metadata). */
  blockCount?: number;
  /** Uptime string as reported by Parasite (e.g. "14d 7h"). */
  uptime?: string;
}

export interface RefineryState {
  /** Current market hashprice, sats per PHd. */
  hashpriceSatsPerPhd: number;
  /** Optionally, a sample of live orders across the marketplace. */
  orders: RefineryOrder[];
}

/** A miner on a pool leaderboard (addresses are masked by Parasite). */
export interface LeaderboardEntry {
  rank: number;
  address: string;
  /** Best difficulty (for the difficulty board). */
  bestDiff?: number;
  /** Blocks participated in (for the loyalty board). */
  blocks?: number;
}

export interface Leaderboard {
  difficulty: LeaderboardEntry[];
  loyalty: LeaderboardEntry[];
}

export type HitTier = "sub" | "10T" | "21T" | "block";

/** A single big share ("Bravocado" 10T+ / "homeminers" 21T+) seen by the pool. */
export interface HitEvent {
  /** Stable unique id so repeated polls don't double-insert. */
  id: string;
  ts: number; // unix ms
  address: string;
  /** Share difficulty (difficulty units, e.g. 1.2e13 = 12T). */
  difficulty: number;
  tier: HitTier;
  /** Refinery order the share came from, if attributable. */
  orderId: string | null;
  worker: string | null;
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
