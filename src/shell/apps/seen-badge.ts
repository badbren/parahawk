/**
 * A desktop icon's flashing "!" that means "this changed since you last looked":
 * shown while the version this browser last saw differs from the latest one,
 * cleared the moment the visitor looks.
 *
 * Used by the Changelog (a new release) and About (a new page revision). The
 * latest version is bundled into the shell, so shipping a change brings the "!"
 * back for everyone on its own; the version this browser last saw is kept in
 * the store. First-time visitors see the "!" too: they haven't seen it either.
 *
 * Looking means either of: the app's window opened (icon, start menu, deep
 * link — desktop.ts reports every open), or any site window navigated to the
 * page (a link inside the Parahawk window, say).
 */
import { iconBadges, type IconBadge } from "../desktop/icon-badges";
import type { KeyValueStore } from "../session/store";
import { isFrameNavMessage } from "../wm/types";

export const UPDATED_BADGE: IconBadge = { text: "!", pulse: true, label: "updated since your last visit" };

/** Matches one site page however a link spells it: /about, /about?x, /about#top, /about/more. */
export function pagePath(base: string): (path: string) => boolean {
  return (path) => {
    const bare = path.split(/[?#]/)[0] ?? "";
    return bare === base || bare.startsWith(base + "/");
  };
}

export interface SeenBadgeOptions {
  /** The desktop app the "!" sits on. */
  appId: string;
  /** Store key holding the version this browser last saw. */
  seenKey: string;
  /** The version that counts as new. */
  latest: string;
  /** True for the page this badge is about. */
  isPage: (path: string) => boolean;
  badges: Pick<typeof iconBadges, "set" | "onOpened">;
  /** Reports the path of every page a site window shows. Returns an unsubscribe. */
  onNavigate?: (fn: (path: string) => void) => () => void;
}

/** The badge's logic, with its inputs passed in (tests). Returns a stop function. */
export function createSeenBadge(store: KeyValueStore, o: SeenBadgeOptions): () => void {
  let seen: unknown = null;
  try { seen = store.get<unknown>(o.seenKey); } catch { /* storage blocked: nothing seen yet */ }
  if (seen !== o.latest) o.badges.set(o.appId, UPDATED_BADGE);

  const markSeen = () => {
    try { store.set(o.seenKey, o.latest); } catch { /* storage blocked: it just comes back next visit */ }
    o.badges.set(o.appId, null);
  };
  const offOpen = o.badges.onOpened((id) => { if (id === o.appId) markSeen(); });
  const offNav = o.onNavigate?.((path) => { if (o.isPage(path)) markSeen(); });
  return () => {
    offOpen();
    offNav?.();
  };
}

/** Every page a site window shows — the same message the window manager follows (wm/types.ts). */
export function frameNavigations(fn: (path: string) => void): () => void {
  const onMessage = (ev: MessageEvent) => {
    if (ev.origin === location.origin && isFrameNavMessage(ev.data)) fn(ev.data.path);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
