/**
 * The steer log — what a ranked run sends instead of a score.
 *
 * Shared by the game (records it) and the server (checks it and replays it),
 * so it is pure and browser-safe: no Node imports.
 *
 * Wire format: a run-length-encoded list of [k, count] — "steer k/STEER_SCALE
 * for `count` ticks". k is an integer in [-STEER_SCALE, STEER_SCALE], so the
 * value the server replays is EXACTLY the value the game stepped with
 * (k / 256 is exact in floating point) and the log stays small. What a steer
 * value means (a direction, a target across the shaft) is the simulation's
 * business; this file only fixes how it travels.
 *
 * The game must step its own simulation with the value `push()` returns, not
 * with the raw input, or its run and the server's replay will part ways.
 */

/** Steer is quantized to 1/STEER_SCALE of full deflection. */
export const STEER_SCALE = 256;

/** One run: hold steer k/STEER_SCALE for `count` ticks. */
export type SteerRun = readonly [k: number, count: number];
export type SteerLog = readonly SteerRun[];

/** At most this many runs in one log. A steer that changed every tick of a long run still fits. */
export const MAX_LOG_ENTRIES = 20_000;

/** The integer the wire carries for a steer value. Non-numbers steer straight. */
export function quantizeSteer(steer: number): number {
  const v = Number.isFinite(steer) ? steer : 0;
  return Math.max(-STEER_SCALE, Math.min(STEER_SCALE, Math.round(v * STEER_SCALE)));
}

/** Total ticks a log covers. */
export const totalTicks = (log: SteerLog): number => log.reduce((n, [, count]) => n + count, 0);

export interface SteerRecorder {
  /**
   * Record this tick's steer. Returns the quantized value — step the
   * simulation with THIS, so the server's replay sees exactly what the game did.
   */
  push(steer: number): number;
  /** The log so far (a copy, safe to send). */
  log(): SteerLog;
  /** Ticks recorded so far. */
  ticks(): number;
}

/** Records one run's steering, merging consecutive equal ticks. */
export function createSteerRecorder(): SteerRecorder {
  const runs: Array<[number, number]> = [];
  let ticks = 0;
  return {
    push(steer) {
      const k = quantizeSteer(steer);
      const last = runs[runs.length - 1];
      if (last && last[0] === k) last[1] += 1;
      else runs.push([k, 1]);
      ticks += 1;
      return k / STEER_SCALE;
    },
    log: () => runs.map(([k, n]) => [k, n] as const),
    ticks: () => ticks,
  };
}

export type InputsCheck = { ok: true; log: SteerLog; ticks: number } | { ok: false; error: string };

/** Check a posted log: shape, bounds, and no more ticks than a run can last. */
export function checkInputs(raw: unknown, maxTicks: number): InputsCheck {
  if (!Array.isArray(raw)) return { ok: false, error: "inputs must be a list of [steer, count] pairs" };
  if (raw.length === 0) return { ok: false, error: "inputs are empty" };
  if (raw.length > MAX_LOG_ENTRIES) return { ok: false, error: `inputs may have at most ${MAX_LOG_ENTRIES} entries` };
  const log: Array<readonly [number, number]> = [];
  let ticks = 0;
  for (let i = 0; i < raw.length; i++) {
    const e: unknown = raw[i];
    if (!Array.isArray(e) || e.length !== 2) return { ok: false, error: `inputs[${i}] must be [steer, count]` };
    const [k, count] = e as [unknown, unknown];
    if (typeof k !== "number" || !Number.isInteger(k) || k < -STEER_SCALE || k > STEER_SCALE) {
      return { ok: false, error: `inputs[${i}]: steer must be a whole number from ${-STEER_SCALE} to ${STEER_SCALE}` };
    }
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
      return { ok: false, error: `inputs[${i}]: count must be a whole number of ticks, at least 1` };
    }
    ticks += count;
    if (ticks > maxTicks) return { ok: false, error: `inputs run longer than any run can last (${maxTicks} ticks)` };
    log.push([k, count]);
  }
  return { ok: true, log, ticks };
}
