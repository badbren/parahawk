import { getPoolStats, poolFreshness } from "../data/parasite.js";
import { getChainTip, chainFreshness } from "../data/mempool.js";
import { computePotAge, type PotAge } from "../math/pot.js";
import { evaluateHashprice, type HashpriceEval } from "../math/hashprice.js";
import type { PoolStats, ChainTip, Freshness } from "../data/types.js";

export interface OverviewSnapshot {
  pool: PoolStats;
  chain: ChainTip;
  potAge: PotAge;
  hashprice: HashpriceEval;
  freshness: { pool: Freshness; chain: Freshness; stale: boolean };
  generatedAt: number;
}

/**
 * Assemble the live overview used by both the website and the Discord bot.
 * Pot age uses the bitcoin chain tip from mempool and Parasite's last-found
 * height. Degrades gracefully: data-source layers return last-good cache and we
 * surface a combined stale flag.
 */
export async function getOverview(): Promise<OverviewSnapshot> {
  const [pool, chain] = await Promise.all([getPoolStats(), getChainTip()]);
  const potAge = computePotAge(chain.height, pool.lastFoundHeight);
  const hashprice = evaluateHashprice(pool.hashpriceSatsPerPhd, pool.btcPriceUsd);
  const pf = poolFreshness();
  const cf = chainFreshness();
  return {
    pool,
    chain,
    potAge,
    hashprice,
    freshness: { pool: pf, chain: cf, stale: pf.stale || cf.stale },
    generatedAt: Date.now(),
  };
}
