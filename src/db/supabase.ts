import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import type {
  Store,
  PollSample,
  BlockFound,
  WatchSubscription,
  AddressSnapshot,
  LuckBucket,
  HitRow,
} from "./types.js";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
function ms(iso: string): number {
  return new Date(iso).getTime();
}

/** Supabase (Postgres) store. Used when SUPABASE_URL + SERVICE_KEY are set. */
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor() {
    this.db = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false },
    });
  }

  async insertSample(s: PollSample): Promise<void> {
    await this.db.from("poll_samples").insert({
      ts: iso(s.ts),
      pool_hashrate: s.poolHashrate,
      hashprice: s.hashprice,
      users: s.users,
      workers: s.workers,
      chain_height: s.chainHeight,
      last_found_height: s.lastFoundHeight,
      best_diff_since_block: s.bestDiffSinceBlock,
      btc_price: s.btcPrice,
    });
  }

  async insertSamples(samples: PollSample[]): Promise<void> {
    if (samples.length === 0) return;
    // chunk to keep request sizes sane
    const CHUNK = 500;
    for (let i = 0; i < samples.length; i += CHUNK) {
      const rows = samples.slice(i, i + CHUNK).map((s) => ({
        ts: iso(s.ts),
        pool_hashrate: s.poolHashrate,
        hashprice: s.hashprice,
        users: s.users,
        workers: s.workers,
        chain_height: s.chainHeight,
        last_found_height: s.lastFoundHeight,
        best_diff_since_block: s.bestDiffSinceBlock,
        btc_price: s.btcPrice,
      }));
      await this.db.from("poll_samples").insert(rows);
    }
  }

  private rowToSample(r: Record<string, any>): PollSample {
    return {
      ts: ms(r.ts),
      poolHashrate: r.pool_hashrate ?? 0,
      hashprice: r.hashprice ?? 0,
      users: r.users ?? 0,
      workers: r.workers ?? 0,
      chainHeight: r.chain_height ?? 0,
      lastFoundHeight: r.last_found_height ?? 0,
      bestDiffSinceBlock: r.best_diff_since_block ?? 0,
      btcPrice: r.btc_price ?? 0,
    };
  }

  async getSamplesSince(sinceMs: number): Promise<PollSample[]> {
    const { data } = await this.db
      .from("poll_samples")
      .select("*")
      .gte("ts", iso(sinceMs))
      .order("ts", { ascending: true })
      .limit(20000);
    return (data ?? []).map((r) => this.rowToSample(r));
  }

  async getRecentSamples(limit: number): Promise<PollSample[]> {
    const { data } = await this.db
      .from("poll_samples")
      .select("*")
      .order("ts", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => this.rowToSample(r)).reverse();
  }

  async recordBlockFound(b: BlockFound): Promise<void> {
    await this.db.from("blocks_found").upsert(
      {
        height: b.height,
        found_at: iso(b.foundAt),
        cycle_duration_blocks: b.cycleDurationBlocks,
        est_cycle_phd: b.estCyclePhd,
      },
      { onConflict: "height" },
    );
  }

  async getBlocksFound(limit: number): Promise<BlockFound[]> {
    const { data } = await this.db
      .from("blocks_found")
      .select("*")
      .order("found_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => ({
      height: r.height,
      foundAt: ms(r.found_at),
      cycleDurationBlocks: r.cycle_duration_blocks ?? 0,
      estCyclePhd: r.est_cycle_phd ?? 0,
    }));
  }

  async getLastSeenFoundHeight(): Promise<number | null> {
    const { data } = await this.db
      .from("blocks_found")
      .select("height")
      .order("height", { ascending: false })
      .limit(1);
    return data && data[0] ? data[0].height : null;
  }

  async addWatch(w: WatchSubscription): Promise<void> {
    await this.db.from("watch_subscriptions").upsert(
      {
        discord_user_id: w.discordUserId,
        channel_id: w.channelId,
        address: w.address,
      },
      { onConflict: "discord_user_id,address" },
    );
  }

  async removeWatch(discordUserId: string, address: string): Promise<boolean> {
    const { data } = await this.db
      .from("watch_subscriptions")
      .delete()
      .eq("discord_user_id", discordUserId)
      .eq("address", address)
      .select();
    return (data ?? []).length > 0;
  }

  async listWatches(): Promise<WatchSubscription[]> {
    const { data } = await this.db.from("watch_subscriptions").select("*");
    return (data ?? []).map((r) => ({
      id: r.id,
      discordUserId: r.discord_user_id,
      channelId: r.channel_id,
      address: r.address,
      createdAt: r.created_at ? ms(r.created_at) : undefined,
      lastZeroAlertAt: r.last_zero_alert_at ? ms(r.last_zero_alert_at) : null,
      lastProgress: r.last_progress ?? null,
      lastOrderState: r.last_order_state ?? null,
    }));
  }

  async updateWatchState(id: number, patch: Partial<WatchSubscription>): Promise<void> {
    const row: Record<string, unknown> = {};
    if (patch.lastZeroAlertAt !== undefined)
      row.last_zero_alert_at = patch.lastZeroAlertAt ? iso(patch.lastZeroAlertAt) : null;
    if (patch.lastProgress !== undefined) row.last_progress = patch.lastProgress;
    if (patch.lastOrderState !== undefined) row.last_order_state = patch.lastOrderState;
    await this.db.from("watch_subscriptions").update(row).eq("id", id);
  }

  async insertAddressSnapshot(s: AddressSnapshot): Promise<void> {
    await this.db.from("address_snapshots").insert({
      address: s.address,
      ts: iso(s.ts),
      hashrate: s.hashrate,
      best_difficulty: s.bestDifficulty,
      total_work: s.totalWork,
    });
  }

  async getAddressSnapshots(address: string, limit: number): Promise<AddressSnapshot[]> {
    const { data } = await this.db
      .from("address_snapshots")
      .select("*")
      .eq("address", address)
      .order("ts", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => ({
      address: r.address,
      ts: ms(r.ts),
      hashrate: r.hashrate ?? 0,
      bestDifficulty: r.best_difficulty ?? 0,
      totalWork: r.total_work ?? 0,
    }));
  }

  async insertHits(hits: HitRow[]): Promise<number> {
    if (hits.length === 0) return 0;
    const { data } = await this.db
      .from("share_hits")
      .upsert(
        hits.map((h) => ({
          id: h.id,
          ts: iso(h.ts),
          address: h.address,
          difficulty: h.difficulty,
          tier: h.tier,
          order_id: h.orderId,
          worker: h.worker,
        })),
        { onConflict: "id", ignoreDuplicates: true },
      )
      .select();
    return (data ?? []).length;
  }

  private rowToHit(r: Record<string, any>): HitRow {
    return {
      id: r.id,
      ts: ms(r.ts),
      address: r.address,
      difficulty: r.difficulty ?? 0,
      tier: r.tier ?? "10T",
      orderId: r.order_id ?? null,
      worker: r.worker ?? null,
    };
  }

  async getHitsSince(sinceMs: number, limit: number): Promise<HitRow[]> {
    const { data } = await this.db
      .from("share_hits")
      .select("*")
      .gte("ts", iso(sinceMs))
      .order("ts", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => this.rowToHit(r));
  }

  async getHitsForAddress(address: string, limit: number): Promise<HitRow[]> {
    const { data } = await this.db
      .from("share_hits")
      .select("*")
      .eq("address", address)
      .order("ts", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r) => this.rowToHit(r));
  }

  async getLatestHit(): Promise<HitRow | null> {
    const { data } = await this.db
      .from("share_hits")
      .select("*")
      .order("ts", { ascending: false })
      .limit(1);
    return data && data[0] ? this.rowToHit(data[0]) : null;
  }

  async runMaintenance(): Promise<void> {
    await this.db.rpc("parahawk_rollup_and_prune");
  }

  async getLuckBuckets(): Promise<LuckBucket[]> {
    const { data } = await this.db.from("luck_buckets").select("*");
    return (data ?? []).map((r) => ({
      dayOfWeek: r.day_of_week,
      hourOfDay: r.hour_of_day,
      samples: r.samples ?? 0,
      avgHashrate: r.avg_hashrate ?? 0,
      maxBestDiff: r.max_best_diff ?? 0,
      avgBestDiff: r.avg_best_diff ?? 0,
    }));
  }
}
