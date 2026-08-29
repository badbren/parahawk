/**
 * The one live-data feed the shell polls. Server side: GET /api/tick — a slim
 * projection of getOverview() with `Cache-Control: public, s-maxage=10`, so N
 * desktop viewers cost one upstream fan-out per window, not N.
 *
 * Consumers: the taskbar (difficulty + clock), the wallpaper gauge, and the
 * block-found celebration (lastFoundHeight increasing between two ticks).
 */

export interface Tick {
  /** Pool hashrate, PH/s. */
  hashratePhs: number;
  /** 1-day average pool hashrate, PH/s (null if unknown). */
  avg1dPhs: number | null;
  /** Network difficulty (raw, e.g. 126.0e12). */
  difficulty: number;
  /** Chain tip height. */
  height: number;
  /** Height of the last block Parasite found (null if unknown). */
  lastFoundHeight: number | null;
  /** Unix ms of that block (null if unknown). */
  lastFoundAtMs: number | null;
  potBlocks: number;
  potHours: number;
  potVerdict: string;
  btcUsd: number;
  hashpriceSats: number;
  /** PH·days of work banked in the current pot. */
  phdBanked: number;
  /** ISO timestamp from the server. */
  generatedAt: string;
}

export interface TickMeta {
  /** True on the tick where lastFoundHeight increased vs the previous tick. */
  blockFound: boolean;
  /** True when this tick came from the network (false = replay of `latest()` to a new subscriber). */
  fresh: boolean;
}

export type TickListener = (tick: Tick, meta: TickMeta) => void;

export interface TickFeed {
  subscribe(fn: TickListener): () => void;
  latest(): Tick | null;
  start(): void;
  stop(): void;
  /** Force a fetch now (e.g. on visibilitychange → visible). */
  refresh(): Promise<void>;
}

export interface TickFeedOptions {
  url?: string;
  /** Default 15 000 ms. */
  intervalMs?: number;
  /** Paused while the tab is hidden (default true). */
  pauseWhenHidden?: boolean;
  fetchImpl?: typeof fetch;
}

export function createTickFeed(opts: TickFeedOptions = {}): TickFeed {
  const url = opts.url ?? "/api/tick";
  const interval = opts.intervalMs ?? 15_000;
  const pauseWhenHidden = opts.pauseWhenHidden ?? true;
  const doFetch = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  const listeners = new Set<TickListener>();
  let latest: Tick | null = null;
  let timer: number | null = null;
  let running = false;
  let inFlight: Promise<void> | null = null;

  const emit = (tick: Tick, meta: TickMeta) => {
    for (const fn of listeners) {
      try {
        fn(tick, meta);
      } catch (err) {
        console.error("[tick] listener failed", err);
      }
    }
  };

  const refresh = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const res = await doFetch(url, { cache: "no-store", headers: { accept: "application/json" } });
        if (!res.ok) return;
        const next = (await res.json()) as Tick;
        if (typeof next.hashratePhs !== "number") return;
        const prev = latest;
        const blockFound =
          prev != null &&
          prev.lastFoundHeight != null &&
          next.lastFoundHeight != null &&
          next.lastFoundHeight > prev.lastFoundHeight;
        latest = next;
        emit(next, { blockFound, fresh: true });
      } catch {
        /* network blip — keep the last tick, try again next interval */
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const schedule = () => {
    if (timer != null) clearTimeout(timer);
    timer = window.setTimeout(async () => {
      if (!running) return;
      if (pauseWhenHidden && document.hidden) {
        schedule();
        return;
      }
      await refresh();
      if (running) schedule();
    }, interval);
  };

  const onVisible = () => {
    if (running && !document.hidden) void refresh();
  };

  return {
    subscribe(fn) {
      listeners.add(fn);
      if (latest) fn(latest, { blockFound: false, fresh: false });
      return () => listeners.delete(fn);
    },
    latest: () => latest,
    start() {
      if (running) return;
      running = true;
      document.addEventListener("visibilitychange", onVisible);
      void refresh();
      schedule();
    },
    stop() {
      running = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer != null) clearTimeout(timer);
      timer = null;
    },
    refresh,
  };
}

/** Format difficulty like the site does: 126.0T. */
export function fmtDifficulty(d: number): string {
  if (!(d > 0)) return "—";
  if (d >= 1e15) return (d / 1e15).toFixed(2) + "P";
  if (d >= 1e12) return (d / 1e12).toFixed(1) + "T";
  if (d >= 1e9) return (d / 1e9).toFixed(1) + "G";
  return d.toFixed(0);
}
