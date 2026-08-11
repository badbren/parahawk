import { hasSupabase } from "../config.js";
import { MemoryStore } from "./memory.js";
import { SupabaseStore } from "./supabase.js";
import type { Store } from "./types.js";

let store: Store | null = null;

/**
 * Singleton store: Supabase when credentials exist, else a real in-memory store.
 * MemoryStore is the no-Supabase fallback (dev/test) — the live pollers fill it
 * with real observed data; it just isn't persisted across restarts.
 */
export function getStore(): Store {
  if (store) return store;
  store = hasSupabase() ? new SupabaseStore() : new MemoryStore();
  return store;
}
