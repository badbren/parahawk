import { config } from "../config.js";
import { fetchJson } from "./cache.js";
import { esc } from "../web/format.js";

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
export async function getRecentBlocks(limit = 13): Promise<RecentBlock[]> {
  if (config.mockData) return mockRecentBlocks(limit);

  try {
    const url = `${config.mempool.baseUrl}/v1/blocks`;
    const raw = await fetchJson<MempoolBlock[]>(url);
    const nowSec = Date.now() / 1000;
    const confirmed: RecentBlock[] = raw.slice(0, limit - 1).map((b) => ({
      height: b.height,
      minutesAgo: Math.round((nowSec - b.timestamp) / 60),
      pool: b.extras?.pool?.name ?? "Unknown",
    }));
    const tipHeight = confirmed[0]?.height ?? 0;
    const mining: RecentBlock = { height: tipHeight + 1, minutesAgo: 0, pool: "Parasite", mining: true };
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
    blocks.push({ height, minutesAgo, pool });
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
      return `<div class="${cls}">` +
        `<div class="mp-height">${b.height}</div>` +
        `<div class="mp-when">${esc(when)}</div>` +
        `<div class="mp-pool">${esc(b.pool)}</div>` +
        `</div>`;
    })
    .join("");

  const style = `<style>
.mp-strip{display:flex;gap:8px;overflow-x:auto;padding:8px;background:#000;
  -webkit-overflow-scrolling:touch;box-sizing:border-box;max-width:100%}
.mp-strip::-webkit-scrollbar{height:6px}
.mp-strip::-webkit-scrollbar-thumb{background:#222;border-radius:3px}
.mp-cell{flex:0 0 auto;min-width:96px;padding:8px 10px;background:#0a0a0a;
  border:1px solid #222;border-radius:6px;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.mp-cell-mining{border-color:#8fd14f}
.mp-height{font-weight:700;color:#fff;font-size:14px;line-height:1.3}
.mp-cell-mining .mp-height{color:#8fd14f}
.mp-when{color:#8a8a8a;font-size:12px;line-height:1.4}
.mp-pool{color:#8a8a8a;font-size:11px;line-height:1.4;white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis;max-width:120px}
</style>`;

  return `${style}<div class="mp-strip">${cells}</div>`;
}
