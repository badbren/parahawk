import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config, hasSupabase } from "../config.js";

/**
 * Hand-typed prices for venues with no public price feed (KMH is Discord-
 * login-gated, Braiins has no arbitrary-stratum rentals, etc.). The board reads
 * these and shows them honestly as "manual · updated Xm ago".
 *
 * Who types them: the owner (/admin) and, since 2026-11-06, visitors holding
 * the "Trusted" badge (src/web/price-routes.ts, rules in price-updates.ts).
 * Every change is logged, so the owner can see who changed what and put it
 * back, and the owner can block an address from editing prices.
 *
 * THE RULE (same as src/game/store.ts): only the deployed site writes to the
 * live database. Local runs use the production .env, so a local edit that
 * reached for Supabase would change the price on parahawk.space. So:
 *   • on Vercel (`VERCEL` is set there and nowhere else): Supabase —
 *     manual_prices, manual_price_history, price_editor_bans;
 *   • everywhere else: a JSON overlay under data/ (gitignored). Local reads
 *     still show the live prices (read-only), a local edit shows over them
 *     (newest wins), and nothing local ever reaches production. History and
 *     bans stay local too.
 */

export interface ManualPrice {
  venue: string;
  satsPerPhd: number;
  note?: string;
  updatedBy?: string;
  updatedAt: number;
}

/** One change to a hand-typed price: an edit, or the owner putting one back. */
export interface PriceChange {
  id: string;
  venue: string;
  /** What it was before (null = no price was set). */
  oldSats: number | null;
  /** What it became (0 = cleared). */
  newSats: number;
  /** The USD figure typed, when the change came from a USD box. */
  usd: number | null;
  by: string;
  at: number;
  kind: "update" | "revert";
  /** For a revert: the change it undid. */
  revertOf?: string;
}

/** An address the owner has blocked from editing prices. */
export interface PriceBan {
  address: string;
  by: string;
  at: number;
}

export interface ChangeQuery {
  /** Default 50. */
  limit?: number;
  venue?: string;
  by?: string;
  /** Only changes at or after this time (ms). */
  since?: number;
}

export interface ManualPriceStore {
  readonly kind: "memory" | "file" | "supabase";
  get(venue: string): Promise<ManualPrice | null>;
  all(): Promise<ManualPrice[]>;
  /** Set a venue's price; satsPerPhd ≤ 0 clears it. */
  put(price: ManualPrice): Promise<void>;
  addChange(change: PriceChange): Promise<void>;
  /** Newest first. */
  changes(q?: ChangeQuery): Promise<PriceChange[]>;
  change(id: string): Promise<PriceChange | null>;
  bans(): Promise<PriceBan[]>;
  isBanned(address: string): Promise<boolean>;
  ban(ban: PriceBan): Promise<void>;
  unban(address: string): Promise<void>;
}

/**
 * Bech32 addresses (bc1…/tb1…) are one address in either case; base58 ones are
 * case-sensitive. Bans key on this so "BC1Q…" can't slip past a "bc1q…" ban.
 */
export function addressKey(address: string): string {
  const a = address.trim();
  return /^(bc1|tb1|bcrt1)/i.test(a) ? a.toLowerCase() : a;
}

const MAX_CHANGES_KEPT = 5_000;

/** The live prices, read-only — what a local run shows under its own edits. */
export type LivePriceReader = () => Promise<ManualPrice[]>;

/** Prices, history and bans held in memory — tests, and a deployed site with no database. */
export class MemoryManualPriceStore implements ManualPriceStore {
  readonly kind: "memory" | "file" = "memory";
  /** Venue → price; a cleared price stays as a tombstone (satsPerPhd 0) so it can hide a live one. */
  protected prices = new Map<string, ManualPrice>();
  protected log: PriceChange[] = [];
  protected banned = new Map<string, PriceBan>();
  private warned = false;

  constructor(protected readonly live: LivePriceReader | null = null) {}

  /** Persist hook (the file store). */
  protected changed(): void {}

  /** Live prices with this store's own on top — whichever was set last wins. */
  private async merged(): Promise<Map<string, ManualPrice>> {
    const out = new Map<string, ManualPrice>();
    if (this.live) {
      try {
        for (const p of await this.live()) out.set(p.venue, p);
      } catch (err) {
        if (!this.warned) console.warn("[manual-prices] live read failed:", (err as Error).message);
        this.warned = true;
      }
    }
    for (const p of this.prices.values()) {
      const cur = out.get(p.venue);
      if (!cur || p.updatedAt >= cur.updatedAt) out.set(p.venue, p);
    }
    return out;
  }

