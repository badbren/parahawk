import type {
  Store,
  PollSample,
  BlockFound,
  WatchSubscription,
  AddressSnapshot,
  LuckBucket,
  HitRow,
} from "./types.js";

/**
 * In-memory store used when no Supabase credentials are present (e.g. mock-mode
 * dev with zero config). Data lives for the process lifetime only. Seeded with
 * synthetic history on startup so charts render immediately.
 */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private samples: PollSample[] = [];
  private blocks: BlockFound[] = [];
  private watches: WatchSubscription[] = [];
  private snapshots: AddressSnapshot[] = [];
  private hits = new Map<string, HitRow>();
  private nextWatchId = 1;

  async insertSample(s: PollSample): Promise<void> {
    this.samples.push(s);
    // keep memory bounded (~30 days at 45s ≈ 57k rows; cap generously)
    if (this.samples.length > 80_000) this.samples.splice(0, this.samples.length - 80_000);
  }

  async insertSamples(samples: PollSample[]): Promise<void> {
    this.samples.push(...samples);
    if (this.samples.length > 80_000) this.samples.splice(0, this.samples.length - 80_000);
  }

  async getSamplesSince(sinceMs: number): Promise<PollSample[]> {
    return this.samples.filter((s) => s.ts >= sinceMs).sort((a, b) => a.ts - b.ts);
  }

  async getRecentSamples(limit: number): Promise<PollSample[]> {
    return this.samples.slice(-limit);
  }

  async recordBlockFound(b: BlockFound): Promise<void> {
    if (!this.blocks.some((x) => x.height === b.height)) this.blocks.push(b);
  }

  async getBlocksFound(limit: number): Promise<BlockFound[]> {
    return [...this.blocks].sort((a, b) => b.foundAt - a.foundAt).slice(0, limit);
  }

  async getLastSeenFoundHeight(): Promise<number | null> {
    if (this.blocks.length === 0) return null;
    return Math.max(...this.blocks.map((b) => b.height));
  }

  async addWatch(w: WatchSubscription): Promise<void> {
    const existing = this.watches.find(
      (x) => x.discordUserId === w.discordUserId && x.address === w.address,
    );
    if (existing) return;
    this.watches.push({ ...w, id: this.nextWatchId++, createdAt: Date.now() });
  }

  async removeWatch(discordUserId: string, address: string): Promise<boolean> {
    const before = this.watches.length;
    this.watches = this.watches.filter(
      (x) => !(x.discordUserId === discordUserId && x.address === address),
    );
    return this.watches.length < before;
  }

  async listWatches(): Promise<WatchSubscription[]> {
    return [...this.watches];
  }

  async updateWatchState(id: number, patch: Partial<WatchSubscription>): Promise<void> {
    const w = this.watches.find((x) => x.id === id);
    if (w) Object.assign(w, patch);
  }

  async insertAddressSnapshot(s: AddressSnapshot): Promise<void> {
    this.snapshots.push(s);
  }

  async getAddressSnapshots(address: string, limit: number): Promise<AddressSnapshot[]> {
    return this.snapshots
      .filter((s) => s.address === address)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }

  async insertHits(hits: HitRow[]): Promise<number> {
    let inserted = 0;
    for (const h of hits) {
      if (!this.hits.has(h.id)) {
        this.hits.set(h.id, h);
        inserted++;
      }
    }
    return inserted;
  }

  async getHitsSince(sinceMs: number, limit: number): Promise<HitRow[]> {
    return [...this.hits.values()]
      .filter((h) => h.ts >= sinceMs)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }

  async getHitsForAddress(address: string, limit: number): Promise<HitRow[]> {
    return [...this.hits.values()]
      .filter((h) => h.address === address)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }

  async getLatestHit(): Promise<HitRow | null> {
    let latest: HitRow | null = null;
    for (const h of this.hits.values()) if (!latest || h.ts > latest.ts) latest = h;
    return latest;
  }

  async runMaintenance(): Promise<void> {
    const cutoff = Date.now() - 30 * 86_400_000; // keep 30 days in memory
    this.samples = this.samples.filter((s) => s.ts >= cutoff);
  }

  async getLuckBuckets(): Promise<LuckBucket[]> {
    const map = new Map<string, { count: number; hrSum: number; bdSum: number; bdMax: number; dow: number; hod: number }>();
    for (const s of this.samples) {
      const d = new Date(s.ts);
      const dow = d.getUTCDay();
      const hod = d.getUTCHours();
      const key = `${dow}:${hod}`;
      let b = map.get(key);
      if (!b) {
        b = { count: 0, hrSum: 0, bdSum: 0, bdMax: 0, dow, hod };
        map.set(key, b);
      }
      b.count++;
      b.hrSum += s.poolHashrate;
      b.bdSum += s.bestDiffSinceBlock;
      b.bdMax = Math.max(b.bdMax, s.bestDiffSinceBlock);
    }
    return [...map.values()].map((b) => ({
      dayOfWeek: b.dow,
      hourOfDay: b.hod,
      samples: b.count,
      avgHashrate: b.hrSum / b.count,
      maxBestDiff: b.bdMax,
      avgBestDiff: b.bdSum / b.count,
    }));
  }
}
