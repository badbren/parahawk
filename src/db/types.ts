export interface PollSample {
  ts: number; // unix ms
  poolHashrate: number;
  hashprice: number;
  users: number;
  workers: number;
  chainHeight: number;
  lastFoundHeight: number;
  bestDiffSinceBlock: number;
  btcPrice: number;
  /** W — total work since last block, in T. Optional: only on samples collected
   *  after the pot-math-trend feature shipped (older rows have it undefined). */
  workSinceBlockT?: number;
  /** D — minimum needed diff (network difficulty), in T. Optional (see W). */
  minNeededDiffT?: number;
}

export interface BlockFound {
  height: number;
  foundAt: number; // unix ms
  cycleDurationBlocks: number;
  estCyclePhd: number;
}

export interface WatchSubscription {
  id?: number;
  discordUserId: string;
  channelId: string;
  address: string;
  createdAt?: number;
  lastZeroAlertAt?: number | null;
  lastProgress?: number | null;
  lastOrderState?: unknown;
}

export interface AddressSnapshot {
  address: string;
  ts: number;
  hashrate: number;
  bestDifficulty: number;
  totalWork: number;
}

export interface HitRow {
  id: string;
  ts: number;
  address: string;
  difficulty: number;
  tier: string;
  orderId: string | null;
  worker: string | null;
}

export interface AccountBadges {
  address: string;
  /** badge type → count (bravocado, block_winner, block, refinery, …). */
  badges: Record<string, number>;
  updatedAt: number; // unix ms
}

export interface TrackedAddress {
  address: string;
  firstSeen: number; // unix ms
  lastSnapshotAt: number | null; // unix ms, null until first snapshotted
}

export interface LuckBucket {
  dayOfWeek: number; // 0=Sun..6=Sat
  hourOfDay: number; // 0..23
  samples: number;
  avgHashrate: number;
  maxBestDiff: number;
  avgBestDiff: number;
}

export interface Store {
  insertSample(s: PollSample): Promise<void>;
  /** Bulk insert (used by seeding); default may loop insertSample. */
  insertSamples(samples: PollSample[]): Promise<void>;
  getSamplesSince(sinceMs: number): Promise<PollSample[]>;
  getRecentSamples(limit: number): Promise<PollSample[]>;

  recordBlockFound(b: BlockFound): Promise<void>;
  getBlocksFound(limit: number): Promise<BlockFound[]>;
  getLastSeenFoundHeight(): Promise<number | null>;

  addWatch(w: WatchSubscription): Promise<void>;
  removeWatch(discordUserId: string, address: string): Promise<boolean>;
  listWatches(): Promise<WatchSubscription[]>;
  updateWatchState(id: number, patch: Partial<WatchSubscription>): Promise<void>;

  insertAddressSnapshot(s: AddressSnapshot): Promise<void>;
  getAddressSnapshots(address: string, limit: number): Promise<AddressSnapshot[]>;

  /** Insert new 10T+ hits, ignoring ids already stored. Returns count inserted. */
  insertHits(hits: HitRow[]): Promise<number>;
  getHitsSince(sinceMs: number, limit: number): Promise<HitRow[]>;
  getHitsForAddress(address: string, limit: number): Promise<HitRow[]>;
  getLatestHit(): Promise<HitRow | null>;

  getLuckBuckets(): Promise<LuckBucket[]>;

  /** Store a wallet's badge counts (indexed from account lookups). */
  upsertAccountBadges(a: AccountBadges): Promise<void>;
  /** All indexed wallets' badges, newest-updated first. */
  getAccountBadges(limit: number): Promise<AccountBadges[]>;

  /** Register an address (from a search or enumeration) for ongoing indexing. */
  trackAddress(address: string): Promise<void>;
  /** Tracked addresses due for a refresh — least-recently-snapshotted first. */
  getStaleTrackedAddresses(limit: number): Promise<TrackedAddress[]>;
  /** Mark that an address was just snapshotted (resets its staleness). */
  markAddressSnapshotted(address: string): Promise<void>;

  /** Aggregate + prune old raw samples. Safe to call periodically. */
  runMaintenance(): Promise<void>;

  readonly kind: "memory" | "supabase";
}
