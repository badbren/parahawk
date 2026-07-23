import { config } from "../config.js";
import { Cached, fetchJson } from "./cache.js";
import { mockPoolStats, mockUserStats, mockRefineryState, mockHitsInRange } from "./mock.js";
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
    // synthesise a small leaderboard from mock users
    const mk = (n: number, big: boolean): LeaderboardEntry[] =>
      Array.from({ length: n }, (_, i) => {
        const u = mockUserStats(`bc1qmock${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`);
        return {
          rank: i + 1,
          address: `bc1q...${(1000 + i).toString(36)}`,
          bestDiff: big ? u.bestDifficulty : undefined,
          blocks: big ? undefined : 600 + i,
        };
      });
    const lb = { difficulty: mk(15, true), loyalty: mk(15, false) };
    leaderboardCache.set(lb);
    return lb;
  }
  try {
    const [diff, loyalty] = await Promise.all([
      fetchJson<LbRow[]>(`${base()}/api/leaderboard?type=difficulty&limit=25&round=current`),
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

/** Strip the ".refinery" suffix Parasite adds to Refinery usernames. */
export function addressFromRouterUsername(username: string): string {
  return (username || "").replace(/\.refinery$/i, "");
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

export async function getUserStats(address: string): Promise<UserStats> {
  if (config.mockData) return mockUserStats(address);

  // Best-effort real mapping. Confirmed: user-diffs gives this address's best
  // shares; router/orders gives its Refinery orders (full addresses). The
  // /api/user/<addr> account shape is finalised once we see a real miner's JSON.
  const encoded = encodeURIComponent(address);
  const [account, diffs, orders] = await Promise.all([
    fetchJson<Record<string, any>>(`${base()}/api/user/${encoded}`).catch(() => null),
    fetchJson<HighestDiffRow[]>(
      `${base()}/api/highest-diff?address=${encoded}&type=user-diffs&limit=500`,
    ).catch(() => [] as HighestDiffRow[]),
    getRouterOrders().catch(() => [] as Array<RefineryOrder & { address: string }>),
  ]);

  const bestDifficulty = (diffs ?? []).reduce((m, d) => Math.max(m, Number(d.difficulty ?? 0)), 0);
  const a = account ?? {};
  const myOrders = orders.filter((o) => o.address === address).map(({ address: _a, ...rest }) => rest);
  // total work: prefer an account field; else approximate from best diff.
  const totalWorkDiff = Number(a.totalWork ?? a.total_work ?? a.workSinceLastBlock ?? bestDifficulty);

  return {
    address,
    hashratePhs: Number(a.hashrate ?? a.hashrate15m ?? 0) / (a.hashrate ? H_PER_PH : 1) || 0,
    bestDifficulty,
    totalWorkDiff,
    orders: myOrders,
  };
}

// ── freshness ─────────────────────────────────────────────────────────────────

export function poolFreshness(): Freshness {
  return poolCache.freshness();
}
