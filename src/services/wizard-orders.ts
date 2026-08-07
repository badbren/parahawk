import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, hasSupabase } from "../config.js";

/**
 * Record of orders the Marketplace wizard knows about. Non-custodial: these are
 * orders the user placed from their OWN venue account (or confirmed for a
 * deep-link venue) — Parahawk just remembers them for the Delivery Auditor and
 * order history. Self-contained store: Supabase when configured, else in-memory.
 */

export interface WizardOrder {
  id: string;
  address: string;
  venue: string;
  phd: number;
  phRate?: number;
  durationHrs?: number;
  poolTarget?: string;
  satsPaid?: number;
  status: "placed" | "dryrun" | "done" | "expired" | "cancelled";
  placedAt: number;
}

const mem: WizardOrder[] = [];

let sb: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (!sb) sb = createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } });
  return sb;
}

export async function saveWizardOrder(o: WizardOrder): Promise<void> {
  const client = db();
  if (client) {
    await client.from("wizard_orders").upsert(
      {
        id: o.id,
        address: o.address,
        venue: o.venue,
        phd: o.phd,
        ph_rate: o.phRate ?? null,
        duration_hrs: o.durationHrs ?? null,
        pool_target: o.poolTarget ?? null,
        sats_paid: o.satsPaid ?? null,
        status: o.status,
        placed_at: new Date(o.placedAt).toISOString(),
      },
      { onConflict: "id" },
    );
  } else {
    const i = mem.findIndex((m) => m.id === o.id);
    if (i >= 0) mem[i] = o;
    else mem.unshift(o);
  }
}

export async function getWizardOrders(address: string, limit = 25): Promise<WizardOrder[]> {
  const client = db();
  if (client) {
    const { data } = await client
      .from("wizard_orders")
      .select("*")
      .eq("address", address)
      .order("placed_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => ({
      id: r.id,
      address: r.address,
      venue: r.venue,
      phd: r.phd ?? 0,
      phRate: r.ph_rate ?? undefined,
      durationHrs: r.duration_hrs ?? undefined,
      poolTarget: r.pool_target ?? undefined,
      satsPaid: r.sats_paid ?? undefined,
      status: r.status ?? "placed",
      placedAt: r.placed_at ? new Date(r.placed_at).getTime() : 0,
    }));
  }
  return mem.filter((m) => m.address === address).slice(0, limit);
}
