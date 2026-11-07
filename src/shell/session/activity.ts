/**
 * Site activity, for the Parahawk badges (time on the site, days active…).
 *
 * While a signed-in visitor has the desktop open AND visible, it pings the
 * server once a minute (POST /api/activity/ping). The server does the
 * counting — each ping is worth the time since the previous one, capped — so
 * this only has to say "still here". A hidden tab, or nobody signed in, sends
 * nothing. Started once by main.ts.
 */
import type { ServerSession } from "./me";

export interface ActivityTracker {
  stop(): void;
}

export interface ActivityTrackerOptions {
  /** How often to ping while visible. Default 60 s (src/activity/rules.ts PING_EVERY_MS). */
  everyMs?: number;
  /** Injected in tests. */
  isVisible?: () => boolean;
  post?: () => Promise<unknown>;
  onVisibilityChange?: (fn: () => void) => () => void;
}

const defaultVisible = (): boolean => typeof document === "undefined" || document.visibilityState === "visible";

const defaultPost = (): Promise<unknown> =>
  fetch("/api/activity/ping", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    keepalive: true,
  });

const defaultOnVisibility = (fn: () => void): (() => void) => {
  if (typeof document === "undefined") return () => undefined;
  document.addEventListener("visibilitychange", fn);
  return () => document.removeEventListener("visibilitychange", fn);
};

export function startActivityTracker(me: ServerSession, opts: ActivityTrackerOptions = {}): ActivityTracker {
  const everyMs = opts.everyMs ?? 60_000;
  const isVisible = opts.isVisible ?? defaultVisible;
  const post = opts.post ?? defaultPost;
  let inFlight = false;

  const beat = () => {
    if (inFlight || !isVisible() || !me.current().address) return;
    inFlight = true;
    post().catch(() => { /* offline: the next beat tries again */ }).finally(() => { inFlight = false; });
  };

  const timer = setInterval(beat, everyMs);
  // Coming back to the tab, or signing in, starts a streak straight away.
  const offVisible = (opts.onVisibilityChange ?? defaultOnVisibility)(() => { if (isVisible()) beat(); });
  const offMe = me.subscribe((now) => { if (now.address) beat(); });

  return {
    stop() {
      clearInterval(timer);
      offVisible();
      offMe();
    },
  };
}
