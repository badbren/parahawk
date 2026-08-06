import { config } from "../config.js";
import { Cached, fetchJson } from "./cache.js";
import {
  mockPoolStats,
  mockUserStats,
  mockRefineryState,
  mockHitsInRange,
  mockLeaderboard,
} from "./mock.js";
import type {
  PoolStats,
  UserStats,
  RefineryState,
  RefineryOrder,
  OrderStatus,
  Freshness,
  HitEvent,
  HitTier,
  Leaderboard,
  LeaderboardEntry,
} from "./types.js";

/**
 * Adapter over Parasite Pool's real API (parasite.space).
 *
 * Confirmed endpoints (2026-07):
 *   GET /api/pool-stats                         → hashrate(H/s), lastBlockTime(height),
 *                                                 highestDifficulty("63.3T"), users, workers,
 *                                                 workSinceLastBlock(diff units)
 *   GET /api/pool-stats/historical?period&interval → [{timestamp, hashrate15m/1hr/6hr/1d/7d, ...}]
 *   GET /api/highest-diff?limit=25              → [{block_height, top_diff_address(masked),
 *                                                 difficulty, block_timestamp}]
 *   GET /api/leaderboard?type=difficulty|loyalty&limit&round=current
 *   GET /api/router/orders                      → Refinery order book (FULL addresses)
 *   GET /api/user/<addr> , /api/account/<addr>  → per-address stats
 *   GET /api/highest-diff?address=<addr>&type=user-diffs&limit → that address's diffs
 * Network difficulty + BTC price come from mempool.space (see mempool.ts); the
 * hashprice is computed from difficulty + block subsidy (see math/hashprice.ts).
 */

const H_PER_PH = 1e15;
const poolCache = new Cached<PoolStats>();
const refineryCache = new Cached<RefineryState>();
const leaderboardCache = new Cached<Leaderboard>();
const historicalCache = new Cached<HistoricalRow[]>(5 * 60 * 1000);

function base(): string {
  return config.parasite.baseUrl.replace(/\/$/, "");
}

/** Parse Parasite diff strings like "63.3T", "554G", "309M" → numeric diff. */
export function parseDiffStr(s: string | number): number {
  if (typeof s === "number") return s;
  const m = /^([\d.]+)\s*([KMGTPE]?)/i.exec(s.trim());
  if (!m) return Number(s) || 0;
  const n = Number(m[1]);
  const mult: Record<string, number> = { "": 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15, E: 1e18 };
  return n * (mult[(m[2] || "").toUpperCase()] ?? 1);
}

function tierFor(difficulty: number): HitTier {
  if (difficulty >= 21e12) return "21T";
  if (difficulty >= 10e12) return "10T";
  return "sub";
}

// ── pool stats ───────────────────────────────────────────────────────────────

interface HistoricalRow {
  timestamp: number;
  hashrate15m?: number;
}

async function getHistorical(): Promise<HistoricalRow[]> {
  const cached = historicalCache.get();
  if (cached && !historicalCache.freshness().stale) return cached;
  try {
    const rows = await fetchJson<HistoricalRow[]>(
      `${base()}/api/pool-stats/historical?period=30d&interval=30m`,
    );
    historicalCache.set(rows);
    return rows;
  } catch {
    return cached ?? [];
  }
}

/** Mean of hashrate15m (H/s → PH/s) over the last `days` of historical rows. */
function avgOverDays(rows: HistoricalRow[], days: number): number {
  if (rows.length === 0) return 0;
  const latest = rows[rows.length - 1]!.timestamp;
  const cutoff = latest - days * 86_400;
  const vals = rows.filter((r) => r.timestamp >= cutoff && r.hashrate15m).map((r) => r.hashrate15m!);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length / H_PER_PH;
}

async function mapPoolStats(raw: Record<string, any>): Promise<PoolStats> {
  const rows = await getHistorical();
  return {
    poolHashratePhs: Number(raw.hashrate ?? 0) / H_PER_PH,
    avg1dPhs: avgOverDays(rows, 1),
    avg6dPhs: avgOverDays(rows, 6),
    avg9dPhs: avgOverDays(rows, 9),
    lastFoundHeight: parseInt(String(raw.lastBlockTime ?? raw.lastBlock ?? 0), 10),
    highestDiffSinceBlock: parseDiffStr(raw.highestDifficulty ?? 0),
    networkDifficulty: 0, // filled from mempool in the overview service
    users: Number(raw.users ?? 0),
    workers: Number(raw.workers ?? 0),
    btcPriceUsd: 0, // filled from mempool in the overview service
    hashpriceSatsPerPhd: 0, // computed from difficulty in the overview service
    workSinceLastBlockDiff: Number(raw.workSinceLastBlock ?? 0),
  };
}

