import { config } from "../config.js";
import { Cached, fetchJson, fetchText } from "./cache.js";
import { mockChainTip } from "./mock.js";
import type { ChainTip, Freshness } from "./types.js";

const cache = new Cached<ChainTip>();

interface MempoolBlock {
  height: number;
  difficulty: number;
}
interface MempoolPrices {
  USD: number;
}

/**
 * Fetch bitcoin chain tip height, current difficulty, and BTC/USD price from
 * mempool.space (documented, free). Falls back to last-good cache on failure.
 */
export async function getChainTip(): Promise<ChainTip> {
  if (config.mockData) {
    const tip = mockChainTip();
    cache.set(tip);
    return tip;
  }

  const base = config.mempool.baseUrl.replace(/\/$/, "");
  try {
    const [height, blocks, prices] = await Promise.all([
      fetchText(`${base}/blocks/tip/height`).then((t) => Number.parseInt(t, 10)),
      fetchJson<MempoolBlock[]>(`${base}/v1/blocks`).catch(() => fetchJson<MempoolBlock[]>(`${base}/blocks`)),
      fetchJson<MempoolPrices>(`${base}/v1/prices`),
    ]);
    const difficulty = Array.isArray(blocks) && blocks[0] ? blocks[0].difficulty : 0;
    const tip: ChainTip = { height, difficulty, btcPriceUsd: prices.USD };
    cache.set(tip);
    return tip;
  } catch (err) {
    cache.markFailure();
    const last = cache.get();
    if (last) return last;
    throw err;
  }
}

export function chainFreshness(): Freshness {
  return cache.freshness();
}

/** Block timestamps are immutable, so cache them forever by height. */
const blockTimeCache = new Map<number, number>();

/**
 * Exact unix-ms timestamp of a bitcoin block by height, from mempool.space
 * (height → hash → block.timestamp). Used to pin pot age / round-start to the
 * real block time instead of the 10-min-per-block approximation. Returns null in
 * mock mode or on any failure (callers fall back to the approximation).
 */
export async function getBlockTimestamp(height: number): Promise<number | null> {
  if (config.mockData || !(height > 0)) return null;
  const cached = blockTimeCache.get(height);
  if (cached) return cached;
  const base = config.mempool.baseUrl.replace(/\/$/, "");
  try {
    const hash = (await fetchText(`${base}/block-height/${height}`)).trim();
    if (!hash) return null;
    const block = await fetchJson<{ timestamp?: number }>(`${base}/block/${hash}`);
    const ts = Number(block.timestamp ?? 0);
    if (!(ts > 0)) return null;
    const ms = ts * 1000;
    blockTimeCache.set(height, ms);
    return ms;
  } catch {
    return null;
  }
}
