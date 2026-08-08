import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, hasSupabase } from "../config.js";

/**
 * Owner-set manual prices for venues with no public price feed (KMH is Discord-
 * login-gated, Braiins has no arbitrary-stratum rentals, etc.). The board reads
 * these and shows them honestly as "manual · updated Xm ago". Self-contained
 * store: Supabase when configured, else in-memory (dev).
 */

export interface ManualPrice {
  venue: string;
  satsPerPhd: number;
  note?: string;
  updatedBy?: string;
  updatedAt: number;
}

const mem = new Map<string, ManualPrice>();

let sb: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (!sb) sb = createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } });
  return sb;
}

export async function getManualPrice(venue: string): Promise<ManualPrice | null> {
  const client = db();
  if (client) {
    const { data } = await client.from("manual_prices").select("*").eq("venue", venue).limit(1);
    const r = data?.[0];
    if (!r) return null;
    return {
      venue: r.venue,
      satsPerPhd: Number(r.sats_per_phd) || 0,
      note: r.note ?? undefined,
      updatedBy: r.updated_by ?? undefined,
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
    };
  }
  return mem.get(venue) ?? null;
}

export async function getAllManualPrices(): Promise<ManualPrice[]> {
  const client = db();
  if (client) {
    const { data } = await client.from("manual_prices").select("*");
    return (data ?? []).map((r) => ({
      venue: r.venue,
      satsPerPhd: Number(r.sats_per_phd) || 0,
      note: r.note ?? undefined,
      updatedBy: r.updated_by ?? undefined,
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
    }));
  }
  return [...mem.values()];
}

export async function setManualPrice(
  venue: string,
  satsPerPhd: number,
  updatedBy: string,
  note?: string,
): Promise<void> {
  const row: ManualPrice = { venue, satsPerPhd, note, updatedBy, updatedAt: Date.now() };
  const client = db();
  if (client) {
    await client.from("manual_prices").upsert(
      {
        venue,
        sats_per_phd: satsPerPhd,
        note: note ?? null,
        updated_by: updatedBy,
        updated_at: new Date(row.updatedAt).toISOString(),
      },
      { onConflict: "venue" },
    );
  } else {
    mem.set(venue, row);
  }
}