export async function getPoolStats(): Promise<PoolStats> {
  if (config.mockData) {
    const s = mockPoolStats();
    poolCache.set(s);
    return s;
  }
  try {
    const raw = await fetchJson<Record<string, any>>(`${base()}/api/pool-stats`);
    const s = await mapPoolStats(raw);
    poolCache.set(s);
    return s;
  } catch (err) {
    poolCache.markFailure();
    const last = poolCache.get();
    if (last) return last;
    throw err;
  }
}

// ── pool stats time series (for the /history per-chart timeframe toggles) ──────

export type PoolWindow = "1h" | "4h" | "1d" | "1w";

export interface SeriesPoint {
  t: number; // unix ms
  v: number;
}

export interface PoolSeries {
  hashrate: SeriesPoint[]; // PH/s
  users: SeriesPoint[];
  workers: SeriesPoint[];
}

/** Full historical row (all fields we chart). hashrateXX are H/s. */
interface HistoricalRowFull {
  timestamp: number; // unix SECONDS
  users?: number;
  workers?: number;
  hashrate15m?: number;
}

/** Points per window and the sampling step, used for the mock synthesizer. */
function windowSpec(window: PoolWindow): { points: number; stepMs: number } {
  switch (window) {
    case "1h":
      return { points: 12, stepMs: 5 * 60_000 };
    case "4h":
      return { points: 48, stepMs: 5 * 60_000 };
    case "1d":
      return { points: 288, stepMs: 5 * 60_000 };
    case "1w":
      return { points: 168, stepMs: 60 * 60_000 };
  }
}

/**
 * Historical hashrate / users / workers over a selectable window.
 *   1H → last 12 pts of period=1d&interval=5m   (5-min resolution)
 *   4H → last 48 pts of period=1d&interval=5m
 *   1D → all 288 pts of period=1d&interval=5m
 *   1W → period=7d&interval=1h                   (168 hourly pts)
 * Hashrate uses hashrate15m (H/s → PH/s). Timestamps seconds → ms.
 */
export async function getPoolStatsSeries(window: PoolWindow): Promise<PoolSeries> {
  if (config.mockData) return mockPoolSeries(window);

  const isWeek = window === "1w";
  const period = isWeek ? "7d" : "1d";
  const interval = isWeek ? "1h" : "5m";
  let rows = await fetchJson<HistoricalRowFull[]>(
    `${base()}/api/pool-stats/historical?period=${period}&interval=${interval}`,
  );
  if (!Array.isArray(rows)) rows = [];

  const tail = window === "1h" ? 12 : window === "4h" ? 48 : 0;
  if (tail > 0 && rows.length > tail) rows = rows.slice(-tail);

  const map = (sel: (r: HistoricalRowFull) => number | undefined): SeriesPoint[] =>
    rows
      .filter((r) => r && r.timestamp)
      .map((r) => ({ t: r.timestamp * 1000, v: Number(sel(r) ?? 0) }));

  return {
    hashrate: map((r) => (r.hashrate15m !== undefined ? r.hashrate15m / H_PER_PH : undefined)),
    users: map((r) => r.users),
    workers: map((r) => r.workers),
  };
}

/** Mock-mode fallback: a smooth deterministic series around the pinned snapshot. */
function mockPoolSeries(window: PoolWindow): PoolSeries {
  const { points, stepMs } = windowSpec(window);
  const now = Date.now();
  const snap = mockPoolStats(now);
  const hashrate: SeriesPoint[] = [];
  const users: SeriesPoint[] = [];
  const workers: SeriesPoint[] = [];
  for (let i = points - 1; i >= 0; i--) {
    const t = now - i * stepMs;
    const w = Math.sin((t / (6 * 3_600_000)) * 2 * Math.PI);
    hashrate.push({ t, v: Math.round(snap.poolHashratePhs * (1 + 0.08 * w) * 10) / 10 });
    users.push({ t, v: Math.round(snap.users * (1 + 0.04 * w)) });
    workers.push({ t, v: Math.round(snap.workers * (1 + 0.05 * w)) });
  }
  return { hashrate, users, workers };
}

// ── hits (highest-diff feed) ──────────────────────────────────────────────────

interface HighestDiffRow {
  block_height: number;
  top_diff_address: string;
  difficulty: number;
  block_timestamp: number;
}

