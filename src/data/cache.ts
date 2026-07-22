import type { Freshness } from "./types.js";

/**
 * Holds the last-good value for a data source and tracks freshness so the UI
 * can show a "stale since <ts>" banner instead of crashing when upstream fails.
 */
export class Cached<T> {
  private value: T | null = null;
  private lastSuccess: number | null = null;
  private failing = false;

  constructor(private readonly staleAfterMs: number = 5 * 60 * 1000) {}

  set(value: T): void {
    this.value = value;
    this.lastSuccess = Date.now();
    this.failing = false;
  }

  markFailure(): void {
    this.failing = true;
  }

  get(): T | null {
    return this.value;
  }

  freshness(): Freshness {
    const age = this.lastSuccess === null ? Infinity : Date.now() - this.lastSuccess;
    return {
      ok: this.value !== null,
      lastSuccess: this.lastSuccess,
      stale: this.failing || age > this.staleAfterMs,
    };
  }
}

/** fetch JSON with a timeout; throws on non-2xx or timeout. */
export async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/** fetch a plain-text body (e.g. mempool tip height) with a timeout. */
export async function fetchText(url: string, timeoutMs = 8000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return (await res.text()).trim();
  } finally {
    clearTimeout(t);
  }
}
