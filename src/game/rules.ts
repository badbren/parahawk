/**
 * The limits around a ranked run and a burn.
 *
 * Scores are not checked here any more — the server computes them by replaying
 * the run (replay.ts) on its own ticket's seed (ticket.ts). What is left is
 * pacing and the payout rule.
 */
import { MAX_ORE_PER_RUN, TIERS, nextTier, type TierId } from "../econ/tokenomics.js";
import type { RunResult } from "./replay.js";

/**
 * A run's payout in Whites. The art window owns the final economics; this is
 * the rule the owner set — win 2, lose 1 — and the server applies it to ITS
 * verdict, never to the client's.
 */
export const WHITES_FOR_WIN = 2;
export const WHITES_FOR_LOSS = 1;

/** One accepted run per wallet per this long. A run lasts ~45 s, so honest play never hits it. */
export const RUN_COOLDOWN_MS = 20_000;
/** One ticket per wallet per this long — stops a script dealing itself seeds as fast as it can ask. */
export const START_COOLDOWN_MS = 3_000;
/** Burns are quick clicks; this only stops a script hammering the endpoint. */
export const BURN_COOLDOWN_MS = 1_500;
/** One run submission per wallet per this long — each one is replayed, which costs CPU. */
export const RUN_ATTEMPT_GAP_MS = 2_000;

/**
 * A run cannot be submitted faster than it takes to play: the time since its
 * ticket was dealt must be at least this share of the run's simulated length.
 * The ticket is dealt before the run starts and the game's clock is real time,
 * so honest play is always over 100%; the margin is only for timer jitter.
 */
export const MIN_REALTIME_FRACTION = 0.95;

export const minRealMsFor = (ticks: number, tickHz: number): number => (ticks / tickHz) * 1000 * MIN_REALTIME_FRACTION;

/** The board's record of a replayed run: the server's numbers, sanity-clamped, and the payout rule. */
export function statsFromResult(seed: number, r: RunResult, tickHz: number) {
  const whole = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const won = r.won === true;
  return {
    seed,
    score: Math.min(MAX_ORE_PER_RUN, whole(r.score)),
    won,
    nonces: whole(r.nonces),
    stale: whole(r.stale),
    scrapes: whole(r.scrapes),
    durationMs: Math.round((whole(r.ticks) / tickHz) * 1000),
    whitesAwarded: won ? WHITES_FOR_WIN : WHITES_FOR_LOSS,
  };
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const TIER_IDS: ReadonlySet<string> = new Set(TIERS.map((t) => t.id));

/** Check a posted burn: a real tier, burned into the tier directly above it. */
export function checkBurn(body: unknown): Checked<{ fromTier: TierId; toTier: TierId }> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "expected a JSON object" };
  const { fromTier, toTier } = body as Record<string, unknown>;
  if (typeof fromTier !== "string" || !TIER_IDS.has(fromTier)) return { ok: false, error: "unknown fromTier" };
  const up = nextTier(fromTier as TierId);
  if (!up) return { ok: false, error: "the top tier cannot be burned" };
  if (toTier !== up.id) return { ok: false, error: `two ${fromTier} burn into ${up.id}` };
  return { ok: true, value: { fromTier: fromTier as TierId, toTier: up.id } };
}