export async function getRecentHits(sinceMs?: number): Promise<HitEvent[]> {
  const now = Date.now();
  const since = sinceMs ?? now - 24 * 60 * 60 * 1000;
  if (config.mockData) return mockHitsInRange(since, now);

  try {
    const rows = await fetchJson<HighestDiffRow[]>(`${base()}/api/highest-diff?limit=50`);
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      id: `blk_${r.block_height}`,
      ts: r.block_timestamp * 1000,
      address: r.top_diff_address ?? "unknown",
      difficulty: Number(r.difficulty ?? 0),
      tier: tierFor(Number(r.difficulty ?? 0)),
      orderId: null,
      worker: null,
    }));
  } catch {
    return [];
  }
}

/** Top Parasite diff share per bitcoin block height (address is masked upstream). */
export interface TopDiff {
  address: string;
  difficulty: number;
}

export async function getTopDiffByBlock(limit = 50): Promise<Map<number, TopDiff>> {
  const map = new Map<number, TopDiff>();
  if (config.mockData) return map;
  try {
    const rows = await fetchJson<HighestDiffRow[]>(`${base()}/api/highest-diff?limit=${limit}`);
    for (const r of Array.isArray(rows) ? rows : []) {
      const h = Number(r.block_height);
      if (!h) continue;
      map.set(h, { address: r.top_diff_address ?? "", difficulty: Number(r.difficulty ?? 0) });
    }
  } catch {
    /* leave map empty — strip just omits the top-diff line */
  }
  return map;
}

// ── leaderboard ───────────────────────────────────────────────────────────────

interface LbRow {
  id: number;
  address: string;
  diff?: number;
  total_blocks?: number;
  blocks?: number;
}

function mapLbEntry(r: LbRow): LeaderboardEntry {
  return {
    rank: r.id,
    address: r.address,
    bestDiff: r.diff !== undefined ? Number(r.diff) : undefined,
    blocks: Number(r.total_blocks ?? r.blocks ?? 0) || undefined,
  };
}

export async function getLeaderboard(): Promise<Leaderboard> {
  if (config.mockData) {
    const lb = mockLeaderboard();
    leaderboardCache.set(lb);
    return lb;
  }
  try {
    const [diff, loyalty] = await Promise.all([
      fetchJson<LbRow[]>(`${base()}/api/leaderboard?type=difficulty&limit=100&round=current`),
      fetchJson<LbRow[]>(`${base()}/api/leaderboard?type=loyalty&limit=25&round=current`),
    ]);
    const lb = {
      difficulty: (diff ?? []).map(mapLbEntry),
      loyalty: (loyalty ?? []).map(mapLbEntry),
    };
    leaderboardCache.set(lb);
    return lb;
  } catch {
    return leaderboardCache.get() ?? { difficulty: [], loyalty: [] };
  }
}

// ── Refinery order book (/api/router/orders) ─────────────────────────────────

interface RouterOrder {
  id: number;
  status: string;
  username: string; // "<address>.refinery"
  requested_hash_days: number;
  hashrate: number; // H/s
  delivered_hash_days: number;
  best_share: number | null;
}

/** The bc1… address is everything before the first "." in the username. */
export function addressFromRouterUsername(username: string): string {
  const u = username || "";
  const dot = u.indexOf(".");
  return dot === -1 ? u : u.slice(0, dot);
}

/**
 * Delivery route from the username suffix. We only label "Refinery" when we're
 * certain the order came through parasite.space's Refinery (the ".refinery"
 * suffix). Anything else (other rental proxies, KMH, direct) is unknowable from
 * public data, so it's "UNKNOWN".
 */
export function providerFromRouterUsername(username: string): string {
  const u = username || "";
  const dot = u.indexOf(".");
  if (dot === -1) return "UNKNOWN";
  return u.slice(dot + 1).toLowerCase() === "refinery" ? "Refinery" : "UNKNOWN";
}

function mapRouterOrder(o: RouterOrder): RefineryOrder & { address: string } {
  const requested = Number(o.requested_hash_days ?? 0);
  const delivered = Number(o.delivered_hash_days ?? 0);
  const progress = requested > 0 ? Math.min(100, (delivered / requested) * 100) : 0;
  const status: OrderStatus =
    o.status === "fulfilled" || o.status === "complete"
      ? "fulfilled"
      : o.status === "expired"
        ? "expired"
        : "active";
  return {
    id: String(o.id),
    status,
    requestedPhd: requested / H_PER_PH,
    hashratePhs: Number(o.hashrate ?? 0) / H_PER_PH,
    bestShare: Number(o.best_share ?? 0),
    progressPercent: Math.round(progress),
    provider: providerFromRouterUsername(o.username),
    address: addressFromRouterUsername(o.username),
  };
}

