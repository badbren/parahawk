/**
 * Key/value persistence behind one tiny interface so the backend can change:
 * guests get localStorage today; a wallet-connected user will get a
 * Supabase-backed store keyed by (chain, address) later — same interface,
 * nothing above it changes.
 */

export interface KeyValueStore {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
}

export function createLocalStore(prefix = "ph."): KeyValueStore {
  const k = (key: string) => prefix + key;
  return {
    get<T>(key: string): T | null {
      try {
        const raw = localStorage.getItem(k(key));
        return raw == null ? null : (JSON.parse(raw) as T);
      } catch {
        return null;
      }
    },
    set<T>(key: string, value: T): void {
      try {
        localStorage.setItem(k(key), JSON.stringify(value));
      } catch {
        /* private mode / quota — persistence is a convenience, never required */
      }
    },
    remove(key: string): void {
      try {
        localStorage.removeItem(k(key));
      } catch {
        /* ignore */
      }
    },
  };
}

/** In-memory fallback (tests, storage-blocked contexts). */
export function createMemoryStore(): KeyValueStore {
  const m = new Map<string, unknown>();
  return {
    get<T>(key: string): T | null {
      return m.has(key) ? (m.get(key) as T) : null;
    },
    set<T>(key: string, value: T): void {
      m.set(key, value);
    },
    remove(key: string): void {
      m.delete(key);
    },
  };
}
