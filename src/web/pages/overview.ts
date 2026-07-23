import { renderPage } from "../layout.js";
import { getOverview } from "../../services/overview.js";
import {
  fmtHashrate,
  fmtDiff,
  fmtUsd,
  fmtUsd0,
  fmtInt,
  fmtDuration,
  potEmoji,
  hashpriceEmoji,
  timeAgo,
} from "../format.js";

export async function renderOverview(): Promise<string> {
  const o = await getOverview();
  const pot = o.potAge;
  const potClass = pot.verdict === "fresh" ? "green" : pot.verdict === "aging" ? "amber" : "red";
  const hpClass =
    o.hashprice.verdict === "good" ? "green" : o.hashprice.verdict === "normal" ? "amber" : "red";

  const potNote =
    pot.verdict === "fresh"
      ? "fresh pot — shares now split a full reset"
      : pot.verdict === "aging"
        ? "aging — pot is filling up"
        : "stale — many wait for the reset before renting";

  const body = `
<h1>Live overview</h1>
<p class="lead">Real-time Parasite Pool vitals. Auto-refreshes every 30s.</p>

<div class="big">
  <div class="k">Pot age</div>
  <div class="v ${potClass}">${potEmoji(pot.verdict)} ${fmtDuration(pot.hours)}</div>
  <div class="dim" style="margin-top:8px">${pot.blocks} blocks since Parasite last found #${fmtInt(o.pool.lastFoundHeight)} · ${potNote}</div>
</div>

<div class="grid">
  <div class="card"><div class="k">Pool hashrate</div><div class="v">${fmtHashrate(o.pool.poolHashratePhs)}</div>
    <div class="sub">1D ${fmtHashrate(o.pool.avg1dPhs)} · 6D ${fmtHashrate(o.pool.avg6dPhs)} · 9D ${fmtHashrate(o.pool.avg9dPhs)}</div></div>

  <div class="card"><div class="k">Refinery hashprice</div><div class="v ${hpClass}">${hashpriceEmoji(o.hashprice.verdict)} ${fmtInt(o.pool.hashpriceSatsPerPhd)}</div>
    <div class="sub">sats/PHd · ${fmtUsd(o.hashprice.usdPerPhd)}/PHd · vs 50k baseline: ${o.hashprice.verdict}</div></div>

  <div class="card"><div class="k">Network difficulty</div><div class="v">${fmtDiff(o.pool.networkDifficulty)}</div>
    <div class="sub">minimum needed diff</div></div>

  <div class="card"><div class="k">BTC price</div><div class="v">${fmtUsd0(o.pool.btcPriceUsd)}</div>
    <div class="sub">chain tip #${fmtInt(o.chain.height)}</div></div>

  <div class="card"><div class="k">Highest diff since block</div><div class="v">${fmtDiff(o.pool.highestDiffSinceBlock)}</div>
    <div class="sub">${((o.pool.highestDiffSinceBlock / o.pool.networkDifficulty) * 100).toFixed(2)}% of a block</div></div>

  <div class="card"><div class="k">Users / workers</div><div class="v">${fmtInt(o.pool.users)} <span class="dim">/</span> ${fmtInt(o.pool.workers)}</div>
    <div class="sub">online now</div></div>
</div>

${
    o.latestHit
      ? `<div class="card" style="margin-top:16px;border-color:#3a1414">
           <div class="k">${o.latestHit.tier === "sub" ? "🟢" : o.latestHit.tier === "21T" ? "🏠" : "🥑"} Latest top share${o.latestHit.tier !== "sub" ? ` — ${o.latestHit.tier}+ BRAVOCADO!` : ""}</div>
           <div class="v" style="font-size:28px">${fmtDiff(o.latestHit.difficulty)} <span class="dim" style="font-size:16px">by</span> <span class="dim">${o.latestHit.address.slice(0, 12)}…${o.latestHit.address.slice(-4)}</span></div>
           <div class="sub">${new Date(o.latestHit.ts).toLocaleString("en-US")} · <a href="/board">Bravocado board →</a> · <a href="/history">all top diffs →</a></div>
         </div>`
      : ""
  }

<p class="muted-note" style="margin-top:24px">
  Finder gets 1 BTC; the remaining ~2.15 BTC splits among miners by shares since the previous block.
  <a href="/about">How payouts work →</a>
</p>
<p class="muted-note">data ${o.freshness.stale ? "stale" : "fresh"} · pool ${timeAgo(o.freshness.pool.lastSuccess)} · chain ${timeAgo(o.freshness.chain.lastSuccess)}</p>
<script>setTimeout(function(){location.reload();},30000);</script>
`;

  return renderPage({
    title: "Live overview",
    active: "overview",
    body,
    staleBanner: o.freshness.stale
      ? `Upstream data looks stale (pool last ok ${timeAgo(o.freshness.pool.lastSuccess)}). Showing last-good values.`
      : null,
  });
}
