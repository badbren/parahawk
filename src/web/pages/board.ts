import { renderPage } from "../layout.js";
import { getLeaderboard } from "../../data/parasite.js";
import { renderCadosBody } from "./cados.js";
import { getCadoData } from "../../services/cados.js";
import { getCadoWinners, getAddressResolver } from "../../services/winners.js";
import { getStore } from "../../db/index.js";
import { walletCell } from "../addr.js";
import { fmtDiff, fmtInt, fmtDuration, timeAgo, esc } from "../format.js";
import type { LeaderboardEntry } from "../../data/types.js";
import type { HitRow } from "../../db/types.js";

const TEN_T = 10e12;
const TWENTYONE_T = 21e12;

function bravoBadge(diff: number): string {
  if (diff >= TWENTYONE_T) return `<span class="amber">🏠 21T</span>`;
  return `<span class="red">🥑 10T</span>`;
}

export async function renderBoard(): Promise<string> {
  const [cados, cadoData, winners, lb, storedHits, resolve] = await Promise.all([
    renderCadosBody().catch(() => ""),
    getCadoData().catch(() => null),
    getCadoWinners().catch(() => ({ winners: [], total: 0, matched: 0 })),
    getLeaderboard(),
    getStore().getHitsSince(0, 500).catch(() => [] as HitRow[]),
    getAddressResolver().catch(() => (() => null) as (m: string) => string | null),
  ]);

  const tenTHits = storedHits.filter((h) => h.difficulty >= TEN_T).sort((a, b) => b.ts - a.ts);
  // Authoritative all-time count: every 10T+ share that earned a Bravocado,
  // reconstructed from complete on-chain dispensary history.
  const cadoCount = cadoData?.count ?? 0;
  const allTimeHits = Math.max(cadoCount, winners.total, tenTHits.length);

  // ── all-time cado winners (the 10T+ club, all-time) ───────────────────────────
  const winnerRows =
    winners.winners.length === 0
      ? `<tr><td colspan="4" class="dim">winners load from the all-time difficulty board — check back in a moment</td></tr>`
      : winners.winners
          .map((w) => {
            const label = w.fullAddress
              ? `${w.fullAddress.slice(0, 10)}…${w.fullAddress.slice(-4)}`
              : w.maskedAddress;
            const cell = w.fullAddress
              ? `<a href="/address/${esc(w.fullAddress)}">${esc(label)}</a> <span class="green" style="font-size:12px">▶ stats</span>`
              : `<span class="dim">${esc(label)}</span>`;
            return `<tr><td class="dim">${w.rank}</td><td>${cell}</td><td>${fmtDiff(
              w.bestDiff,
            )}</td><td class="dim">${w.blocks ? fmtInt(w.blocks) : "—"}</td></tr>`;
          })
          .join("");
  const bravocados = lb.difficulty
    .filter((e) => (e.bestDiff ?? 0) >= TEN_T)
    .sort((a, b) => (b.bestDiff ?? 0) - (a.bestDiff ?? 0));

  const bravoRows =
    bravocados.length === 0
      ? `<tr><td colspan="4" class="dim">no 10T+ miners this round yet</td></tr>`
      : bravocados
          .map(
            (e, i) => `<tr><td class="dim">${i + 1}</td><td>${walletCell(e.address, resolve)}</td><td>${fmtDiff(
              e.bestDiff ?? 0,
            )}</td><td>${bravoBadge(e.bestDiff ?? 0)}</td></tr>`,
          )
          .join("");

  // ── cado velocity / dry-spell read ────────────────────────────────────────────
  const velocity = (() => {
    const lastTs = cadoData?.lastTs ?? null;
    const medianGapHours = cadoData?.medianGapHours ?? null;
    if (lastTs === null || medianGapHours === null) {
      return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:12px">
  <div class="card"><div class="k">Cado velocity</div><div class="v dim">—</div><div class="sub">not enough cado history yet to read a pace</div></div>
</div>`;
    }
    const currentDrySpellHours = (Date.now() - lastTs) / 3.6e6;
    const drySpellDays = currentDrySpellHours / 24;
    const medianGapDays = medianGapHours / 24;
    let verdict: string;
    let vClass: string;
    let vSub: string;
    if (currentDrySpellHours < medianGapHours * 0.5) {
      verdict = "🔥 cados dropping fast";
      vClass = "green";
      vSub = "current gap is well under the usual wait";
    } else if (currentDrySpellHours > medianGapHours * 1.5) {
      verdict = "🌵 dry spell";
      vClass = "amber";
      vSub = "current gap is running well over the usual wait";
    } else {
      verdict = "~ on pace";
      vClass = "";
      vSub = "current gap is about the usual wait";
    }
    return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:12px">
  <div class="card"><div class="k">Days since last cado</div><div class="v">${drySpellDays.toFixed(1)}</div><div class="sub">${fmtDuration(currentDrySpellHours)} since the dispensary last sent one</div></div>
  <div class="card"><div class="k">Median gap between cados</div><div class="v">${medianGapDays.toFixed(1)}d</div><div class="sub">the typical wait between drops (${fmtDuration(medianGapHours)})</div></div>
  <div class="card"><div class="k">Pace</div><div class="v ${vClass}">${verdict}</div><div class="sub">${vSub}</div></div>
</div>
<p class="muted-note">Mining is memoryless: a long dry spell doesn't make the next Bravocado any more "due", and a fast streak doesn't make one less likely. This just reads the recent pace against the historical median — nothing more.</p>`;
  })();

  // ── recent big-share feed (10T+ hits Parahawk has observed live) ───────────────
  const bigShareFeed = (() => {
    const recent = tenTHits.slice(0, 25);
    if (recent.length === 0) {
      return `<p class="muted-note">None observed live yet — the winners board above is the authoritative all-time list.</p>`;
    }
    const rows = recent
      .map(
        (h) =>
          `<tr><td class="dim">${timeAgo(h.ts)}</td><td>${walletCell(h.address, resolve)}</td><td>${fmtDiff(
            h.difficulty,
          )}</td><td>${bravoBadge(h.difficulty)}</td></tr>`,
      )
      .join("");
    return `<div class="tscroll" style="margin-top:12px"><table>
  <thead><tr><th>When</th><th>Address</th><th>Diff</th><th>Tier</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
  })();

  const diffRows = lb.difficulty
    .slice(0, 100)
    .map(
      (e: LeaderboardEntry) =>
        `<tr><td class="dim">${e.rank}</td><td>${walletCell(e.address, resolve)}</td><td>${fmtDiff(e.bestDiff ?? 0)}</td></tr>`,
    )
    .join("");

  const body = `
<h1>Bravocados 🥑</h1>
<p class="lead">When each Bravocado dropped, and who's in the 10T+ club this round. Auto-refreshes every 45s.</p>

<h2>⏱️ Cado velocity <span class="dim" style="font-size:13px">· how the current dry spell compares to the usual pace</span></h2>
${velocity}

${cados}

<h2>🏅 All-time cado winners <span class="dim" style="font-size:13px">· the 10T+ club, all-time</span></h2>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
  <div class="card"><div class="k">All-time 10T+ winners</div><div class="v">${fmtInt(allTimeHits)}</div><div class="sub">miners with a best-ever share ≥10T — every one earned a Bravocado</div></div>
  <div class="card"><div class="k">Openable wallets</div><div class="v">${fmtInt(winners.matched)}<span class="dim" style="font-size:20px"> / ${fmtInt(winners.total)}</span></div><div class="sub">matched to a full address via the rental order book — click to open their stats</div></div>
</div>
<div class="tscroll" style="margin-top:12px"><table>
  <thead><tr><th>#</th><th>Address</th><th>Best diff (all-time)</th><th>Blocks</th></tr></thead>
  <tbody>${winnerRows}</tbody>
</table></div>
<p class="muted-note">Ranked by best-ever share difficulty (from Parasite's all-time difficulty board). Parasite masks addresses, but any winner who has rented on the Refinery is matched back to their full address — those are <span class="green">clickable through to a full wallet stats page</span> (hashrate, rental history &amp; spend, hits). The rest stay masked. ${tenTHits.length ? `Parahawk has also directly observed ${fmtInt(tenTHits.length)} recent 10T+ hit${tenTHits.length === 1 ? "" : "s"} live.` : ""}</p>

<h2>📡 Recent big shares <span class="dim" style="font-size:13px">· 10T+ hits Parahawk has observed live, newest first</span></h2>
${bigShareFeed}

<h2>10T+ club &amp; top difficulties — current round</h2>
<div class="stale" style="background:#0d1408;border-color:#33501f;color:#c7f59a">
  Land a big share on Parasite and you earn a <strong>Bravocado</strong> — an
  <a href="https://ordinalmaxibiz.wiki/bravocados" target="_blank" rel="noopener">OMB companion ordinal</a>
  (1,002 on-chain avocados; the first 100 go one-at-a-time to miners who hit, in order). Browse the
  <a href="https://ordinalmaxibiz.wiki/bravocados" target="_blank" rel="noopener">Bravocados wiki</a> ·
  <a href="https://ordinalmaxibiz.wiki/explorer" target="_blank" rel="noopener">OMB explorer</a>.
</div>

<div class="board2col">
  <div class="btable">
    <h3>🥑 Bravocado Board — 10T+ club</h3>
    <div class="tscroll"><table>
      <thead><tr><th>#</th><th>Address</th><th>Best diff</th><th>Tier</th></tr></thead>
      <tbody>${bravoRows}</tbody>
    </table></div>
  </div>
  <div class="btable">
    <h3>Top difficulties — current round <span class="dim" style="font-size:12px">top 100</span></h3>
    <div class="tscroll"><table>
      <thead><tr><th>#</th><th>Address</th><th>Best diff</th></tr></thead>
      <tbody>${diffRows}</tbody>
    </table></div>
  </div>
</div>

<p class="muted-note" style="margin-top:16px">Every miner whose best difficulty this round is 10T+. 🥑 10T+ · 🏠 21T+ (homeminers). Leaderboard addresses are masked by Parasite; per-miner hit counts aren't public. Not financial advice.</p>

<style>
.board2col{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:8px}
@media(max-width:820px){.board2col{grid-template-columns:1fr}}
.board2col .btable h3{margin:0 0 8px;font-size:15px;color:#fff;text-transform:uppercase;letter-spacing:1px}
.board2col table{margin:0}
.board2col th,.board2col td{padding:6px 9px;font-size:13px}
.board2col th{font-size:11px}
.tscroll{max-height:600px;overflow-y:auto;border:1px solid var(--line)}
.tscroll table{margin:0}
.tscroll thead th{position:sticky;top:0;background:#0d0d0d;z-index:1}
.tscroll::-webkit-scrollbar{width:8px}
.tscroll::-webkit-scrollbar-thumb{background:#222;border-radius:4px}
</style>
<script>setTimeout(function(){location.reload();},45000);</script>
`;

  return renderPage({ title: "Bravocados", active: "bravocados", body });
}