/** Raw router orders with the address attached (used for per-address filtering). */
export async function getRouterOrders(): Promise<Array<RefineryOrder & { address: string }>> {
  if (config.mockData) {
    const s = mockRefineryState();
    return s.orders.map((o) => ({ ...o, address: "bc1qmock0refinery0operator0xxxxxxxxxxxxxxxxx" }));
  }
  try {
    const rows = await fetchJson<RouterOrder[]>(`${base()}/api/router/orders`);
    return (Array.isArray(rows) ? rows : []).map(mapRouterOrder);
  } catch {
    return [];
  }
}

export async function getRefineryState(): Promise<RefineryState> {
  if (config.mockData) {
    const s = mockRefineryState();
    refineryCache.set(s);
    return s;
  }
  try {
    const orders = await getRouterOrders();
    const s: RefineryState = { hashpriceSatsPerPhd: 0, orders };
    refineryCache.set(s);
    return s;
  } catch (err) {
    refineryCache.markFailure();
    const last = refineryCache.get();
    if (last) return last;
    throw err;
  }
}

// ── per-address ───────────────────────────────────────────────────────────────

interface UserApi {
  hashrate?: number; // H/s
  workers?: number;
  bestDifficulty?: string | number;
  uptime?: string;
  workerData?: Array<{ name?: string; hashrate?: string | number; bestDifficulty?: string | number }>;
}
interface AccountApi {
  account?: { total_diff?: number; metadata?: { block_count?: number } } | null;
}

/**
 * Short-TTL cache for /address lookups. Each getUserStats() call fans out to 4
 * upstream endpoints, so we memoize per-address for a few seconds to stop a
 * refresh/scrape from multiplying that fan-out. TTL is deliberately small so the
 * page still feels live.
 */
const USER_STATS_TTL_MS = 45_000;
const userStatsCache = new Map<string, { v: UserStats; exp: number }>();

export async function getUserStats(address: string): Promise<UserStats> {
  if (config.mockData) return mockUserStats(address);

  const now = Date.now();
  const cachedUser = userStatsCache.get(address);
  if (cachedUser && cachedUser.exp > now) return cachedUser.v;

  // Confirmed real shapes (parasite.space):
  //   /api/user/<addr>            → hashrate(H/s), workers, bestDifficulty("906G"), workerData[]
  //   /api/account/<addr>         → account.total_diff (Total Work), metadata.block_count
  //   /api/highest-diff?address=… → this address's per-block best shares
  //   /api/router/orders          → filtered by address for its Refinery orders
  const encoded = encodeURIComponent(address);
  const [user, account, diffs, orders] = await Promise.all([
    fetchJson<UserApi>(`${base()}/api/user/${encoded}`).catch(() => ({}) as UserApi),
    fetchJson<AccountApi>(`${base()}/api/account/${encoded}`).catch(() => ({}) as AccountApi),
    fetchJson<HighestDiffRow[]>(
      `${base()}/api/highest-diff?address=${encoded}&type=user-diffs&limit=100`,
    ).catch(() => [] as HighestDiffRow[]),
    getRouterOrders().catch(() => [] as Array<RefineryOrder & { address: string }>),
  ]);

  const diffsMax = (diffs ?? []).reduce((m, d) => Math.max(m, Number(d.difficulty ?? 0)), 0);
  const bestDifficulty = Math.max(parseDiffStr(user.bestDifficulty ?? 0), diffsMax);
  const totalWorkDiff = Number(account.account?.total_diff ?? 0) || diffsMax;
  const myOrders = orders.filter((o) => o.address === address).map(({ address: _a, ...rest }) => rest);
  const rigs = (user.workerData ?? [])
    .map((w) => ({
      name: String(w.name ?? "?"),
      hashratePhs: Number(w.hashrate ?? 0) / H_PER_PH,
      bestDiff: parseDiffStr(w.bestDifficulty ?? 0),
    }))
    .sort((a, b) => b.hashratePhs - a.hashratePhs);

  const result: UserStats = {
    address,
    hashratePhs: Number(user.hashrate ?? 0) / H_PER_PH,
    bestDifficulty,
    totalWorkDiff,
    orders: myOrders,
    workers: user.workers,
    rigs,
    blockCount: account.account?.metadata?.block_count,
    uptime: user.uptime,
  };
  userStatsCache.set(address, { v: result, exp: now + USER_STATS_TTL_MS });
  return result;
}

// ── freshness ─────────────────────────────────────────────────────────────────

export function poolFreshness(): Freshness {
  return poolCache.freshness();
}
