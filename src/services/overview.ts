import { getPoolStats, poolFreshness } from "../data/parasite.js";
import { getChainTip, chainFreshness } from "../data/mempool.js";
import { computePotAge, type PotAge } from "../math/pot.js";
import { evaluateHashprice, hashpriceSatsPerPhd, type HashpriceEval } from "../math/hashprice.js";
import { getStore } from "../db/index.js";
import type { PoolStats, ChainTip, Freshness } from "../data/types.js";
import type { HitRow } from "../db/types.js";

export interface OverviewSnapshot {
  pool: PoolStats;
  chain: ChainTip;
  potAge: PotAge;
  hashprice: HashpriceEval;
  latestHit: HitRow | null;
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

  // Parasite's pool-stats endpoint doesn't carry network difficulty, BTC price,
  // or a hashprice — fill them from mempool + derive the hashprice from
  // difficulty and the block subsidy (it is the bitcoin hashprice).
  if (chain.difficulty > 0) pool.networkDifficulty = chain.difficulty;
  else if (pool.networkDifficulty <= 0) pool.networkDifficulty = 127e12;
  if (chain.btcPriceUsd > 0) pool.btcPriceUsd = chain.btcPriceUsd;
  if (pool.hashpriceSatsPerPhd <= 0) {
    pool.hashpriceSatsPerPhd = hashpriceSatsPerPhd(pool.networkDifficulty, chain.height);
  }

  const potAge = computePotAge(chain.height, pool.lastFoundHeight);
  const hashprice = evaluateHashprice(pool.hashpriceSatsPerPhd, pool.btcPriceUsd);
  const latestHit = await getStore().getLatestHit().catch(() => null);
  const pf = poolFreshness();
  const cf = chainFreshness();
  return {
    pool,
    chain,
    potAge,
    hashprice,
    latestHit,
    freshness: { pool: pf, chain: cf, stale: pf.stale || cf.stale },
    generatedAt: Date.now(),
  };
}
