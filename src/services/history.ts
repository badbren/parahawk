import { getStore } from "../db/index.js";
import { MINUTES_PER_BLOCK } from "../math/constants.js";
import type { HitRow } from "../db/types.js";

export interface Point {
  t: number; // unix ms
  v: number;
}
export interface PotLength {
  height: number;
  foundAt: number;
  durationBlocks: number;
  durationHours: number;
  estPhd: number;
}
export interface HistoryData {
  hashrate: Point[];
  hashprice: Point[];
  users: Point[];
  potLengths: PotLength[];
  blockMarkers: number[]; // ms timestamps
  hits: HitRow[];
  sampleCount: number;
  rangeDays: number;
}

/** Even downsample to at most `max` points, always keeping the last one. */
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]!);
  const last = arr[arr.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export async function getHistory(rangeDays = 7): Promise<HistoryData> {
  const store = getStore();
  const since = Date.now() - rangeDays * 86_400_000;
  const samples = await store.getSamplesSince(since);
  const blocks = await store.getBlocksFound(100);
  const hits = await store.getHitsSince(since, 500);

  const ds = downsample(samples, 600);
  return {
    hashrate: ds.map((s) => ({ t: s.ts, v: s.poolHashrate })),
    hashprice: ds.map((s) => ({ t: s.ts, v: s.hashprice })),
    users: ds.map((s) => ({ t: s.ts, v: s.users })),
    potLengths: blocks
      .slice()
      .sort((a, b) => a.foundAt - b.foundAt)
      .map((b) => ({
        height: b.height,
        foundAt: b.foundAt,
        durationBlocks: b.cycleDurationBlocks,
        durationHours: (b.cycleDurationBlocks * MINUTES_PER_BLOCK) / 60,
        estPhd: b.estCyclePhd,
      })),
    blockMarkers: blocks.map((b) => b.foundAt),
    hits,
    sampleCount: samples.length,
    rangeDays,
  };
}
