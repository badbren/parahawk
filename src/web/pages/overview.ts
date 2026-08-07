import { renderPage } from "../layout.js";
import { getOverview } from "../../services/overview.js";
import { potMathFromOverview } from "../../services/potmath.js";
import { getLeaderboard } from "../../data/parasite.js";
import { getRecentBlocks, renderBlocksStrip } from "../../data/blocks.js";
import { hashrateGauge, gaugeScaleFor } from "../gauge.js";
import { getAddressResolver, type AddressResolver } from "../../services/winners.js";
import { walletCell } from "../addr.js";
import type { LeaderboardEntry } from "../../data/types.js";
import {
  fmtHashrate,
  fmtDiff,
  fmtUsd0,
  fmtInt,
  fmtDuration,
  fmtPct,
  timeAgo,
} from "../format.js";

/** The gauge full-scale, matching parasite.space's 0–9,999 PH/s dial. */
const GAUGE_MAX = 9999;

function lbTable(rows: LeaderboardEntry[], kind: "difficulty" | "loyalty", resolve: AddressResolver): string {
  if (rows.length === 0) return `<p class="muted-note">no entries yet</p>`;
  const head = kind === "difficulty" ? "Best diff" : "Blocks";
  const body = rows
    .slice(0, 8)
    .map(
      (e) => `<tr><td class="dim">${e.rank}</td><td>${walletCell(e.address, resolve)}</td><td>${
        kind === "difficulty" ? fmtDiff(e.bestDiff ?? 0) : fmtInt(e.blocks ?? 0)
      }</td></tr>`,
    )
    .join("");
  return `<table><tr><th>#</th><th>Address</th><th>${head}</th></tr>${body}</table>`;
}

/** Small coloured delta of a trailing average vs the live gauge. */
function trendVsLive(avg: number, live: number): string {
  if (live <= 0) return "";
  const d = ((avg - live) / live) * 100;
  const cls = d >= 0 ? "green" : "red";
  const arrow = d >= 0 ? "▲" : "▼";
  return `<span class="${cls}" style="font-size:15px">${arrow} ${Math.abs(d).toFixed(1)}%</span>`;
}

