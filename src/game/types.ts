/**
 * Block Hunt leaderboard + stats — the shapes the server sends and the desktop
 * reads. Types only, so the shell can import them without pulling in a byte of
 * server code.
 *
 * Everything here is PRACTICE: runs are free, nothing is minted, no Ordinal is
 * inscribed, and every response says so (`practice: true`).
 */
import type { TierId } from "../econ/tokenomics.js";
import type { SteerLog } from "./inputs.js";

export type { SteerLog };

export type LeaderboardWindow = "today" | "week" | "all";

/** A run's numbers. On the board these are always the SERVER's, from replaying the run. */
export interface RunStats {
  /** The ticket's seed — runs are deterministic from it. */
  seed: number;
  score: number;
  /** Broke into the block before the run was lost. */
  won: boolean;
  nonces: number;
  /** Stale shares touched. */
  stale: number;
  /** Wall scrapes. */
  scrapes: number;
  /** Simulated length of the run. */
  durationMs: number;
  /** Whites the run paid out: 2 for a win, 1 for a loss. */
  whitesAwarded: number;
}

/** POST /api/game/start → the ticket a ranked run is played on. */
export interface RunTicket {
  ticket: string;
  /** Draw the shaft from this. It is the only seed a ranked run can be scored on. */
  seed: number;
  /** The replay's simulation rate, when the server has one wired. */
  tickHz: number | null;
  issuedAt: number;
  /** Submit before this, or the run is not ranked. */
  expiresAt: number;
  practice: true;
}

/** POST /api/game/runs — the ticket and the steer log. Nothing else is read. */
export interface RankedRunSubmission {
  ticket: string;
  inputs: SteerLog;
}

/** @deprecated The old client-scored report. The server ignores it — send a RankedRunSubmission. */
export type LegacyRunReport = RunStats;

/** One stored run. */
export interface RunRecord extends RunStats {
  id: string;
  /** The signed-in address that played it. */
  address: string;
  /** Server time it was accepted, unix ms. */
  at: number;
}

/** POST /api/game/runs → the server's verdict. */
export interface RunVerdict {
  ok: true;
  run: RunRecord;
  /** The numbers came from the server replaying the inputs. */
  verified: true;
  practice: true;
}

/** One stored burn: two of `fromTier` became one of `toTier`. */
export interface BurnRecord {
  id: string;
  address: string;
  at: number;
  fromTier: TierId;
  toTier: TierId;
}

export interface LeaderboardRow {
  rank: number;
  address: string;
  name: string;
  best: number;
  runs: number;
  wins: number;
  whitesWon: number;
  /** When they first hit their best in this window, unix ms — the tie-breaker. */
  bestAt: number;
}

export interface Leaderboard {
  window: LeaderboardWindow;
  /** Start of the window, unix ms; null for all time. */
  since: number | null;
  rows: LeaderboardRow[];
  /** Every run in the window, not just the ones on the board. */
  totalRuns: number;
  players: number;
  practice: true;
  generatedAt: number;
}

export type TierCounts = Partial<Record<TierId, number>>;

export interface PlayerStats {
  address: string;
  name: string;
  runs: number;
  wins: number;
  losses: number;
  /** 0..1; null before the first run. */
  winRate: number | null;
  best: number;
  whitesWon: number;
  /** Pieces burned, by tier (two per burn). */
  burned: TierCounts;
  /** Pieces made by burning, by tier. */
  made: TierCounts;
  firstAt: number | null;
  lastAt: number | null;
  practice: true;
}
