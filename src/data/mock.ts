import type {
  PoolStats,
  UserStats,
  RefineryState,
  RefineryOrder,
  ChainTip,
  OrderStatus,
  HitEvent,
  Leaderboard,
  LeaderboardEntry,
} from "./types.js";

/**
 * Deterministic mock "world" — everything is a smooth function of wall-clock
 * time so the pollers produce a live-looking time series and the block-found
 * alert actually fires on a demo cycle. No randomness, so behaviour is stable.
 */

const START_HEIGHT = 900_000;

/**
 * Pinned "today" snapshot (2026-08-05) taken straight from the parasite.space
 * dashboard, so the Pot Math card reproduces the hand math exactly:
 *   depth 1.46× · luck 68.7% · rarity 23% · 1,155 sats/G · ~63d wait.
 * A deep pot (W = 1.46·D) is also an OLD pot, so pot age comes out stale — the
 * chain height sits ~depth·expectedDays·144 blocks past the last found block,
 * keeping the "deep" and "overdue" stories consistent.
 */
const TODAY = {
  lastFoundHeight: 958_527,
  chainHeight: 971_833, // 13,306 blocks (~92d) since the last block — a deep, stale pot
  workSinceBlockT: 184, // W
  networkDiffT: 126.4, // D (dashboard rounds to "126T")
  nextDiffT: 127, // projected next retarget ("126T → 127T")
  highestDiffSinceBlockT: 63.3,
  gaugePhs: 99, // live hashrate gauge
  avg1dPhs: 111,
  avg6dPhs: 144,
  avg9dPhs: 205,
  btcPriceUsd: 64_472,
  users: 512,
  workers: 1_840,
} as const;

/** Full pot cycle length for the mock (1 hour) — a block is "found" each wrap. */
const CYCLE_MS = 60 * 60 * 1000;
/** Pot grows up to ~2 days of blocks before it resets. */
const MAX_POT_BLOCKS = 288;

function wobble(now: number, periodMs: number, phase = 0): number {
  return Math.sin((now / periodMs) * 2 * Math.PI + phase);
}

/** Bitcoin chain height advances ~1 per 10 real minutes from a fixed base. */
export function mockChainHeight(now: number): number {
  return START_HEIGHT + Math.floor(now / (10 * 60 * 1000));
}

function potBlocks(now: number): number {
  const pos = (now % CYCLE_MS) / CYCLE_MS; // 0..1
  return Math.round(pos * MAX_POT_BLOCKS);
}

export function mockLastFoundHeight(now: number): number {
  return mockChainHeight(now) - potBlocks(now);
}

export function mockBtcPrice(now: number): number {
  return Math.round(98_000 + 1_500 * wobble(now, 90 * 60 * 1000));
}

/**
 * Live pool snapshot. Pinned to the TODAY fixture (see above) so the Pot Math
 * card matches the dashboard exactly. hashpriceSatsPerPhd is left at 0 so the
 * overview service derives it from difficulty + block subsidy (the real path).
 */
export function mockPoolStats(_now: number = Date.now()): PoolStats {
  return {
    poolHashratePhs: TODAY.gaugePhs,
    avg1dPhs: TODAY.avg1dPhs,
    avg6dPhs: TODAY.avg6dPhs,
    avg9dPhs: TODAY.avg9dPhs,
    lastFoundHeight: TODAY.lastFoundHeight,
    highestDiffSinceBlock: TODAY.highestDiffSinceBlockT * 1e12,
    networkDifficulty: TODAY.networkDiffT * 1e12,
    users: TODAY.users,
    workers: TODAY.workers,
    btcPriceUsd: TODAY.btcPriceUsd,
    hashpriceSatsPerPhd: 0,
    workSinceLastBlockDiff: TODAY.workSinceBlockT * 1e12,
    // pot-math-native mirrors
    totalWorkSinceBlockT: TODAY.workSinceBlockT,
    minNeededDiffT: TODAY.networkDiffT,
    nextDiffT: TODAY.nextDiffT,
    highestDiffSinceBlockT: TODAY.highestDiffSinceBlockT,
    lastBlockFoundHeight: TODAY.lastFoundHeight,
  };
}

export function mockChainTip(_now: number = Date.now()): ChainTip {
  return {
    height: TODAY.chainHeight,
    difficulty: TODAY.networkDiffT * 1e12,
    btcPriceUsd: TODAY.btcPriceUsd,
  };
}

