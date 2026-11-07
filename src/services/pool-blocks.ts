/**
 * How many blocks Parasite has found, all time, for the desktop's "BLOCK N
 * IMMINENT" intro and the wallpaper's stats (owner, 2026-11-06: "that msg
 * should auto update… so we dont gotta fix it every time").
 *
 * Parasite's /api/rounds lists every completed round, one per found block
 * (5 as of November 2026: 938,713 … 958,527). The list changes once every few
 * weeks, so it is cached for ten minutes per process. A block found since the
 * last fetch still counts straight away: pool-stats' lastFoundHeight (fresh
 * on every tick) is then newer than the newest round.
 */
import { getRounds, type CompletedRound } from "../data/parasite.js";

const TTL_MS = 10 * 60 * 1000;

/** Found blocks: the completed rounds, plus one if pool-stats has already seen a newer block. */
export function countBlocksFound(roundHeights: readonly number[], lastFoundHeight: number | null): number {
  const newest = roundHeights.reduce((m, h) => Math.max(m, h), 0);
  return roundHeights.length + (lastFoundHeight != null && lastFoundHeight > newest ? 1 : 0);
}

export type BlocksFound = (lastFoundHeight: number | null, now?: number) => Promise<number | null>;

/**
 * A cached counter. An empty or failed fetch is treated as "unknown", not
 * zero (the pool has found blocks), and falls back to the last good list.
 */
export function createBlocksFound(fetchRounds: () => Promise<CompletedRound[]> = getRounds, ttlMs = TTL_MS): BlocksFound {
  let cache: { at: number; heights: number[] } | null = null;
  let inFlight: Promise<void> | null = null;
  const refresh = (now: number): Promise<void> => {
    inFlight ??= fetchRounds()
      .then((rounds) => {
        const heights = rounds.map((r) => r.height).filter((h) => h > 0);
        if (heights.length > 0) cache = { at: now, heights };
      })
      .catch(() => { /* keep the last good list */ })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  return async (lastFoundHeight, now = Date.now()) => {
    if (!cache || now - cache.at >= ttlMs) await refresh(now);
    return cache ? countBlocksFound(cache.heights, lastFoundHeight) : null;
  };
}

export const blocksFound: BlocksFound = createBlocksFound();
