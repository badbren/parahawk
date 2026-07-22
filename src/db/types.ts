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

  getLuckBuckets(): Promise<LuckBucket[]>;

  /** Aggregate + prune old raw samples. Safe to call periodically. */
  runMaintenance(): Promise<void>;

  readonly kind: "memory" | "supabase";
}
