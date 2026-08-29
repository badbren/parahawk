/**
 * The user's "hidden apps" list — what's in the Recycle Bin. Persisted via the
 * session store under "desktop.hidden" (string[] of app ids) so a
 * wallet-backed store later carries it across devices unchanged.
 */
import type { KeyValueStore } from "../session/store";

export const HIDDEN_KEY = "desktop.hidden";

export interface HiddenApps {
  list(): string[];
  has(id: string): boolean;
  add(id: string): void;
  remove(id: string): void;
  /** Called after every change with the new list. Returns an unsubscribe. */
  subscribe(fn: (ids: string[]) => void): () => void;
}

export function createHiddenApps(store: KeyValueStore): HiddenApps {
  const raw = store.get<unknown>(HIDDEN_KEY);
  let ids: string[] = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  const listeners = new Set<(ids: string[]) => void>();

  const commit = (next: string[]) => {
    ids = next;
    store.set(HIDDEN_KEY, ids);
    for (const fn of listeners) fn(ids.slice());
  };

  return {
    list: () => ids.slice(),
    has: (id) => ids.includes(id),
    add(id) {
      if (!ids.includes(id)) commit([...ids, id]);
    },
    remove(id) {
      if (ids.includes(id)) commit(ids.filter((x) => x !== id));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
