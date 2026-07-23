import { config } from "../config.js";
import { Cached, fetchJson } from "../data/cache.js";

/**
 * Bravocado distribution timeline, derived on-chain from the OMB dispensary
 * wallet's outgoing transactions. Each cado is sent as a 999-sat inscription
 * transfer; we take the earliest time each external (bc1p ordinal) wallet
 * received one as that cado's award time.
 *
 * Caveat: this is the *transfer* time (when the dispensary sent the cado), which
 * tracks — but isn't identical to — the moment the miner landed the qualifying
 * share. Recipients are ordinal wallets, not the bc1q mining addresses, so we
 * can't join to Parasite per-miner stats. Small sample; read the trend.
 */

const DISPENSARY =
  process.env.CADO_DISPENSARY ?? "bc1qc3vmv3r5l9dlj8tx07yqsdgt4s2dc6f6tucad0";
/** Inscription postage used by the dispensary (sats). */
const POSTAGE_MAX = 10_000;

export interface CadoAward {
  recipient: string;
  ts: number; // unix ms
}
export interface CadoData {
  awards: CadoAward[];
  byHour: number[]; // length 24, UTC
  byDow: number[]; // length 7, Mon..Sun, UTC
  count: number;
  firstTs: number | null;
  lastTs: number | null;
  medianGapHours: number | null;
  dispensary: string;
  ok: boolean;
}

interface MempoolVout {
  scriptpubkey_address?: string;
  value?: number;
}
interface MempoolTx {
  txid: string;
  status?: { block_time?: number };
  vin?: Array<{ prevout?: { scriptpubkey_address?: string } }>;
  vout?: MempoolVout[];
}

const cache = new Cached<CadoData>(30 * 60 * 1000);

function mempoolBase(): string {
  return config.mempool.baseUrl.replace(/\/$/, "");
}

/** Paginate all confirmed txs for the dispensary address (bounded). */
async function fetchAllTxs(): Promise<MempoolTx[]> {
  const base = mempoolBase();
  const all: MempoolTx[] = [];
  let last: string | null = null;
  for (let page = 0; page < 12; page++) {
    const url: string = `${base}/address/${DISPENSARY}/txs/chain${last ? `/${last}` : ""}`;
    const batch: MempoolTx[] = await fetchJson<MempoolTx[]>(url).catch(() => [] as MempoolTx[]);
    if (batch.length === 0) break;
    all.push(...batch);
    last = batch[batch.length - 1]!.txid;
    if (batch.length < 25) break;
  }
  return all;
}

export async function getCadoData(): Promise<CadoData> {
  const cached = cache.get();
  if (cached && !cache.freshness().stale) return cached;

  try {
    const txs = await fetchAllTxs();
    const earliest = new Map<string, number>(); // recipient → earliest block_time (sec)
    for (const t of txs) {
      const fromDisp = (t.vin ?? []).some(
        (v) => v.prevout?.scriptpubkey_address === DISPENSARY,
      );
      if (!fromDisp) continue;
      const bt = t.status?.block_time;
      if (!bt) continue;
      for (const v of t.vout ?? []) {
        const a = v.scriptpubkey_address;
        if (a && a !== DISPENSARY && (v.value ?? 1e9) <= POSTAGE_MAX) {
          const prev = earliest.get(a);
          if (prev === undefined || bt < prev) earliest.set(a, bt);
        }
      }
    }

    const awards: CadoAward[] = [...earliest.entries()]
      .map(([recipient, sec]) => ({ recipient, ts: sec * 1000 }))
      .sort((x, y) => x.ts - y.ts);

    const byHour = Array(24).fill(0) as number[];
    const byDow = Array(7).fill(0) as number[];
    for (const a of awards) {
      const d = new Date(a.ts);
      byHour[d.getUTCHours()]!++;
      byDow[(d.getUTCDay() + 6) % 7]!++; // Mon=0..Sun=6
    }
    const gaps = awards.slice(1).map((a, i) => (a.ts - awards[i]!.ts) / 3_600_000).sort((p, q) => p - q);
    const medianGapHours = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : null;

    const data: CadoData = {
      awards,
      byHour,
      byDow,
      count: awards.length,
      firstTs: awards[0]?.ts ?? null,
      lastTs: awards[awards.length - 1]?.ts ?? null,
      medianGapHours,
      dispensary: DISPENSARY,
      ok: true,
    };
    cache.set(data);
    return data;
  } catch {
    cache.markFailure();
    return (
      cache.get() ?? {
        awards: [],
        byHour: Array(24).fill(0),
        byDow: Array(7).fill(0),
        count: 0,
        firstTs: null,
        lastTs: null,
        medianGapHours: null,
        dispensary: DISPENSARY,
        ok: false,
      }
    );
  }
}