  async get(venue: string): Promise<ManualPrice | null> {
    const p = (await this.merged()).get(venue);
    return p && p.satsPerPhd > 0 ? { ...p } : null;
  }

  async all(): Promise<ManualPrice[]> {
    return [...(await this.merged()).values()].filter((p) => p.satsPerPhd > 0).map((p) => ({ ...p }));
  }

  async put(price: ManualPrice): Promise<void> {
    this.prices.set(price.venue, { ...price, satsPerPhd: price.satsPerPhd > 0 ? price.satsPerPhd : 0 });
    this.changed();
  }

  async addChange(change: PriceChange): Promise<void> {
    this.log.push({ ...change });
    if (this.log.length > MAX_CHANGES_KEPT) this.log = this.log.slice(-MAX_CHANGES_KEPT);
    this.changed();
  }

  async changes(q: ChangeQuery = {}): Promise<PriceChange[]> {
    const by = q.by != null ? addressKey(q.by) : null;
    return this.log
      .filter((c) =>
        (q.venue == null || c.venue === q.venue) &&
        (by == null || addressKey(c.by) === by) &&
        (q.since == null || c.at >= q.since))
      .sort((a, b) => b.at - a.at)
      .slice(0, q.limit ?? 50)
      .map((c) => ({ ...c }));
  }

  async change(id: string): Promise<PriceChange | null> {
    const c = this.log.find((x) => x.id === id);
    return c ? { ...c } : null;
  }

  async bans(): Promise<PriceBan[]> {
    return [...this.banned.values()].sort((a, b) => b.at - a.at).map((b) => ({ ...b }));
  }

  async isBanned(address: string): Promise<boolean> {
    return this.banned.has(addressKey(address));
  }

  async ban(ban: PriceBan): Promise<void> {
    this.banned.set(addressKey(ban.address), { ...ban });
    this.changed();
  }

  async unban(address: string): Promise<void> {
    if (this.banned.delete(addressKey(address))) this.changed();
  }
}

/** The local store: a JSON file under data/, over the live prices (read-only). */
export class FileManualPriceStore extends MemoryManualPriceStore {
  override readonly kind = "file" as const;

  constructor(private readonly path: string, live: LivePriceReader | null = null) {
    super(live);
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { prices?: unknown; changes?: unknown; bans?: unknown };
      if (Array.isArray(raw.prices)) {
        for (const p of raw.prices as ManualPrice[]) if (p && typeof p.venue === "string") this.prices.set(p.venue, p);
      }
      if (Array.isArray(raw.changes)) this.log = (raw.changes as PriceChange[]).filter((c) => c && typeof c.id === "string");
      if (Array.isArray(raw.bans)) {
        for (const b of raw.bans as PriceBan[]) if (b && typeof b.address === "string") this.banned.set(addressKey(b.address), b);
      }
    } catch {
      // No file yet, or an unreadable one: start empty, the next write replaces it.
    }
  }

  protected override changed(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ prices: [...this.prices.values()], changes: this.log, bans: [...this.banned.values()] }));
    renameSync(tmp, this.path);
  }
}

// ── Postgres (manual_prices + supabase/migrations/20261106000400_price_updates.sql) ──

/** A Supabase error, surfaced — the history and bans are never quietly dropped. */
export class PriceStoreError extends Error {
  constructor(what: string, err: { message: string }) {
    super(`${what}: ${err.message}`);
    this.name = "PriceStoreError";
  }
}

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: unknown): number => (typeof v === "string" ? Date.parse(v) || 0 : 0);

export function rowToPrice(r: Record<string, unknown>): ManualPrice {
  return {
    venue: String(r.venue),
    satsPerPhd: Number(r.sats_per_phd) || 0,
    note: typeof r.note === "string" ? r.note : undefined,
    updatedBy: typeof r.updated_by === "string" ? r.updated_by : undefined,
    updatedAt: ms(r.updated_at),
  };
}

export function changeToRow(c: PriceChange): Record<string, unknown> {
  return {
    id: c.id,
    venue: c.venue,
    old_sats: c.oldSats,
    new_sats: c.newSats,
    usd: c.usd,
    by_address: c.by,
    at: iso(c.at),
    kind: c.kind,
    revert_of: c.revertOf ?? null,
  };
}

export function rowToChange(r: Record<string, unknown>): PriceChange {
  return {
    id: String(r.id),
    venue: String(r.venue),
    oldSats: r.old_sats == null ? null : Number(r.old_sats),
    newSats: Number(r.new_sats) || 0,
    usd: r.usd == null ? null : Number(r.usd),
    by: String(r.by_address ?? ""),
    at: ms(r.at),
    kind: r.kind === "revert" ? "revert" : "update",
    ...(typeof r.revert_of === "string" ? { revertOf: r.revert_of } : {}),
  };
}

