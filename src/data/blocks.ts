import { config } from "../config.js";
import { fetchJson } from "./cache.js";
import { getTopDiffByBlock } from "./parasite.js";
import { esc, fmtDiff } from "../web/format.js";

/**
 * A single cell in the "recent blocks" strip shown across the top of
 * parasite.space. The leftmost cell is Parasite's own in-progress block
 * (mining:true); the rest are recently confirmed network blocks.
 */
export interface RecentBlock {
  height: number;
  /** Whole minutes since the block was mined; 0 for the in-progress block. */
  minutesAgo: number;
  /** Mining pool name, e.g. "Foundry USA"; "Parasite" for the mining block. */
  pool: string;
  /** True for the leftmost in-progress Parasite block. */
  mining?: boolean;
  /** Masked address of the Parasite miner with the top diff share on this block. */
  topDiffAddress?: string;
  /** That miner's best difficulty on this block. */
  topDiff?: number;
}

/** Pool names cycled through deterministically in mock mode. */
const MOCK_POOLS = [
  "Foundry USA",
  "AntPool",
  "F2Pool",
  "ViaBTC",
  "MARA Pool",
  "Binance Pool",
  "SpiderPool",
  "Luxor",
] as const;

/** Shape of a mempool.space `/v1/blocks` entry (only the fields we read). */
interface MempoolBlock {
  height: number;
  timestamp: number;
  extras?: { pool?: { name?: string } };
}

/**
 * Recent blocks for the top-of-page strip. Returns a synthetic in-progress
 * Parasite block followed by the most recent confirmed blocks, newest first.
 * On any upstream failure the real path returns [] (the caller renders nothing).
 */
export async function getRecentBlocks(limit = 26): Promise<RecentBlock[]> {
  if (config.mockData) return mockRecentBlocks(limit);

  try {
    // mempool.space /v1/blocks returns 15 at a time; page down for more.
    const need = limit - 1; // reserve one slot for the in-progress block
    const raw: MempoolBlock[] = [];
    let startHeight: number | null = null;
    while (raw.length < need) {
      const url: string =
        startHeight == null
          ? `${config.mempool.baseUrl}/v1/blocks`
          : `${config.mempool.baseUrl}/v1/blocks/${startHeight}`;
      const page: MempoolBlock[] = await fetchJson<MempoolBlock[]>(url);
      if (!Array.isArray(page) || page.length === 0) break;
      raw.push(...page);
      startHeight = page[page.length - 1]!.height - 1;
    }

    const [topDiff, nowSec] = [await getTopDiffByBlock(Math.max(50, need)), Date.now() / 1000];
    const confirmed: RecentBlock[] = raw.slice(0, need).map((b) => {
      const td = topDiff.get(b.height);
      return {
        height: b.height,
        minutesAgo: Math.round((nowSec - b.timestamp) / 60),
        pool: b.extras?.pool?.name ?? "Unknown",
        topDiffAddress: td?.address,
        topDiff: td?.difficulty,
      };
    });
    const tipHeight = confirmed[0]?.height ?? 0;
    const tipTop = topDiff.get(tipHeight + 1);
    const mining: RecentBlock = {
      height: tipHeight + 1,
      minutesAgo: 0,
      pool: "Parasite",
      mining: true,
      topDiffAddress: tipTop?.address,
      topDiff: tipTop?.difficulty,
    };
    return [mining, ...confirmed];
  } catch {
    return [];
  }
}

/**
 * Deterministic mock strip. Leads with the in-progress Parasite block at a
 * fixed height, then counts down through confirmed blocks that get ~10 min
 * older each step. Everything is derived from the height so output is stable
 * (no Date.now / Math.random).
 */
function mockRecentBlocks(limit: number): RecentBlock[] {
  const MINING_HEIGHT = 971_834;
  const blocks: RecentBlock[] = [
    { height: MINING_HEIGHT, minutesAgo: 0, pool: "Parasite", mining: true },
  ];
  for (let i = 1; i < limit; i++) {
    const height = MINING_HEIGHT - i;
    // ~10 min per step, with a small deterministic wobble derived from height.
    const minutesAgo = i * 10 + (height % 5) - 2;
    const pool = MOCK_POOLS[height % MOCK_POOLS.length]!;
    blocks.push({
      height,
      minutesAgo,
      pool,
      topDiffAddress: `bc1q...${(height % 46656).toString(36).padStart(3, "0")}`,
      topDiff: 1e12 * (1 + (height % 50) / 10),
    });
  }
  return blocks;
}

/**
 * Render the recent-blocks strip as a self-contained HTML string (includes a
 * scoped <style>). Horizontally scrollable so it never breaks page layout.
 * Returns "" for an empty list.
 */
export function renderBlocksStrip(blocks: RecentBlock[]): string {
  if (blocks.length === 0) return "";

  const cells = blocks
    .map((b) => {
      const when = b.mining ? "Mining..." : `${b.minutesAgo}m ago`;
      const cls = b.mining ? "mp-cell mp-cell-mining" : "mp-cell";
      // Blank pool line on the in-progress block (parasite.space leaves it empty).
      const poolLine = b.mining
        ? `<div class="mp-pool">&nbsp;</div>`
        : `<div class="mp-pool">${esc(b.pool)}</div>`;
      // Top Parasite diff share on this block (address is already masked upstream).
      const topLine = b.topDiffAddress
        ? `<div class="mp-top"><span class="mp-top-addr">${esc(b.topDiffAddress)}</span>` +
          (b.topDiff ? `<span class="mp-top-diff">${fmtDiff(b.topDiff)}</span>` : "") +
          `</div>`
        : `<div class="mp-top mp-top-empty">&nbsp;</div>`;
      return `<div class="${cls}">` +
        `<div class="mp-height">${b.height}</div>` +
        `<div class="mp-when">${esc(when)}</div>` +
        poolLine +
        topLine +
        `</div>`;
    })
    .join("");

  const style = `<style>
.mp-strip{display:flex;gap:14px;overflow-x:auto;padding:14px;background:#000;
  -webkit-overflow-scrolling:touch;box-sizing:border-box;max-width:100%}
.mp-strip::-webkit-scrollbar{height:10px}
.mp-strip::-webkit-scrollbar-thumb{background:#222;border-radius:5px}
.mp-cell{flex:0 0 auto;min-width:180px;padding:16px 18px;background:#0a0a0a;
  border:1px solid #222;border-radius:8px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.mp-cell-mining{border-color:#8fd14f}
.mp-height{font-weight:700;color:#fff;font-size:26px;line-height:1.25}
.mp-cell-mining .mp-height{color:#8fd14f}
.mp-when{color:#8a8a8a;font-size:15px;line-height:1.5}
.mp-pool{color:#cfcfcf;font-size:15px;line-height:1.5;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;max-width:200px;margin-top:2px}
.mp-top{margin-top:8px;padding-top:8px;border-top:1px solid #1a1a1a;
  display:flex;flex-direction:column;gap:1px;min-height:34px}
.mp-top-addr{color:#8fd14f;font-size:13px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;max-width:200px}
.mp-top-diff{color:#8a8a8a;font-size:12px}
.mp-top-empty{border-top-color:transparent}
</style>`;

  return `${style}<div class="mp-strip">${cells}</div>`;
}
