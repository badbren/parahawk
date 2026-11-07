/**
 * Little marks on desktop icons: the Changelog's "!" after an update, Chat's
 * unread count, the owner's new-suggestions count.
 *
 * Whoever owns an app decides when its badge shows and when it clears; the
 * desktop only draws it (desktop.ts) and reports when an app's window opens,
 * so a badge that means "you haven't looked yet" can clear itself.
 *
 * One page, one desktop: a module-level registry is enough.
 */

export interface IconBadge {
  /** What the badge says: "!" or a short count like "3" / "9+". Keep it to 1–3 characters. */
  text: string;
  /** Pulse to draw the eye. The desktop drops the pulse when the visitor has motion off. */
  pulse?: boolean;
  /** Read out with the icon's name, e.g. "updated since your last visit". */
  label?: string;
}

const badges = new Map<string, IconBadge>();
const listeners = new Set<() => void>();
const openListeners = new Set<(id: string) => void>();

const same = (a: IconBadge | undefined, b: IconBadge | null): boolean =>
  (a == null && b == null) || (a != null && b != null && a.text === b.text && !!a.pulse === !!b.pulse && a.label === b.label);

export const iconBadges = {
  get(id: string): IconBadge | null {
    return badges.get(id) ?? null;
  },
  /** Show (or replace) an app's badge; null clears it. */
  set(id: string, badge: IconBadge | null): void {
    if (same(badges.get(id), badge)) return;
    if (badge) badges.set(id, badge); else badges.delete(id);
    for (const fn of [...listeners]) fn();
  },
  /** Fires whenever any badge changes. */
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  /** desktop.ts calls this every time an app's window is opened or brought back (icon, start menu, deep link). */
  notifyOpened(id: string): void {
    for (const fn of [...openListeners]) fn(id);
  },
  /** Hear about app opens, e.g. to clear a "you haven't looked yet" badge. */
  onOpened(fn: (id: string) => void): () => void {
    openListeners.add(fn);
    return () => { openListeners.delete(fn); };
  },
};