export class SupabaseManualPriceStore implements ManualPriceStore {
  readonly kind = "supabase" as const;
  constructor(private readonly db: SupabaseClient) {}

  // The board reads prices on every rebuild: a hiccup shows the venue as unpriced, never an error page.
  async get(venue: string): Promise<ManualPrice | null> {
    const { data, error } = await this.db.from("manual_prices").select("*").eq("venue", venue).limit(1);
    if (error) { console.error("[manual-prices] read failed:", error.message); return null; }
    const r = data?.[0];
    if (!r) return null;
    const p = rowToPrice(r);
    return p.satsPerPhd > 0 ? p : null;
  }

  async all(): Promise<ManualPrice[]> {
    const { data, error } = await this.db.from("manual_prices").select("*");
    if (error) { console.error("[manual-prices] read failed:", error.message); return []; }
    return (data ?? []).map(rowToPrice).filter((p) => p.satsPerPhd > 0);
  }

  async put(p: ManualPrice): Promise<void> {
    if (p.satsPerPhd > 0) {
      const { error } = await this.db.from("manual_prices").upsert(
        { venue: p.venue, sats_per_phd: p.satsPerPhd, note: p.note ?? null, updated_by: p.updatedBy ?? null, updated_at: iso(p.updatedAt) },
        { onConflict: "venue" },
      );
      if (error) throw new PriceStoreError("save price", error);
    } else {
      const { error } = await this.db.from("manual_prices").delete().eq("venue", p.venue);
      if (error) throw new PriceStoreError("clear price", error);
    }
  }

  async addChange(c: PriceChange): Promise<void> {
    const { error } = await this.db.from("manual_price_history").insert(changeToRow(c));
    if (error) throw new PriceStoreError("log price change", error);
  }

  async changes(q: ChangeQuery = {}): Promise<PriceChange[]> {
    let query = this.db.from("manual_price_history").select("*").order("at", { ascending: false }).limit(q.limit ?? 50);
    if (q.venue != null) query = query.eq("venue", q.venue);
    if (q.by != null) query = query.eq("by_address", q.by);
    if (q.since != null) query = query.gte("at", iso(q.since));
    const { data, error } = await query;
    if (error) throw new PriceStoreError("read price history", error);
    return (data ?? []).map(rowToChange);
  }

  async change(id: string): Promise<PriceChange | null> {
    const { data, error } = await this.db.from("manual_price_history").select("*").eq("id", id).limit(1);
    if (error) throw new PriceStoreError("read price change", error);
    return data?.[0] ? rowToChange(data[0]) : null;
  }

  async bans(): Promise<PriceBan[]> {
    const { data, error } = await this.db.from("price_editor_bans").select("*").order("banned_at", { ascending: false });
    if (error) throw new PriceStoreError("read price bans", error);
    return (data ?? []).map((r) => ({ address: String(r.address), by: String(r.banned_by ?? ""), at: ms(r.banned_at) }));
  }

  async isBanned(address: string): Promise<boolean> {
    const { data, error } = await this.db.from("price_editor_bans").select("address").eq("address", addressKey(address)).limit(1);
    if (error) throw new PriceStoreError("read price bans", error);
    return (data ?? []).length > 0;
  }

  async ban(b: PriceBan): Promise<void> {
    const { error } = await this.db.from("price_editor_bans").upsert(
      { address: addressKey(b.address), banned_by: b.by, banned_at: iso(b.at) },
      { onConflict: "address" },
    );
    if (error) throw new PriceStoreError("block price editor", error);
  }

  async unban(address: string): Promise<void> {
    const { error } = await this.db.from("price_editor_bans").delete().eq("address", addressKey(address));
    if (error) throw new PriceStoreError("unblock price editor", error);
  }
}

export interface ManualPriceStoreEnv {
  VERCEL?: string;
  MANUAL_PRICES_FILE?: string;
}

export interface ManualPriceStoreDeps {
  hasSupabase?: () => boolean;
  makeSupabase?: () => SupabaseClient;
}

/** Where prices live: Supabase on Vercel; locally a data/ overlay over the live prices (read-only). */
export function createManualPriceStore(env: ManualPriceStoreEnv = process.env, deps: ManualPriceStoreDeps = {}): ManualPriceStore {
  const has = deps.hasSupabase ?? hasSupabase;
  const make = deps.makeSupabase
    ?? (() => createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } }));
  if (env.VERCEL) {
    if (!has()) {
      console.warn("[manual-prices] no Supabase configured on Vercel — hand-typed prices are in-memory only");
      return new MemoryManualPriceStore();
    }
    return new SupabaseManualPriceStore(make());
  }
  let live: LivePriceReader | null = null;
  if (has()) {
    const remote = new SupabaseManualPriceStore(make());
    live = () => remote.all();
  }
  return new FileManualPriceStore(env.MANUAL_PRICES_FILE ?? resolve("data", "manual-prices.json"), live);
}

