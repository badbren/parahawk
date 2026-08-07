import { Cached } from "../data/cache.js";

/**
 * Bravocado ordinal floor price, for "your cados are worth ~X BTC" context.
 * Source: Satflow's collection page server-renders the floor as embedded JSON
 * (`"floorPrice":0.065`, plus 6H/1D/7D change), so a plain server-side fetch +
 * regex is enough — no API key, and because it's fetched by Parahawk's server
 * (not the browser) the page CSP doesn't apply. Magic Eden dropped bitcoin and
 * ord.net renders client-side (no floor in its HTML), so Satflow is the pick.
 * Cached ~30 min; returns null (not a throw) when unavailable.
 */

export interface BravocadoFloor {
  /** floor price in BTC. */
  floorBtc: number;
  /** 7-day floor change %, if present. */
  change7dPct: number | null;
  source: string;
}

const SATFLOW_URL = "https://www.satflow.com/ordinals/bitcoin-bravocados";
const cache = new Cached<BravocadoFloor>(30 * 60 * 1000);

function num(html: string, key: string): number | null {
  // The RSC payload escapes quotes, so match: key \" : 0.065  (backslash/quote optional).
  const m = html.match(new RegExp(`${key}[\\\\"]*\\s*:\\s*(-?[0-9.]+)`, "i"));
  return m ? Number(m[1]) : null;
}

export async function getBravocadoFloor(): Promise<BravocadoFloor | null> {
  const cached = cache.get();
  if (cached && !cache.freshness().stale) return cached;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(SATFLOW_URL, {
      headers: { "user-agent": "Mozilla/5.0 (Parahawk)", accept: "text/html" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const html = await res.text();
    const floorBtc = num(html, "floorPrice");
    if (floorBtc === null || !(floorBtc > 0)) throw new Error("floor not found");
    const data: BravocadoFloor = {
      floorBtc,
      change7dPct: num(html, "floor7DChangePercent"),
      source: "Satflow",
    };
    cache.set(data);
    return data;
  } catch {
    return cache.get() ?? null;
  }
}
