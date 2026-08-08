import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, hasSupabase } from "../config.js";

/**
 * Time-series of per-badge totals, so /badges can show a 24h growth %. Snapshots
 * are written opportunistically on page view, throttled to ~hourly, so the table
 * doesn't need a dedicated poller. The 24h baseline is the newest snapshot that
 * is 20–30h old; until enough history accrues, growth is simply unavailable
 * (shown as "—", never faked).
 */

export interface BadgeSnapshot {
  ts: number;
  totals: Record<string, number>;
  holders: Record<string, number>;
}

const MIN_GAP_MS = 55 * 60_000; // throttle writes to ~hourly
const BASE_MIN_AGE_MS = 20 * 3_600_000;
const BASE_MAX_AGE_MS = 30 * 3_600_000;

const mem: BadgeSnapshot[] = []; // dev fallback

let sb: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (!sb) sb = createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } });
  return sb;
}

async function latestTs(): Promise<number | null> {
  const client = db();
  if (client) {
    const { data } = await client.from("badge_totals").select("ts").order("ts", { ascending: false }).limit(1);
    return data?.[0]?.ts ? new Date(data[0].ts).getTime() : null;
  }
  return mem.length ? mem[mem.length - 1]!.ts : null;
}

/** Write a snapshot if the last one is older than the throttle window. */
export async function recordBadgeSnapshot(
  totals: Record<string, number>,
  holders: Record<string, number>,
): Promise<void> {
  const last = await latestTs().catch(() => null);
  if (last && Date.now() - last < MIN_GAP_MS) return;
  const client = db();
  if (client) {
    await client.from("badge_totals").insert({ totals, holders });
  } else {
    mem.push({ ts: Date.now(), totals, holders });
  }
}

/** The ~24h-ago baseline: newest snapshot between 20h and 30h old, or null. */
export async function getBadgeBaseline24h(): Promise<BadgeSnapshot | null> {
  const now = Date.now();
  const client = db();
  if (client) {
    const { data } = await client
      .from("badge_totals")
      .select("*")
      .lte("ts", new Date(now - BASE_MIN_AGE_MS).toISOString())
      .gte("ts", new Date(now - BASE_MAX_AGE_MS).toISOString())
      .order("ts", { ascending: false })
      .limit(1);
    const r = data?.[0];
    if (!r) return null;
    return { ts: new Date(r.ts).getTime(), totals: r.totals ?? {}, holders: r.holders ?? {} };
  }
  const hit = [...mem]
    .reverse()
    .find((s) => now - s.ts >= BASE_MIN_AGE_MS && now - s.ts <= BASE_MAX_AGE_MS);
  return hit ?? null;
}
