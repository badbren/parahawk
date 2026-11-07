/**
 * The leaderboard and a player's stats.
 *
 * Two steps, so the arithmetic is the same wherever the rows live: AGGREGATE
 * (best per address in a window; one player's totals) — done here for the
 * file/memory stores and by SQL functions for Postgres (the migration mirrors
 * these rules exactly) — then RANK/NAME, which is always done here.
 */
import type { TierId } from "../econ/tokenomics.js";
import type {
  BurnRecord,
  Leaderboard,
  LeaderboardRow,
  LeaderboardWindow,
  PlayerStats,
  RunRecord,
  TierCounts,
} from "./types.js";

const DAY_MS = 86_400_000;

export const LEADERBOARD_WINDOWS: readonly LeaderboardWindow[] = ["today", "week", "all"];

export const isLeaderboardWindow = (s: unknown): s is LeaderboardWindow =>
  typeof s === "string" && (LEADERBOARD_WINDOWS as readonly string[]).includes(s);

/** Start of a window in unix ms: today = since UTC midnight, week = the last 7 days, all = null. */
export function windowStart(window: LeaderboardWindow, now: number): number | null {
  if (window === "all") return null;
  if (window === "week") return now - 7 * DAY_MS;
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** One player's line before ranking and naming. */
export type BoardEntry = Omit<LeaderboardRow, "rank" | "name">;

export interface BoardAggregate {
  /** Ranked best-first, at most the limit asked for. */
  entries: BoardEntry[];
  /** Everyone who played in the window. */
  players: number;
  /** Every run in the window. */
  totalRuns: number;
}

/**
 * Best score per address among runs at or after `since`. Ties go to whoever
 * got there first, then to fewer runs — a best that took fewer tries is the
 * better best — then to address order.
 */
export function aggregateBoard(runs: readonly RunRecord[], since: number | null, limit: number): BoardAggregate {
  const inWindow = since === null ? runs : runs.filter((r) => r.at >= since);
  const by = new Map<string, BoardEntry>();
  for (const r of inWindow) {
    const row = by.get(r.address);
    if (!row) {
      by.set(r.address, { address: r.address, best: r.score, bestAt: r.at, runs: 1, wins: r.won ? 1 : 0, whitesWon: r.whitesAwarded });
      continue;
    }
    row.runs += 1;
    if (r.won) row.wins += 1;
    row.whitesWon += r.whitesAwarded;
    if (r.score > row.best || (r.score === row.best && r.at < row.bestAt)) {
      row.best = r.score;
      row.bestAt = r.at;
    }
  }
  const entries = [...by.values()]
    .sort((a, b) => b.best - a.best || a.bestAt - b.bestAt || a.runs - b.runs || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))
    .slice(0, limit);
  return { entries, players: by.size, totalRuns: inWindow.length };
}

/** Number the rows and put names on them. */
export function rankBoard(
  agg: BoardAggregate,
  window: LeaderboardWindow,
  now: number,
  nameFor: (address: string) => string,
): Leaderboard {
  return {
    window,
    since: windowStart(window, now),
    rows: agg.entries.map((e, i) => ({ rank: i + 1, name: nameFor(e.address), ...e })),
    totalRuns: agg.totalRuns,
    players: agg.players,
    practice: true,
    generatedAt: now,
  };
}

/** The whole board from raw runs (file/memory stores, tests). */
export function buildLeaderboard(
  runs: readonly RunRecord[],
  window: LeaderboardWindow,
  now: number,
  limit: number,
  nameFor: (address: string) => string,
): Leaderboard {
  return rankBoard(aggregateBoard(runs, windowStart(window, now), limit), window, now, nameFor);
}

/** One player's totals before naming. */
export interface PlayerAggregate {
  runs: number;
  wins: number;
  best: number;
  whitesWon: number;
  firstAt: number | null;
  lastAt: number | null;
  /** Burns grouped by step. */
  burns: Array<{ fromTier: TierId; toTier: TierId; count: number }>;
}

export function aggregatePlayer(runs: readonly RunRecord[], burns: readonly BurnRecord[]): PlayerAggregate {
  let wins = 0, best = 0, whitesWon = 0;
  let firstAt: number | null = null, lastAt: number | null = null;
  for (const r of runs) {
    if (r.won) wins += 1;
    best = Math.max(best, r.score);
    whitesWon += r.whitesAwarded;
    firstAt = firstAt === null ? r.at : Math.min(firstAt, r.at);
    lastAt = lastAt === null ? r.at : Math.max(lastAt, r.at);
  }
  const steps = new Map<string, { fromTier: TierId; toTier: TierId; count: number }>();
  for (const b of burns) {
    const key = `${b.fromTier}>${b.toTier}`;
    const s = steps.get(key);
    if (s) s.count += 1;
    else steps.set(key, { fromTier: b.fromTier, toTier: b.toTier, count: 1 });
  }
  return { runs: runs.length, wins, best, whitesWon, firstAt, lastAt, burns: [...steps.values()] };
}

/** A player's stats from their totals: win rate, and pieces burned (two per burn) and made (one per burn) by tier. */
export function statsFrom(address: string, a: PlayerAggregate, nameFor: (address: string) => string): PlayerStats {
  const burned: TierCounts = {};
  const made: TierCounts = {};
  for (const s of a.burns) {
    burned[s.fromTier] = (burned[s.fromTier] ?? 0) + 2 * s.count;
    made[s.toTier] = (made[s.toTier] ?? 0) + s.count;
  }
  return {
    address,
    name: nameFor(address),
    runs: a.runs,
    wins: a.wins,
    losses: a.runs - a.wins,
    winRate: a.runs ? a.wins / a.runs : null,
    best: a.best,
    whitesWon: a.whitesWon,
    burned,
    made,
    firstAt: a.firstAt,
    lastAt: a.lastAt,
    practice: true,
  };
}

/** Everything one player has done, all time, from raw rows. */
export function buildStats(
  address: string,
  runs: readonly RunRecord[],
  burns: readonly BurnRecord[],
  nameFor: (address: string) => string,
): PlayerStats {
  return statsFrom(address, aggregatePlayer(runs, burns), nameFor);
}
