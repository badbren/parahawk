/**
 * Block Hunt runs and burns, to and from the server (src/web/game-routes.ts).
 *
 * A ranked run is two calls:
 *
 *   const t = await startRun();            // on every "Descend" — null = play unranked
 *   ... play on t.seed, stepping the sim with recorder.push(steer) every tick ...
 *   void submitRun({ ticket: t.ticket, inputs: recorder.log() });
 *
 * The server deals the seed and scores the run itself by replaying the inputs;
 * nothing the game believes about its own score is sent or trusted. Guests get
 * null from startRun() and simply play unranked. None of this ever throws into
 * the game. Everything here is PRACTICE.
 */
import type { TierId } from "../../econ/tokenomics";
import { createSteerRecorder, quantizeSteer, STEER_SCALE, type SteerLog, type SteerRecorder } from "../../game/inputs";
import type {
  LegacyRunReport,
  Leaderboard,
  LeaderboardWindow,
  PlayerStats,
  RankedRunSubmission,
  RunTicket,
  RunVerdict,
} from "../../game/types";

export type { Leaderboard, LeaderboardWindow, PlayerStats, RankedRunSubmission, RunTicket, RunVerdict, SteerLog, SteerRecorder };
export { createSteerRecorder, quantizeSteer, STEER_SCALE };

/** Fired on window after the server accepts a run or a burn, so open boards can refresh. */
export const GAME_RECORDED_EVENT = "ph:game-recorded";

async function postJson<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body ?? {}),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/**
 * Ask the server for a ranked run: a fresh random seed and the ticket to
 * submit with. Null when this run cannot be ranked — signed out, offline, or
 * asked again too quickly — and the game plays it unranked on its own seed.
 */
export async function startRun(): Promise<RunTicket | null> {
  const r = await postJson<RunTicket>("/api/game/start", {});
  const t = r.data;
  return r.ok && t && typeof t.ticket === "string" && typeof t.seed === "number" ? t : null;
}

let warnedLegacy = false;

/**
 * Submit a finished ranked run. Resolves with the server's verdict (its own
 * score, from replaying the inputs) or null; never rejects.
 */
export function submitRun(run: RankedRunSubmission): Promise<RunVerdict | null>;
/**
 * @deprecated The server no longer accepts client-scored runs. Call startRun()
 * on "Descend", record the steering, and send `{ ticket, inputs }`.
 */
export function submitRun(run: LegacyRunReport): Promise<null>;
export async function submitRun(run: RankedRunSubmission | LegacyRunReport): Promise<RunVerdict | null> {
  if (!("ticket" in run)) {
    if (!warnedLegacy) {
      warnedLegacy = true;
      console.warn("[game-runs] submitRun({ seed, score, ... }) is ignored: ranked runs send { ticket, inputs } (see startRun).");
    }
    return null;
  }
  const r = await postJson<RunVerdict>("/api/game/runs", { ticket: run.ticket, inputs: run.inputs });
  if (!r.ok || !r.data?.ok) return null;
  window.dispatchEvent(new CustomEvent(GAME_RECORDED_EVENT, { detail: r.data }));
  return r.data;
}

/** Record a burn (two of `fromTier` made one of `toTier`) for the stats. Never throws, never blocks. */
export function recordBurn(fromTier: TierId, toTier: TierId): void {
  void postJson("/api/game/burns", { fromTier, toTier }).then((r) => {
    if (r.ok) window.dispatchEvent(new CustomEvent(GAME_RECORDED_EVENT));
  });
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The board for a window; null when the server cannot be reached. */
export const fetchLeaderboard = (window: LeaderboardWindow, limit = 50): Promise<Leaderboard | null> =>
  getJson<Leaderboard>(`/api/game/leaderboard?window=${window}&limit=${limit}`);

/** One player's all-time stats; null when the server cannot be reached. */
export const fetchStats = (address: string): Promise<PlayerStats | null> =>
  getJson<PlayerStats>(`/api/game/stats/${encodeURIComponent(address)}`);
