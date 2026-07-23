import type {
  PoolStats,
  UserStats,
  RefineryState,
  RefineryOrder,
  ChainTip,
  OrderStatus,
  HitEvent,
} from "./types.js";

/**
 * Deterministic mock "world" — everything is a smooth function of wall-clock
 * time so the pollers produce a live-looking time series and the block-found
 * alert actually fires on a demo cycle. No randomness, so behaviour is stable.
 */

const START_HEIGHT = 900_000;
const NETWORK_DIFFICULTY = 127e12;

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

export function mockPoolStats(now: number = Date.now()): PoolStats {
  const base = 85;
  const hashrate = base + 15 * wobble(now, 20 * 60 * 1000) + 4 * wobble(now, 7 * 60 * 1000, 1.3);
  const pb = potBlocks(now);
  return {
    poolHashratePhs: round1(hashrate),
    avg1dPhs: round1(base + 12 * wobble(now, 60 * 60 * 1000)),
    avg6dPhs: round1(base + 6 * wobble(now, 6 * 60 * 60 * 1000)),
    avg9dPhs: round1(base + 4 * wobble(now, 9 * 60 * 60 * 1000)),
    lastFoundHeight: mockLastFoundHeight(now),
    // best diff since block climbs with pot age, plus a little wobble
    highestDiffSinceBlock: Math.round(
      (pb / MAX_POT_BLOCKS) * 90e12 + 8e12 * (0.5 + 0.5 * wobble(now, 11 * 60 * 1000)),
    ),
    networkDifficulty: NETWORK_DIFFICULTY,
    users: Math.round(420 + 30 * wobble(now, 45 * 60 * 1000)),
    workers: Math.round(1300 + 90 * wobble(now, 45 * 60 * 1000)),
    btcPriceUsd: mockBtcPrice(now),
    hashpriceSatsPerPhd: Math.round(52_000 + 4_000 * wobble(now, 37 * 60 * 1000)),
  };
}

export function mockChainTip(now: number = Date.now()): ChainTip {
  return {
    height: mockChainHeight(now),
    difficulty: NETWORK_DIFFICULTY,
    btcPriceUsd: mockBtcPrice(now),
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
