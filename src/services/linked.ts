import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, hasSupabase } from "../config.js";
import { encryptSecret, decryptSecret, maskSecret, isVaultReady } from "./vault.js";

/**
 * Linked venue accounts — the non-custodial heart of ordering.
 *
 * A user links their OWN NiceHash/MRR API key (scoped to placing orders, never
 * withdrawal). We store it encrypted at rest via the vault and only ever
 * decrypt it in memory at the moment we place an order the user asked for.
 * Parahawk never holds funds; it holds a key the user can revoke at the venue
 * any time.
 *
 * Self-contained store: Supabase table `linked_accounts` when configured, else
 * an in-memory map (dev/mock). Ciphertext never leaves this module except
 * through `getCredentials`, which the order path calls.
 */

export type Venue = "nicehash" | "miningrigrentals";

export interface LinkedAccountView {
  address: string; // owner
  venue: Venue;
  orgId: string | null; // NiceHash org id (not secret)
  keyMasked: string; // "…a1b2"
  createdAt: number;
}

export interface LinkInput {
  address: string;
  venue: Venue;
  orgId?: string;
  apiKey: string;
  apiSecret: string;
}

interface StoredRow {
  address: string;
  venue: Venue;
  orgId: string | null;
  keyMasked: string;
  keyCipher: string;
  secretCipher: string;
  createdAt: number;
}

// ── in-memory fallback (dev / mock) ─────────────────────────────────────────
const mem = new Map<string, StoredRow>(); // key = `${address}:${venue}`
const memKey = (address: string, venue: Venue) => `${address}:${venue}`;

let sb: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (!hasSupabase()) return null;
  if (!sb) sb = createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } });
  return sb;
}

function toView(r: StoredRow): LinkedAccountView {
  return { address: r.address, venue: r.venue, orgId: r.orgId, keyMasked: r.keyMasked, createdAt: r.createdAt };
}

/** Link (or replace) a venue key for an address. Encrypts before storage. */
export async function linkAccount(input: LinkInput): Promise<LinkedAccountView> {
  if (!isVaultReady()) {
    throw new Error("KEYS_SECRET not set — linking is disabled so keys are never stored in the clear");
  }
  const row: StoredRow = {
    address: input.address,
    venue: input.venue,
    orgId: input.orgId?.trim() || null,
    keyMasked: maskSecret(input.apiKey),
    keyCipher: encryptSecret(input.apiKey),
    secretCipher: encryptSecret(input.apiSecret),
    createdAt: Date.now(),
  };

  const client = db();
  if (client) {
    await client.from("linked_accounts").upsert(
      {
        address: row.address,
        venue: row.venue,
        org_id: row.orgId,
        key_masked: row.keyMasked,
        key_cipher: row.keyCipher,
        secret_cipher: row.secretCipher,
        created_at: new Date(row.createdAt).toISOString(),
      },
      { onConflict: "address,venue" },
    );
  } else {
    mem.set(memKey(row.address, row.venue), row);
  }
  return toView(row);
}

/** All linked accounts for an address (safe view — no ciphertext). */
export async function getLinkedAccounts(address: string): Promise<LinkedAccountView[]> {
  const client = db();
  if (client) {
    const { data } = await client.from("linked_accounts").select("*").eq("address", address);
    return (data ?? []).map((r) => ({
      address: r.address,
      venue: r.venue as Venue,
      orgId: r.org_id ?? null,
      keyMasked: r.key_masked ?? "…",
      createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
    }));
  }
  return [...mem.values()].filter((r) => r.address === address).map(toView);
}

/** Remove a linked account. */
export async function unlinkAccount(address: string, venue: Venue): Promise<void> {
  const client = db();
  if (client) {
    await client.from("linked_accounts").delete().eq("address", address).eq("venue", venue);
  } else {
    mem.delete(memKey(address, venue));
  }
}

/**
 * Decrypt a linked account's credentials — ONLY for the order-placement path.
 * Returns null if not linked. Never log or return this to a client.
 */
export async function getCredentials(
  address: string,
  venue: Venue,
): Promise<{ orgId: string | null; apiKey: string; apiSecret: string } | null> {
  let row: StoredRow | undefined;
  const client = db();
  if (client) {
    const { data } = await client.from("linked_accounts").select("*").eq("address", address).eq("venue", venue).limit(1);
    const r = data?.[0];
    if (r) {
      row = {
        address: r.address,
        venue: r.venue,
        orgId: r.org_id ?? null,
        keyMasked: r.key_masked ?? "…",
        keyCipher: r.key_cipher,
        secretCipher: r.secret_cipher,
        createdAt: r.created_at ? new Date(r.created_at).getTime() : 0,
      };
    }
  } else {
    row = mem.get(memKey(address, venue));
  }
  if (!row) return null;
  return {
    orgId: row.orgId,
    apiKey: decryptSecret(row.keyCipher),
    apiSecret: decryptSecret(row.secretCipher),
  };
}
