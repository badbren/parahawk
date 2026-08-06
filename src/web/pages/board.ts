import { renderPage } from "../layout.js";
import { getLeaderboard } from "../../data/parasite.js";
import { renderCadosBody } from "./cados.js";
import { fmtDiff, esc } from "../format.js";
import type { LeaderboardEntry } from "../../data/types.js";

const TEN_T = 10e12;
const TWENTYONE_T = 21e12;

/** A full bc1/3/1 address gets a link; masked ones don't. */
function addrCell(address: string): string {
  const masked = address.includes("...");
  const short = masked ? address : `${address.slice(0, 12)}…${address.slice(-4)}`;
  return masked ? `<span class="dim">${esc(short)}</span>` : `<a href="/address/${esc(address)}">${esc(short)}</a>`;
}

function bravoBadge(diff: number): string {
  if (diff >= TWENTYONE_T) return `<span class="amber">🏠 21T</span>`;
  return `<span class="red">🥑 10T</span>`;
}

export async function renderBoard(): Promise<string> {
  const [cados, lb] = await Promise.all([
    renderCadosBody().catch(() => ""),
    getLeaderboard(),
  ]);

  const bravocados = lb.difficulty
    .filter((e) => (e.bestDiff ?? 0) >= TEN_T)
    .sort((a, b) => (b.bestDiff ?? 0) - (a.bestDiff ?? 0));

  const bravoRows =
    bravocados.length === 0
      ? `<tr><td colspan="4" class="dim">no 10T+ miners this round yet</td></tr>`
      : bravocados
          .map(
            (e, i) => `<tr><td class="dim">${i + 1}</td><td>${addrCell(e.address)}</td><td>${fmtDiff(
              e.bestDiff ?? 0,
            )}</td><td>${bravoBadge(e.bestDiff ?? 0)}</td></tr>`,
          )
          .join("");

  const diffRows = lb.difficulty
    .slice(0, 100)
    .map(
      (e: LeaderboardEntry) =>
        `<tr><td class="dim">${e.rank}</td><td>${addrCell(e.address)}</td><td>${fmtDiff(e.bestDiff ?? 0)}</td></tr>`,
    )
    .join("");

  const body = `
<h1>Bravocados 🥑</h1>
<p class="lead">When each Bravocado dropped, and who's in the 10T+ club this round. Auto-refreshes every 45s.</p>

${cados}

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
.board2col .tscroll{max-height:600px;overflow-y:auto;border:1px solid var(--line)}
.board2col thead th{position:sticky;top:0;background:#0d0d0d;z-index:1}
.board2col .tscroll::-webkit-scrollbar{width:8px}
.board2col .tscroll::-webkit-scrollbar-thumb{background:#222;border-radius:4px}
</style>
<script>setTimeout(function(){location.reload();},45000);</script>
`;

  return renderPage({ title: "Bravocados", active: "bravocados", body });
}
