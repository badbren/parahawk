/**
 * How many blocks Parasite has found, all time, for the desktop's "BLOCK N
 * IMMINENT" intro and the wallpaper's stats (owner, 2026-11-06: "that msg
 * should auto update… so we dont gotta fix it every time"), and the pool's
 * Lifetime Work (owner, 2026-11-09) for the Overview and Pool pages.
 *
 * Parasite's /api/rounds lists every completed round, one per found block
 * (5 as of November 2026: 938,713 … 958,527), each with the round's total
 * work. The list changes once every few weeks, so it is cached for ten minutes
 * per process. A block found since the last fetch still counts straight away:
 * pool-stats' lastFoundHeight (fresh on every tick) is then newer than the
 * newest round.
 */
import { getRounds, type CompletedRound } from "../data/parasite.js";

const TTL_MS = 10 * 60 * 1000;
/** After a new block, look again this soon (not a full TTL) so its round shows up. */
const RECHECK_MS = 60 * 1000;

/** Found blocks: the completed rounds, plus one if pool-stats has already seen a newer block. */
export function countBlocksFound(roundHeights: readonly number[], lastFoundHeight: number | null): number {
  const newest = roundHeights.reduce((m, h) => Math.max(m, h), 0);
  return roundHeights.length + (lastFoundHeight != null && lastFoundHeight > newest ? 1 : 0);
}

export interface LifetimeWork {
  /** Every completed round's work plus the live round's, in difficulty units. */
  workDiff: number;
  /** Completed rounds counted (one per found block). */
  rounds: number;
}

/**
 * The pool's Lifetime Work: all completed rounds plus the live round's work
 * since the last block. Unknown (null) while pool-stats and the rounds list
 * disagree on the last block: right after a block, the round that just ended
 * is either missing from the list (and the live work has reset) or counted
 * twice (the live work hasn't reset yet).
 */
export function lifetimeWorkFrom(
  roundHeights: readonly number[],
  roundsWorkDiff: number,
  liveWorkDiff: number,
  lastFoundHeight: number | null,
): LifetimeWork | null {
  const newest = roundHeights.reduce((m, h) => Math.max(m, h), 0);
  if (lastFoundHeight != null && lastFoundHeight !== newest) return null;
  return { workDiff: roundsWorkDiff + Math.max(0, liveWorkDiff || 0), rounds: roundHeights.length };
}

interface RoundsSnapshot {
  at: number;
  heights: number[];
  /** The completed rounds' work, summed. */
  workDiff: number;
}
type RoundsCache = (lastFoundHeight: number | null, now: number) => Promise<RoundsSnapshot | null>;

/**
 * The cached rounds list. An empty or failed fetch is treated as "unknown",
 * not zero (the pool has found blocks), and falls back to the last good list.
 */
function createRoundsCache(fetchRounds: () => Promise<CompletedRound[]>, ttlMs: number): RoundsCache {
  let cache: RoundsSnapshot | null = null;
  let inFlight: Promise<void> | null = null;
  const refresh = (now: number): Promise<void> => {
    inFlight ??= fetchRounds()
      .then((rounds) => {
        const done = rounds.filter((r) => r.height > 0);
        if (done.length > 0) {
          cache = {
            at: now,
            heights: done.map((r) => r.height),
            workDiff: done.reduce((sum, r) => sum + (r.totalWorkDiff > 0 ? r.totalWorkDiff : 0), 0),
          };
        }
      })
      .catch(() => { /* keep the last good list */ })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  return async (lastFoundHeight, now) => {
    const age = cache ? now - cache.at : Infinity;
    const behind = cache != null && lastFoundHeight != null && lastFoundHeight > Math.max(...cache.heights);
    if (age >= ttlMs || (behind && age >= Math.min(ttlMs, RECHECK_MS))) await refresh(now);
    return cache;
  };
}

export type BlocksFound = (lastFoundHeight: number | null, now?: number) => Promise<number | null>;
export type LifetimeWorkFn = (liveWorkDiff: number, lastFoundHeight: number | null, now?: number) => Promise<LifetimeWork | null>;

const blocksFoundVia = (rounds: RoundsCache): BlocksFound => async (lastFoundHeight, now = Date.now()) => {
  const c = await rounds(lastFoundHeight, now);
  return c ? countBlocksFound(c.heights, lastFoundHeight) : null;
};

const lifetimeWorkVia = (rounds: RoundsCache): LifetimeWorkFn => async (liveWorkDiff, lastFoundHeight, now = Date.now()) => {
  const c = await rounds(lastFoundHeight, now);
  return c ? lifetimeWorkFrom(c.heights, c.workDiff, liveWorkDiff, lastFoundHeight) : null;
};

/** A cached found-block counter. */
export function createBlocksFound(fetchRounds: () => Promise<CompletedRound[]> = getRounds, ttlMs = TTL_MS): BlocksFound {
  return blocksFoundVia(createRoundsCache(fetchRounds, ttlMs));
}

/** A cached Lifetime Work lookup. */
export function createLifetimeWork(fetchRounds: () => Promise<CompletedRound[]> = getRounds, ttlMs = TTL_MS): LifetimeWorkFn {
  return lifetimeWorkVia(createRoundsCache(fetchRounds, ttlMs));
}

// One shared rounds list for both.
const rounds = createRoundsCache(getRounds, TTL_MS);
export const blocksFound: BlocksFound = blocksFoundVia(rounds);
export const lifetimeWork: LifetimeWorkFn = lifetimeWorkVia(rounds);
