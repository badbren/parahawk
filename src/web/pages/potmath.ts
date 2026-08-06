import { renderPage } from "../layout.js";
import { getOverview } from "../../services/overview.js";
import { potMathFromOverview } from "../../services/potmath.js";
import { potMathCard } from "../potmath-card.js";
import { fmtInt, fmtDuration, timeAgo } from "../format.js";

/**
 * The Pot Math page — the four headline numbers for the current round, each
 * with a plain-English caption, plus the formulas and links to the interactive
 * calculator and the luck page. This is the home of the Pot Math feature (the
 * overview page stays focused on raw pool stats, parasite.space-style).
 */
export async function renderPotMath(): Promise<string> {
  const o = await getOverview();
  const pm = potMathFromOverview(o);

  const body = `
<h1>Pot Math</h1>
<p class="lead">The four numbers that describe the current round — depth, rarity, share price, and expected wait. Scorekeeping from live pool data, refreshed every 30s.</p>

${potMathCard(pm)}

<p class="muted-note" style="margin:-6px 0 26px">
  Play with the inputs on the <a href="/calc">calculator →</a> · see the depth in context on the <a href="/luck">luck page →</a> · look up <a href="/">live pool stats →</a>
</p>

<h2>The formulas</h2>
<table>
  <tr><th>Number</th><th>Formula</th><th>Right now</th></tr>
  <tr><td>Round depth</td><td>W / D</td><td>${pm.depth.toFixed(2)}× (${Math.round(pm.luckPct)}% luck)</td></tr>
  <tr><td>Round rarity</td><td>e<sup>−W/D</sup></td><td>${Math.round(pm.rarity * 100)}% — ~1 in ${Math.max(1, Math.round(1 / pm.rarity))} rounds</td></tr>
  <tr><td>Share price</td><td>212,500 / W<sub>(T)</sub></td><td>${fmtInt(pm.satsPerG)} sats per G <span class="dim">(subsidy only)</span></td></tr>
  <tr><td>Work / block</td><td>D · 2³² / 86400 / 10¹⁵</td><td>${fmtInt(pm.phdNeeded)} PHd</td></tr>
  <tr><td>Expected wait</td><td>PHd&nbsp;needed / H</td><td>${fmtDuration(pm.expectedDays * 24)} @ ${pm.hGauge} PH/s <span class="dim">· 1D avg ${pm.h1d} → ${fmtDuration(pm.expectedDays1d * 24)}</span></td></tr>
</table>

<p class="muted-note" style="margin-top:18px">
  <strong>W</strong> = "Total Work Since Last Block" and <strong>D</strong> = "Minimum Needed Diff" (network difficulty), both in T (trillions of difficulty units) — exactly as labelled on parasite.space. Because W and D share a unit, depth is just their ratio. W resets to 0 the moment the pool finds a block. Share price excludes transaction fees (subsidy only).
</p>
<p class="muted-note">data ${pm.stale ? "stale" : "fresh"} · pool last ok ${timeAgo(pm.lastSuccess)}</p>
<script>setTimeout(function(){location.reload();},30000);</script>
`;

  return renderPage({
    title: "Pot Math",
    active: "pot math",
    body,
    staleBanner: pm.stale ? `Upstream data looks stale (pool last ok ${timeAgo(pm.lastSuccess)}). Showing last-good values.` : null,
  });
}
