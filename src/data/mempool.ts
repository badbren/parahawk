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
