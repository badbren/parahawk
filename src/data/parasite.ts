import { config } from "../config.js";
import { Cached, fetchJson } from "./cache.js";
import { mockPoolStats, mockUserStats, mockRefineryState, mockHitsInRange } from "./mock.js";
import type { PoolStats, UserStats, RefineryState, Freshness, HitEvent } from "./types.js";

/**
 * Adapter over Parasite Pool's undocumented API.
 *
 * The public interfaces (PoolStats / UserStats / RefineryState) are stable; the
 * only thing that changes when real endpoints arrive is the mapping functions
 * below (mapPoolStats etc.). Ship MOCK_DATA=true until then — the whole app runs
 * end-to-end on the fixtures in mock.ts.
 *
 * >>> TODO(real API): paste the XHR JSON from parasite.wtf devtools and fill in
 * the map* functions. Set PARASITE_BASE_URL and the *_PATH env vars.
 */

const poolCache = new Cached<PoolStats>();
const refineryCache = new Cached<RefineryState>();

function base(): string {
  return config.parasite.baseUrl.replace(/\/$/, "");
}

// --- mapping stubs (fill from real samples) ---------------------------------

function mapPoolStats(raw: unknown): PoolStats {
  // TODO: map the real payload. Until then, mock mode never reaches here.
  const r = raw as Record<string, any>;
  return {
    poolHashratePhs: Number(r.poolHashratePhs ?? r.hashrate ?? 0),
    avg1dPhs: Number(r.avg1dPhs ?? 0),
    avg6dPhs: Number(r.avg6dPhs ?? 0),
    avg9dPhs: Number(r.avg9dPhs ?? 0),
    lastFoundHeight: Number(r.lastFoundHeight ?? r.lastBlock ?? 0),
    highestDiffSinceBlock: Number(r.highestDiffSinceBlock ?? r.bestDiff ?? 0),
    networkDifficulty: Number(r.networkDifficulty ?? r.minDiff ?? 127e12),
    users: Number(r.users ?? 0),
    workers: Number(r.workers ?? 0),
    btcPriceUsd: Number(r.btcPriceUsd ?? r.price ?? 0),
    hashpriceSatsPerPhd: Number(r.hashpriceSatsPerPhd ?? r.hashprice ?? 0),
  };
}

function mapUserStats(address: string, raw: unknown): UserStats {
  const r = raw as Record<string, any>;
  return {
    address,
    hashratePhs: Number(r.hashratePhs ?? r.hashrate ?? 0),
    bestDifficulty: Number(r.bestDifficulty ?? r.bestDiff ?? 0),
    totalWorkDiff: Number(r.totalWorkDiff ?? r.totalWork ?? 0),
    orders: Array.isArray(r.orders) ? r.orders : [],
  };
}

function mapRefineryState(raw: unknown): RefineryState {
  const r = raw as Record<string, any>;
  return {
    hashpriceSatsPerPhd: Number(r.hashpriceSatsPerPhd ?? r.hashprice ?? 0),
    orders: Array.isArray(r.orders) ? r.orders : [],
  };
}

// --- public API -------------------------------------------------------------

export async function getPoolStats(): Promise<PoolStats> {
  if (config.mockData) {
    const s = mockPoolStats();
    poolCache.set(s);
    return s;
  }
  try {
    const raw = await fetchJson<unknown>(`${base()}${config.parasite.poolStatsPath}`);
    const s = mapPoolStats(raw);
    poolCache.set(s);
    return s;
  } catch (err) {
    poolCache.markFailure();
    const last = poolCache.get();
    if (last) return last;
    throw err;
  }
}

export async function getUserStats(address: string): Promise<UserStats> {
  if (config.mockData) return mockUserStats(address);
  const url = `${base()}${config.parasite.userStatsPath}/${encodeURIComponent(address)}`;
  const raw = await fetchJson<unknown>(url);
  return mapUserStats(address, raw);
}

export async function getRefineryState(): Promise<RefineryState> {
  if (config.mockData) {
    const s = mockRefineryState();
    refineryCache.set(s);
    return s;
  }
  try {
    const raw = await fetchJson<unknown>(`${base()}${config.parasite.refineryPath}`);
    const s = mapRefineryState(raw);
    refineryCache.set(s);
    return s;
  } catch (err) {
    refineryCache.markFailure();
    const last = refineryCache.get();
    if (last) return last;
    throw err;
  }
}

/**
 * Recent 10T+ share hits ("Bravocado" board). Mock generates a realistic feed;
 * the real version needs a Parasite "recent big shares" endpoint — set
 * PARASITE_HITS_PATH and map the payload here. Returns [] if unavailable.
 */
export async function getRecentHits(sinceMs?: number): Promise<HitEvent[]> {
  const now = Date.now();
  const since = sinceMs ?? now - 24 * 60 * 60 * 1000;
  if (config.mockData) return mockHitsInRange(since, now);

  const path = process.env.PARASITE_HITS_PATH;
  if (!config.parasite.baseUrl || !path) return [];
  try {
    const raw = await fetchJson<unknown[]>(`${base()}${path}`);
    // TODO(real API): map the real payload fields into HitEvent.
    return (Array.isArray(raw) ? raw : []).map((r: any, i: number) => ({
      id: String(r.id ?? `${r.ts ?? now}_${i}`),
      ts: typeof r.ts === "number" ? r.ts : Date.parse(r.ts ?? "") || now,
      address: String(r.address ?? r.addr ?? "unknown"),
      difficulty: Number(r.difficulty ?? r.diff ?? 0),
      tier: Number(r.difficulty ?? r.diff ?? 0) >= 21e12 ? "21T" : "10T",
      orderId: r.orderId ?? r.order_id ?? null,
      worker: r.worker ?? null,
    }));
  } catch {
    return [];
  }
}

export function poolFreshness(): Freshness {
  return poolCache.freshness();
}
