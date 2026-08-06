import { renderPage } from "../layout.js";
import { getLeaderboard } from "../../data/parasite.js";
import { fmtDiff, fmtInt, esc } from "../format.js";
import type { LeaderboardEntry } from "../../data/types.js";

const TEN_T = 10e12;
const TWENTYONE_T = 21e12;

/** A full bc1/3/1 address (Refinery) gets a link; masked ones don't. */
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
  const lb = await getLeaderboard();

  const bravocados = lb.difficulty
    .filter((e) => (e.bestDiff ?? 0) >= TEN_T)
    .sort((a, b) => (b.bestDiff ?? 0) - (a.bestDiff ?? 0));

  const bravoRows =
    bravocados.length === 0
      ? `<tr><td colspan="4" class="dim">no 10T+ miners in the current round yet</td></tr>`
      : bravocados
          .map(
            (e, i) => `<tr>
              <td class="dim">${i + 1}</td>
              <td>${addrCell(e.address)}</td>
              <td>${fmtDiff(e.bestDiff ?? 0)}</td>
              <td>${bravoBadge(e.bestDiff ?? 0)}</td>
            </tr>`,
          )
          .join("");

  const diffRows = lb.difficulty
    .slice(0, 25)
    .map(
      (e: LeaderboardEntry) => `<tr>
        <td class="dim">${e.rank}</td>
        <td>${addrCell(e.address)}</td>
        <td>${fmtDiff(e.bestDiff ?? 0)}</td>
      </tr>`,
    )
    .join("");

  const loyaltyRows = lb.loyalty
    .slice(0, 25)
    .map(
      (e) => `<tr>
        <td class="dim">${e.rank}</td>
        <td>${addrCell(e.address)}</td>
        <td>${fmtInt(e.blocks ?? 0)}</td>
      </tr>`,
    )
    .join("");

  const body = `
<h1>Miners &amp; Bravocados 🥑</h1>
<p class="lead">Live from Parasite's leaderboards. Auto-refreshes every 45s.</p>

<h2>🥑 Bravocado board — 10T+ club</h2>
<div class="stale" style="background:#0d1408;border-color:#33501f;color:#c7f59a">
  Land a big share on Parasite and you earn a <strong>Bravocado</strong> — an
  <a href="https://ordinalmaxibiz.wiki/bravocados" target="_blank" rel="noopener">OMB companion ordinal</a>
  (1,002 on-chain avocados; the first 100 go one-at-a-time to miners who hit, in order, from the dispensary wallet).
  Browse the collection on the <a href="https://ordinalmaxibiz.wiki/bravocados" target="_blank" rel="noopener">Bravocados wiki</a>
  and the <a href="https://ordinalmaxibiz.wiki/explorer" target="_blank" rel="noopener">OMB explorer</a>.
</div>
<p class="muted-note">Every miner whose best difficulty this round is 10T or higher. 🥑 10T+ · 🏠 21T+ (homeminers). Best-diff per miner is what Parasite exposes; per-miner hit counts aren't public (the share feed is anonymised).</p>
<table>
  <tr><th>#</th><th>Address</th><th>Best difficulty</th><th>Tier</th></tr>
  ${bravoRows}
</table>

<h2>Top difficulties (current round)</h2>
<table>
  <tr><th>#</th><th>Address</th><th>Best diff</th></tr>
  ${diffRows}
</table>

<h2>Top loyalty (blocks participated)</h2>
<table>
  <tr><th>#</th><th>Address</th><th>Blocks</th></tr>
  ${loyaltyRows}
</table>

<p class="muted-note">Leaderboard addresses are masked by Parasite. Not financial advice.</p>
<script>setTimeout(function(){location.reload();},45000);</script>
`;

  return renderPage({ title: "Miners & Bravocados", active: "bravocados", body });
}