let shared: ManualPriceStore | null = null;

/** The process's store, made on first use. */
export function manualPriceStore(): ManualPriceStore {
  return (shared ??= createManualPriceStore());
}

/** Swap the store (tests). */
export function useManualPriceStore(next: ManualPriceStore | null): void {
  shared = next;
}

// ── Change notices: the board drops its cache so a new price shows at once ──

const listeners = new Set<(venue: string) => void>();

export function onManualPriceChange(fn: (venue: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const notify = (venue: string) => {
  for (const fn of [...listeners]) {
    try { fn(venue); } catch { /* a listener's problem, not the save's */ }
  }
};

// ── The API the site uses ─────────────────────────────────────────────────────

export async function getManualPrice(venue: string): Promise<ManualPrice | null> {
  return manualPriceStore().get(venue);
}

export async function getAllManualPrices(): Promise<ManualPrice[]> {
  return manualPriceStore().all();
}

export interface PriceChangeInput {
  venue: string;
  /** The new price; ≤ 0 clears it. */
  satsPerPhd: number;
  by: string;
  usd?: number | null;
  note?: string;
  kind?: "update" | "revert";
  revertOf?: string;
  now?: number;
  /**
   * The change must be logged or not happen at all (a visitor's edit: the log is
   * how the owner sees it and how the pace limits are kept). Off for the
   * owner's own edits, which go through even if the log is down.
   */
  mustLog?: boolean;
}

/** Change a price and log it. Resolves with the logged change. */
export async function changeManualPrice(input: PriceChangeInput): Promise<PriceChange> {
  const store = manualPriceStore();
  const now = input.now ?? Date.now();
  const sats = input.satsPerPhd > 0 ? input.satsPerPhd : 0;
  const before = await store.get(input.venue);
  await store.put({
    venue: input.venue,
    satsPerPhd: sats,
    ...(input.note ? { note: input.note } : {}),
    updatedBy: input.by,
    updatedAt: now,
  });
  const change: PriceChange = {
    id: randomUUID(),
    venue: input.venue,
    oldSats: before?.satsPerPhd ?? null,
    newSats: sats,
    usd: input.usd ?? null,
    by: input.by,
    at: now,
    kind: input.kind ?? "update",
    ...(input.revertOf ? { revertOf: input.revertOf } : {}),
  };
  try {
    await store.addChange(change);
  } catch (err) {
    if (input.mustLog) {
      // Put the old price back: an edit nobody can see in the log doesn't happen.
      await store.put(before ?? { venue: input.venue, satsPerPhd: 0, updatedAt: now }).catch(() => {});
      notify(input.venue);
      throw err;
    }
    console.error("[manual-prices] change not logged:", (err as Error).message);
  }
  notify(input.venue);
  return change;
}

/** The owner's /admin form. Logged like any other change. */
export async function setManualPrice(
  venue: string,
  satsPerPhd: number,
  updatedBy: string,
  note?: string,
): Promise<void> {
  await changeManualPrice({ venue, satsPerPhd, by: updatedBy, ...(note ? { note } : {}) });
}

/** Put back the price a logged change replaced (cleared if there was none). */
export async function revertPriceChange(id: string, by: string, now = Date.now()): Promise<PriceChange | null> {
  const target = await manualPriceStore().change(id);
  if (!target) return null;
  return changeManualPrice({
    venue: target.venue,
    satsPerPhd: target.oldSats ?? 0,
    by,
    note: `put back by the owner (undid ${target.id.slice(0, 8)})`,
    kind: "revert",
    revertOf: target.id,
    now,
  });
}

export async function getPriceChanges(q: ChangeQuery = {}): Promise<PriceChange[]> {
  return manualPriceStore().changes(q);
}

export async function getPriceEditorBans(): Promise<PriceBan[]> {
  return manualPriceStore().bans();
}

export async function isPriceEditorBanned(address: string): Promise<boolean> {
  return manualPriceStore().isBanned(address);
}

export async function banPriceEditor(address: string, by: string, now = Date.now()): Promise<void> {
  await manualPriceStore().ban({ address: addressKey(address), by, at: now });
}

export async function unbanPriceEditor(address: string): Promise<void> {
  await manualPriceStore().unban(address);
}