/** Cheap deterministic hash of a string → unsigned 32-bit int. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mockUserStats(address: string, _now: number = Date.now()): UserStats {
  const seed = hashString(address);
  const frac = (seed % 1000) / 1000; // 0..1
  const hashrate = round1(0.5 + frac * 12); // 0.5–12.5 PH/s
  // ~30–400 days of accumulated work
  const days = 30 + frac * 370;
  const PHD_TO_DIFF = 20.1e9;
  const totalWorkDiff = Math.round(hashrate * days * PHD_TO_DIFF);
  // best diff ~1.0–1.5× total work
  const bestDifficulty = Math.round(totalWorkDiff * (1.0 + frac * 0.5));

  const statuses: OrderStatus[] = ["active", "fulfilled", "expired"];
  const orders: RefineryOrder[] = Array.from({ length: 2 + (seed % 3) }, (_, i) => {
    const status = statuses[(seed + i) % statuses.length]!;
    const requestedPhd = 50 + ((seed >> (i + 1)) % 450);
    const progress =
      status === "fulfilled" ? 100 : status === "expired" ? 20 + ((seed >> i) % 60) : ((seed >> i) % 100);
    return {
      id: `ord_${(seed % 100000) + i}`,
      status,
      requestedPhd,
      hashratePhs: round1(0.5 + ((seed >> i) % 80) / 10),
      bestShare: Math.round(requestedPhd * PHD_TO_DIFF * (0.6 + ((seed >> i) % 100) / 100)),
      progressPercent: progress,
    };
  });

  return { address, hashratePhs: hashrate, bestDifficulty, totalWorkDiff, orders };
}

export function mockRefineryState(now: number = Date.now()): RefineryState {
  const pool = mockPoolStats(now);
  const orders: RefineryOrder[] = [
    { id: "ord_live_1", status: "active", requestedPhd: 300, hashratePhs: 4.2, bestShare: 3.1e12, progressPercent: 62 },
    { id: "ord_live_2", status: "active", requestedPhd: 120, hashratePhs: 1.8, bestShare: 0.9e12, progressPercent: 0 },
    { id: "ord_live_3", status: "fulfilled", requestedPhd: 500, hashratePhs: 8.0, bestShare: 11.4e12, progressPercent: 100 },
  ];
  return { hashpriceSatsPerPhd: pool.hashpriceSatsPerPhd, orders };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Mock 10T+ hits ("Bravocado" board) ──────────────────────────────────────

/** A small stable pool of fake miner addresses for the mock hit feed. */
const MOCK_ADDRESSES = [
  "bc1qhawk5x2mnf0parasite0pot0aq7f9x0wlh8kk2ug",
  "bc1qavocad0green0miner0z9x2n0yrf2493p83kkfjh",
  "bc1qpleb0share0hodl0qtzq2n0yrf2493p83kk0abcd",
  "bc1qmoonrig0sha256d0kgdygjrsqtzq2n0yrf24abcd",
  "bc1qsatoshi0lives0on0f2493p83kkfjhx0wlh0efgh",
  "bc1qdiff0chaser0node0n0yrf2493p83kkfjhx0ijkl",
  "bc1qcold0storage0miner0tzq2n0yrf2493p8300mnop",
  "bc1qhashrate0hero0rig0dygjrsqtzq2n0yrf24qrst",
  "bc1qorange0pill0plebs0rf2493p83kkfjhx0wl0uvwx",
  "bc1qhomeminer0basement0q2n0yrf2493p83kkf0yz01",
  "bc1qgreen0energy0hash0jrsqtzq2n0yrf2493p02345",
  "bc1qnode0runner0stack0zq2n0yrf2493p83kkf06789",
];

const TEN_T = 10e12;
const TWENTYONE_T = 21e12;

/**
 * Deterministic mock 10T+ hits in a time range. Real frequency is ~one per
 * 500 PHd of pool work; this mock generates a few per day so the board and the
 * chart are visibly populated for demos. The real feed (getRecentHits) replaces
 * this once a Parasite endpoint is wired.
 */
export function mockHitsInRange(sinceMs: number, untilMs: number): HitEvent[] {
  const HOUR = 3_600_000;
  const hits: HitEvent[] = [];
  const startHour = Math.floor(sinceMs / HOUR);
  const endHour = Math.floor(untilMs / HOUR);
  for (let h = startHour; h <= endHour; h++) {
    const seed = hashString(`hit:${h}`);
    // ~10% of hours produce a hit (~2.4/day)
    if (seed % 100 >= 10) continue;
    const count = seed % 100 < 2 ? 2 : 1; // occasionally a double
    for (let i = 0; i < count; i++) {
      const s = hashString(`hit:${h}:${i}`);
      const ts = h * HOUR + (s % 3600) * 1000;
      if (ts < sinceMs || ts > untilMs) continue;
      const is21 = s % 9 === 0;
      // 10T–18T normally; 21T–42T for the rarer homeminers tier
      const difficulty = is21
        ? TWENTYONE_T * (1 + (s % 100) / 50)
        : TEN_T * (1 + (s % 80) / 100);
      const addr = MOCK_ADDRESSES[s % MOCK_ADDRESSES.length]!;
      hits.push({
        id: `hit_${h}_${i}`,
        ts,
        address: addr,
        difficulty: Math.round(difficulty),
        tier: difficulty >= TWENTYONE_T ? "21T" : "10T",
        orderId: s % 3 === 0 ? `ord_${s % 9000}` : null,
        worker: `w${s % 9}`,
      });
    }
  }
  return hits.sort((a, b) => a.ts - b.ts);
}

/** A small synthetic leaderboard (difficulty + loyalty) built from mock users. */
export function mockLeaderboard(): Leaderboard {
  const mk = (n: number, big: boolean): LeaderboardEntry[] =>
    Array.from({ length: n }, (_, i) => {
      const u = mockUserStats(`bc1qmock${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`);
      return {
        rank: i + 1,
        address: `bc1q...${(1000 + i).toString(36)}`,
        bestDiff: big ? u.bestDifficulty : undefined,
        blocks: big ? undefined : 600 + i,
      };
    });
  return { difficulty: mk(15, true), loyalty: mk(15, false) };
}