export async function renderOverview(): Promise<string> {
  const [o, lb, blocks, resolve] = await Promise.all([
    getOverview(),
    getLeaderboard().catch(() => ({ difficulty: [], loyalty: [] })),
    getRecentBlocks(26).catch(() => []),
    getAddressResolver().catch(() => (() => null) as AddressResolver),
  ]);
  const pm = potMathFromOverview(o);
  const pot = o.potAge;
  const potClass = pot.verdict === "fresh" ? "green" : pot.verdict === "aging" ? "amber" : "red";
  const powerPct = (o.pool.poolHashratePhs / GAUGE_MAX) * 100;
  // Dial full-scale = 5× the reading, sticky in ±25% bands (100→500, holds
  // until <75 or >125, then re-anchors). Stateless — see gaugeScaleFor.
  const gaugeMax = gaugeScaleFor(o.pool.poolHashratePhs);
  const highestPctOfBlock = (o.pool.highestDiffSinceBlock / o.pool.networkDifficulty) * 100;

  const body = `
${renderBlocksStrip(blocks)}

<h1>Parasite Pool — live</h1>
<p class="lead">Real-time pool vitals, straight from the dashboard. Auto-refreshes every 30s. <a href="/potmath">Pot Math →</a></p>

<div class="grid statrow">
  <div class="card"><div class="k">↗ Highest diff since last block</div><div class="v">${fmtDiff(o.pool.highestDiffSinceBlock)}</div><div class="sub">${highestPctOfBlock.toFixed(2)}% of a block</div></div>
  <div class="card"><div class="k">⛏ Total work since last block</div><div class="v">${fmtDiff(o.pool.workSinceLastBlockDiff ?? 0)}</div><div class="sub">${pm.depth.toFixed(2)}× an average round</div></div>
  <div class="card"><div class="k">↗ Minimum needed diff</div><div class="v">${fmtDiff(o.pool.networkDifficulty)}</div><div class="sub">→ ${pm.nextD.toFixed(2)}T next retarget</div></div>
  <div class="card"><div class="k">⚡ Avg to find block</div><div class="v">${fmtDuration(pm.expectedDays * 24)}</div><div class="sub">at ${fmtHashrate(o.pool.poolHashratePhs)} live</div></div>
  <div class="card"><div class="k">🔖 Last block found</div><div class="v">${fmtInt(o.pool.lastFoundHeight)}</div><div class="sub ${potClass}">${pot.verdict === "fresh" ? "🟢" : pot.verdict === "aging" ? "🟡" : "🔴"} ${fmtDuration(pot.hours)} ago</div></div>
  <div class="card"><div class="k">💰 Bitcoin price</div><div class="v">${fmtUsd0(o.pool.btcPriceUsd)}</div><div class="sub">chain tip #${fmtInt(o.chain.height)}</div></div>
</div>

<div class="power">
  <div class="power-hd"><span>Parasite Power</span><span class="green">${fmtPct(powerPct, 4)}</span></div>
  <div class="power-bar"><span style="width:${Math.min(100, powerPct).toFixed(3)}%"></span></div>
</div>

<div class="grid" style="grid-template-columns:minmax(320px,1fr) minmax(320px,1.4fr); align-items:stretch">
  <div class="card" style="text-align:center">
    <div class="k" style="text-align:left">Pool hashrate</div>
    <div id="gaugebox" style="margin:6px auto 0">${hashrateGauge({ value: o.pool.poolHashratePhs, max: gaugeMax, unit: "PH/s", size: 352 })}</div>
  </div>
  <div class="card">
    <div class="k">Historic hashrate</div>
    <p class="muted-note" style="margin:10px 0 16px">Pool hashrate has ranged from a quiet baseline to rental-driven spikes over the last month.</p>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr; gap:12px">
      <div><div class="k">1D avg</div><div class="v" style="font-size:30px">${o.pool.avg1dPhs.toFixed(2)}<small class="dim" style="font-size:15px"> PH/s</small></div><div class="sub">${trendVsLive(o.pool.avg1dPhs, o.pool.poolHashratePhs)} vs live</div></div>
      <div><div class="k">6D avg</div><div class="v" style="font-size:30px">${o.pool.avg6dPhs.toFixed(2)}<small class="dim" style="font-size:15px"> PH/s</small></div><div class="sub">${trendVsLive(o.pool.avg6dPhs, o.pool.poolHashratePhs)} vs live</div></div>
      <div><div class="k">9D avg</div><div class="v" style="font-size:30px">${o.pool.avg9dPhs.toFixed(2)}<small class="dim" style="font-size:15px"> PH/s</small></div><div class="sub">${trendVsLive(o.pool.avg9dPhs, o.pool.poolHashratePhs)} vs live</div></div>
    </div>
    <p class="muted-note" style="margin-top:18px"><a href="/history">Full historic charts on the Pool page →</a></p>
  </div>
</div>

<div class="grid" style="grid-template-columns:minmax(280px,1fr) minmax(280px,1fr) minmax(280px,1fr)">
  <div class="card"><div class="k">Users / workers online</div><div class="v">${fmtInt(o.pool.users)} <span class="dim">/</span> ${fmtInt(o.pool.workers)}</div><div class="sub">miners on the pool right now</div></div>
  <div class="card"><div class="k">Refinery hashprice</div><div class="v">${fmtInt(o.pool.hashpriceSatsPerPhd)}</div><div class="sub">sats/PHd · vs 50k baseline: ${o.hashprice.verdict}</div></div>
  <div class="card"><div class="k">Network difficulty</div><div class="v">${fmtDiff(o.pool.networkDifficulty)}</div><div class="sub">retarget → ${pm.nextD.toFixed(2)}T</div></div>
</div>

<h2>Leaderboard — since last block</h2>
<div class="grid" style="grid-template-columns:minmax(300px,1fr) minmax(300px,1fr)">
  <div class="card"><div class="k">🥑 Top difficulty</div>${lbTable(lb.difficulty, "difficulty", resolve)}<p class="muted-note" style="margin:8px 0 0"><a href="/board">full Bravocado board →</a></p></div>
  <div class="card"><div class="k">🏆 Top loyalty (blocks)</div>${lbTable(lb.loyalty, "loyalty", resolve)}</div>
</div>

<p class="muted-note" style="margin-top:24px">
  Finder gets 1 BTC; the remaining ~2.15 BTC splits among miners by shares since the previous block.
  <a href="/about">How payouts work →</a>
</p>
<p class="muted-note">data ${o.freshness.stale ? "stale" : "fresh"} · pool ${timeAgo(o.freshness.pool.lastSuccess)} · chain ${timeAgo(o.freshness.chain.lastSuccess)}</p>
<script>
// Refresh the hashrate gauge on its own every 10s (no flash), and do a full
// refresh of the rest of the page every 30s.
(function(){
  function refreshGauge(){
    fetch("/overview/gauge",{cache:"no-store"})
      .then(function(r){return r.ok?r.text():null;})
      .then(function(html){ if(html){var el=document.getElementById("gaugebox"); if(el) el.innerHTML=html;} })
      .catch(function(){});
  }
  setInterval(refreshGauge, 10000);
  setTimeout(function(){location.reload();}, 30000);
})();
</script>

<style>
.statrow{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.statrow .card .v{font-size:34px}
.power{margin:22px 0 26px}
.power-hd{display:flex;justify-content:space-between;color:var(--dim);font-size:15px;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px}
.power-bar{height:14px;background:#0a0a0a;border:1px solid var(--line);position:relative;overflow:hidden}
.power-bar>span{position:absolute;left:0;top:0;bottom:0;background:repeating-linear-gradient(90deg,#8fd14f 0,#8fd14f 3px,#0a0a0a 3px,#0a0a0a 6px)}
/* A green pulse that sweeps left→right every 5s, like the pool is charging up. */
.power-bar::after{content:"";position:absolute;top:0;bottom:0;left:0;width:100%;pointer-events:none;
  background:linear-gradient(90deg,transparent 0%,rgba(143,209,79,0) 38%,rgba(143,209,79,.55) 50%,rgba(143,209,79,0) 62%,transparent 100%);
  transform:translateX(-100%);animation:powerflow 5s linear infinite}
@keyframes powerflow{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.hrgauge{max-width:100%;height:auto}
</style>
`;

  return renderPage({
    title: "Parasite Pool — live",
    active: "overview",
    body,
    staleBanner: o.freshness.stale
      ? `Upstream data looks stale (pool last ok ${timeAgo(o.freshness.pool.lastSuccess)}). Showing last-good values.`
      : null,
  });
}
