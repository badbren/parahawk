import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, hasSupabase } from "../config.js";

/**
 * Daily traffic — unique visitors (by hashed IP) and page views per UTC day.
 *
 * Parahawk runs as ONE Vercel serverless function behind an edge CDN that caches
 * public pages (s-maxage=20). A server-side hit counter therefore both
 * UNDERCOUNTS (repeat hits served from the CDN never reach the function) and
 * can LOSE fire-and-forget writes when the instance freezes after responding.
 * So counting is driven by a client beacon: the browser pings the uncached /hit
 * endpoint once per page load and that route awaits recordVisit before it 204s.
 *
 * Self-contained store, same shape as manual-prices.ts: Supabase when
 * configured, else an in-memory Map. The Map is REAL unpersisted counting for
 * local dev (it resets when the process restarts) — not mock/synthetic data.
 * Raw IPs are never stored: the visitor key is a salted SHA-256 prefix.
 */

export interface TrafficDay {
  /** UTC day, "YYYY-MM-DD". */
  day: string;
  /** Distinct IP hashes seen that day. */
  visitors: number;
  /** Total page views (sum of hits) that day. */
  views: number;
}

export interface TrafficWindow {
  visitors: number;
  views: number;
}

export interface TrafficSummary {
  /** One entry per day, oldest → newest, gap-filled with zeros. */
  days: TrafficDay[];
  today: TrafficDay;
  last7: TrafficWindow;
  last30: TrafficWindow;
  backend: "supabase" | "memory";
}

/** Minimal request shape we read — kept tiny so it's trivially testable. */
export interface HitRequest {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/** Salt used when KEYS_SECRET is unset (dev). Constant, not secret — its only
 * job is to keep raw IPs out of storage, not to resist an attacker who already
 * holds the database. */
const IP_SALT_FALLBACK = "parahawk-traffic-ip-salt-v1";

const DAY_MS = 86_400_000;

/** UTC day bucket "YYYY-MM-DD" for a timestamp (default: now). */
export function dayKey(ts: number = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Caller IP: leftmost `x-forwarded-for` hop (Vercel sets it), else the socket. */
export function clientIp(req: HitRequest): string {
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  if (raw) {
    const first = raw.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? "";
}

/** Salted SHA-256 of an IP, hex, sliced to 24 chars. We never store raw IPs. */
export function hashIp(ip: string): string {
  const salt = config.keysSecret || IP_SALT_FALLBACK;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 24);
}

// In-memory fallback: day → (ipHash → hit count). Real counting, not mock.
const mem = new Map<string, Map<string, number>>();

let sb: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (!sb) sb = createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } });
  return sb;
}

/**
 * Record one page view. Never throws to the caller — a lost count must never
 * turn into a 500 on the beacon. Supabase path is an atomic upsert-increment
 * RPC; memory path bumps the nested Map.
 */
export async function recordVisit(req: HitRequest): Promise<void> {
  try {
    const day = dayKey();
    const ipHash = hashIp(clientIp(req));
    const client = db();
    if (client) {
      await client.rpc("parahawk_track_hit", { p_day: day, p_ip_hash: ipHash });
      return;
    }
    let byIp = mem.get(day);
    if (!byIp) {
      byIp = new Map();
      mem.set(day, byIp);
    }
    byIp.set(ipHash, (byIp.get(ipHash) ?? 0) + 1);
  } catch (err) {
    console.error("[traffic] recordVisit failed:", err);
  }
}

/** The last `n` UTC day keys, oldest → newest, ending today. */
function recentDayKeys(n: number): string[] {
  const now = Date.now();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(now - i * DAY_MS));
  return out;
}

/** Per-day stats from the in-memory store. */
function memDay(day: string): TrafficWindow {
  const byIp = mem.get(day);
  if (!byIp) return { visitors: 0, views: 0 };
  let views = 0;
  for (const c of byIp.values()) views += c;
  return { visitors: byIp.size, views };
}

/** True distinct visitors + total views across a set of days (memory store). */
function memWindow(dayKeys: string[]): TrafficWindow {
  const ips = new Set<string>();
  let views = 0;
  for (const d of dayKeys) {
    const byIp = mem.get(d);
    if (!byIp) continue;
    for (const [ip, c] of byIp) {
      ips.add(ip);
      views += c;
    }
  }
  return { visitors: ips.size, views };
}

/**
 * Daily series (gap-filled, oldest → newest) plus true-distinct 7d/30d windows.
 * Supabase reads the `traffic_daily_totals` view for the series and calls the
 * `parahawk_traffic_windows` RPC for the windows (distinct-over-a-window can't
 * be derived by summing per-day visitor counts); memory aggregates the Map.
 */
export async function getTrafficSummary(days = 30): Promise<TrafficSummary> {
  const window = recentDayKeys(days);
  const todayKey = window[window.length - 1]!;
  const client = db();

  if (client) {
    const since = window[0]!;
    const [totalsRes, winRes] = await Promise.all([
      client
        .from("traffic_daily_totals")
        .select("day, visitors, views")
        .gte("day", since)
        .order("day", { ascending: true }),
      client.rpc("parahawk_traffic_windows"),
    ]);
    const byDay = new Map<string, TrafficWindow>();
    for (const r of totalsRes.data ?? []) {
      byDay.set(String(r.day).slice(0, 10), {
        visitors: Number(r.visitors) || 0,
        views: Number(r.views) || 0,
      });
    }
    const daysList: TrafficDay[] = window.map((d) => ({ day: d, ...(byDay.get(d) ?? { visitors: 0, views: 0 }) }));
    const w = (winRes.data ?? [])[0] ?? {};
    return {
      days: daysList,
      today: { day: todayKey, ...(byDay.get(todayKey) ?? { visitors: 0, views: 0 }) },
      last7: { visitors: Number(w.visitors_7d) || 0, views: Number(w.views_7d) || 0 },
      last30: { visitors: Number(w.visitors_30d) || 0, views: Number(w.views_30d) || 0 },
      backend: "supabase",
    };
  }

  const daysList: TrafficDay[] = window.map((d) => ({ day: d, ...memDay(d) }));
  return {
    days: daysList,
    today: { day: todayKey, ...memDay(todayKey) },
    last7: memWindow(recentDayKeys(7)),
    last30: memWindow(recentDayKeys(30)),
    backend: "memory",
  };
}
