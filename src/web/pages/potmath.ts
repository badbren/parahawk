import { renderPage } from "../layout.js";
import { getOverview } from "../../services/overview.js";
import { potMathFromOverview, getPotMathTrend } from "../../services/potmath.js";
import { potMathCard } from "../potmath-card.js";
import { getLuckAudit, type LuckCell } from "../../services/luck.js";
import { fmtInt, fmtPhd, fmtDuration, timeAgo, jsonForScript } from "../format.js";
import {
  RATE_10T_PHD,
  RATE_21T_PHD,
  RATE_BLOCK_PHD,
  PLEB_SHARE_EXPECTED_RETURN,
  PHD_TO_DIFF,
} from "../../math/constants.js";
import {
  hashValuePerPhd,
  breakEvenVerdict,
  blockProbWithin,
  BLOCK_SUBSIDY_SATS,
} from "../../math/renting.js";

/**
 * Pot Math — the single home for round scorekeeping AND the what-if tools.
 * Structure: (1) the live headline card (auto), (2) a "where this pot sits"
 * percentile bar driven by the LIVE depth, (3) the calculator, always open (no
 * dropdown, owner 2026-11-09): your cut of this pot from ONE input, your work
 * this round, with the pool's numbers pulled in live and shown greyed out, plus
 * the rental-strategy/odds tool, and (4) the luck audit heatmap. The old /luck
 * and /calc pages are folded in here.
 */

/** Depth (= −ln p) at which an average round has rarity p, for the percentile bar. */
const PBAR_MAX_DEPTH = 3.5;
const PBAR_MARKERS: Array<[number, string]> = [
  [0.6931, "50%"],
  [1.4697, "23%"],
  [2.3026, "10%"],
  [2.9957, "5%"],
];

const RATE_10T_LABEL = `${RATE_10T_PHD} PHd`;
/** Marks the calculator's greyed-out fields as the pool's live numbers. */
const LIVE_TAG = `<span class="live"><i></i>LIVE</span>`;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Map a ratio (~1.0 = expected) to a heatmap colour. */
function cellColor(c: LuckCell | undefined): string {
  if (!c) return "#0a0a0a";
  if (c.lowConfidence) return "#141414";
  const r = c.ratio;
  if (r >= 1.5) return "#8fd14f";
  if (r >= 1.2) return "#5f8f34";
  if (r >= 0.8) return "#33501f";
  if (r >= 0.5) return "#1e3013";
  return "#141a10";
}

export async function renderPotMath(): Promise<string> {
  const [o, audit] = await Promise.all([getOverview(), getLuckAudit().catch(() => null)]);
  const pm = potMathFromOverview(o);
  const trend = await getPotMathTrend(pm).catch(() => null);
  const hashprice = o.pool.hashpriceSatsPerPhd ?? 50_000;
  const btc = o.pool.btcPriceUsd ?? 0;

  // ── (new) renting break-even: raw hashvalue vs the live Refinery price ──────
  const breakEvenSats = hashValuePerPhd(pm.D, BLOCK_SUBSIDY_SATS);
  const be = breakEvenVerdict(hashprice, breakEvenSats);
  const beStyle = {
    cheap: {
      border: "#33501f",
      bg: "#0d1408",
      cls: "green",
      emoji: "🟢",
      text: "renting is +EV — you pay less than the work is worth",
    },
    parity: {
      border: "#5c4a1a",
      bg: "#2a1a00",
      cls: "amber",
      emoji: "🟡",
      text: "near parity — roughly fair value",
    },
    expensive: {
      border: "#5c2b2b",
      bg: "#1a0d0d",
      cls: "red",
      emoji: "🔴",
      text: "overpaying — you pay more than the work is worth",
    },
  }[be.verdict];
  const beRatioPct = Number.isFinite(be.ratio) ? Math.round(be.ratio * 100) : 0;

  // ── (new) P(≥1 block within t) at the live expected wait ────────────────────
  const probWindows: Array<[string, number]> = [
    ["1 hour", 1 / 24],
    ["6 hours", 6 / 24],
    ["24 hours", 1],
    ["3 days", 3],
    ["7 days", 7],
  ];
  const probCards = probWindows
    .map(([label, days]) => {
      const p = blockProbWithin(days, pm.expectedDays) * 100;
      const shown =
        p >= 99.99 ? "≈100%" : p < 0.01 ? "<0.01%" : `${p.toFixed(p < 1 ? 2 : 1)}%`;
      return `<div class="card"><div class="k">Within ${label}</div><div class="v">${shown}</div><div class="sub">P(≥1 block)</div></div>`;
    })
    .join("");

  // The calculator's live (greyed-out) fields, as first painted; the page's
  // script repaints them from the card's data-* every time the card refreshes.
  const blk = pm.lastBlockFoundHeight > 0 ? ` (#${fmtInt(pm.lastBlockFoundHeight)})` : "";

  // Live percentile-bar marker for "where this pot sits".
  const livePos = Math.max(0, Math.min(100, (pm.depth / PBAR_MAX_DEPTH) * 100)).toFixed(1);
  const markerSpans = PBAR_MARKERS.map(
    ([d, label]) =>
      `<span class="pmk" style="left:${((d / PBAR_MAX_DEPTH) * 100).toFixed(1)}%"><i></i><b>${label}</b></span>`,
  ).join("");

  const consts = jsonForScript({
    RATE_10T_PHD,
    RATE_21T_PHD,
    RATE_BLOCK_PHD,
    PLEB: PLEB_SHARE_EXPECTED_RETURN,
    PHD_TO_DIFF,
    HASHPRICE: hashprice,
    BTC: btc,
  });

  // ── luck audit heatmap (the unique part of the old /luck page) ────────────────
  let luckAudit = "";
  if (audit) {
    const map = new Map<string, LuckCell>();
    for (const c of audit.cells) map.set(`${c.dayOfWeek}:${c.hourOfDay}`, c);
    const headerCells = Array.from({ length: 24 }, (_, h) => `<th>${h}</th>`).join("");
    const rows = DAYS.map((label, dow) => {
      const tds = Array.from({ length: 24 }, (_, h) => {
        const c = map.get(`${dow}:${h}`);
        const title = c
          ? `${label} ${h}:00 — ${c.samples} samples, ${(c.ratio * 100).toFixed(0)}% of mean${c.lowConfidence ? " (low confidence)" : ""}`
          : `${label} ${h}:00 — no data`;
        return `<td class="cell" style="background:${cellColor(c)}" title="${title}"></td>`;
      }).join("");
      return `<tr><th class="day">${label}</th>${tds}</tr>`;
    }).join("");
    const smallSample = audit.totalSamples < 200;
    luckAudit = `
<h2>The luck audit 🔬</h2>
<div class="stale" style="background:#0d1408;border-color:#33501f;color:#c7f59a">
  <strong>The claim to beat:</strong> one 10T+ share is expected per <strong>~${RATE_10T_LABEL}</strong> of pool work, everywhere, at every hour.
  If any hour-of-day / day-of-week bucket <em>sustainedly</em> beats that, there's a method — and it'll glow below. Expectation is a flat, boring ~100%.
</div>

<h3>Share quality by hour × weekday (UTC)</h3>
<div style="overflow-x:auto">
<table class="heat">
  <tr><th></th>${headerCells}</tr>
  ${rows}
</table>
</div>
<p class="muted-note" style="margin-top:8px">
  Colour = average best-difficulty-per-hashrate in that bucket, relative to the global mean.
  <span style="display:inline-block;width:12px;height:12px;background:#1e3013;vertical-align:middle"></span> below ·
  <span style="display:inline-block;width:12px;height:12px;background:#33501f;vertical-align:middle"></span> ~expected ·
  <span style="display:inline-block;width:12px;height:12px;background:#8fd14f;vertical-align:middle"></span> above (a signal) ·
  <span style="display:inline-block;width:12px;height:12px;background:#141414;vertical-align:middle"></span> low sample.
</p>

<h3>Totals</h3>
<div class="grid">
  <div class="card"><div class="k">Samples analysed</div><div class="v">${fmtInt(audit.totalSamples)}</div></div>
  <div class="card"><div class="k">Pool work observed</div><div class="v">${fmtPhd(audit.totalPhd)}</div></div>
  <div class="card"><div class="k">Expected 10T hits</div><div class="v">${audit.expected10t.toFixed(1)}</div><div class="sub">at 1-in-500 PHd</div></div>
</div>
<p class="muted-note" style="margin-top:18px">
  ${smallSample
      ? `⚠ <strong>Small sample so far.</strong> Buckets with fewer than ${audit.minSamplesForConfidence} samples are greyed out and every reading is noisy until Parahawk has collected weeks of data. Come back — this gets sharper over time.`
      : `Sample is getting meaningful. A truly flat map is the honest, expected result; a persistent bright cell would be the interesting one.`}
</p>
<p class="muted-note">
  Method &amp; caveats: best-diff-since-block is cumulative within a pot cycle, so this is a proxy, not a per-share hit count. It surfaces a <em>sustained</em> hour/day bias if one exists, not its absence. Judge the trend, not a single cell. Not financial advice.
</p>`;
  }

  const body = `
<h1>Calculator</h1>
<p class="lead">The four numbers that describe the current round — depth, rarity, share price, and expected wait — from live pool data, plus a calculator for your cut. Scorekeeping, never a forecast.</p>

<div id="pmcard">${potMathCard(pm, trend)}</div>

<p class="muted-note" style="margin:-6px 0 26px">
  What's your cut? Put your work this round into the <a href="#calc">calculator below ↓</a> · look up <a href="/">live pool stats →</a>
</p>

<h2>Where this pot sits 📏</h2>
<p class="muted-note">Round depth = W / D = <strong>${pm.depth.toFixed(2)}×</strong>. Rarity = e<sup>−W/D</sup> = <strong>${Math.round(pm.rarity * 100)}%</strong> — the share of average rounds that run at least this deep. The marker is this pot right now.</p>
<div class="pbar">
  <div class="pbar-fill" style="width:${livePos}%"></div>
  ${markerSpans}
  <span class="pbar-here" style="left:${livePos}%"><b>${pm.depth.toFixed(2)}×</b><i>▼</i></span>
</div>
<p class="muted-note" style="margin-top:6px">← shallower (found quick) &nbsp;·&nbsp; deeper (overdue) → &nbsp; markers show the depth at which only 50 / 23 / 10 / 5% of rounds run this long.</p>

<div class="stale" style="background:#1a0d0d;border-color:#5c2b2b;color:#ffbcbc;margin-top:18px">
  <strong>These numbers are SCOREKEEPING, not forecasting.</strong> Mining is memoryless: the pot being deep does <em>not</em> make the next block more likely. Anyone saying "we're due" is describing the past, not the future.
</div>

<section class="calcwrap" id="calc">
<h2 class="calchead">🧮 Calculator — run your own numbers</h2>
<div class="calcbody">

<h3 style="margin-top:8px">Your cut of this pot</h3>
<p class="muted-note">Type in <strong>your work this round</strong> (the number on your parasite.space dashboard) and that's it. The greyed-out numbers are the pool's live figures for this round, filled in for you — last checked <span id="pm_age">just now</span>.</p>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">
  <div class="card mine"><div class="k green">Your work this round (T)</div><input type="text" inputmode="decimal" id="pm_g" placeholder="e.g. 5.24" autocomplete="off" spellcheck="false" aria-label="Your work this round, in T"/><div class="sub">this round only · 850G or 1.2P work too</div></div>
  <div class="card livec"><div class="k">Pool's work this round</div><input type="text" id="pm_w" value="${pm.W.toFixed(2)} T" readonly tabindex="-1" aria-label="Pool's work this round (live)"/><div class="sub">${LIVE_TAG} · since the pool's last block<span id="pm_blk">${blk}</span> — back to 0 at the next one</div></div>
  <div class="card livec"><div class="k">Network difficulty</div><input type="text" id="pm_d" value="${pm.D.toFixed(2)} T" readonly tabindex="-1" aria-label="Network difficulty (live)"/><div class="sub">${LIVE_TAG} · D, the minimum needed diff</div></div>
  <div class="card livec"><div class="k">Pool hashrate</div><input type="text" id="pm_h" value="${pm.hGauge.toFixed(2)} PH/s" readonly tabindex="-1" aria-label="Pool hashrate (live)"/><div class="sub">${LIVE_TAG} · H, right now</div></div>
</div>
<div class="card mine" style="margin-top:14px"><div class="k green">💰 Your stake in this pot</div><div class="v green"><span id="pm_stake">–</span> <span class="pm-alt" id="pm_stake_alt"></span></div><div class="sub" id="pm_stake_c">enter your work this round to see your cut</div></div>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));margin-top:14px">
  <div class="card livec"><div class="k">Share price</div><div class="v" id="pm_sats">${pm.W > 0 ? `${fmtInt(pm.satsPerG)} sats/G` : "–"}</div><div class="sub">${LIVE_TAG} · 212,500 ÷ W · subsidy only</div></div>
  <div class="card livec"><div class="k">Round depth</div><div class="v" id="pm_depth">${pm.D > 0 ? `${pm.depth.toFixed(2)}×` : "–"}</div><div class="sub">${LIVE_TAG} · W ÷ D</div></div>
  <div class="card livec"><div class="k">Round rarity</div><div class="v" id="pm_rarity">${pm.D > 0 ? `${Math.round(pm.rarity * 100)}%` : "–"}</div><div class="sub">${LIVE_TAG} · P(round ≥ W) = e^(−W/D)</div></div>
  <div class="card livec"><div class="k">Expected wait</div><div class="v" id="pm_wait">${Number.isFinite(pm.expectedDays) && pm.expectedDays > 0 ? fmtDuration(pm.expectedDays * 24) : "—"}</div><div class="sub">${LIVE_TAG} · at the pool's hashrate</div></div>
</div>

<h3>Rental strategy &amp; odds</h3>
<p class="muted-note" style="margin-bottom:20px">How much hash, for how long, at what cost — and what are your real odds? Live hashprice: <span class="green">${Math.round(hashprice).toLocaleString("en-US")} sats/PHd</span>.</p>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
  <div class="card"><div class="k">Hashrate (PH/s)</div><input type="number" id="hr" value="11" min="0" step="0.1"/></div>
  <div class="card"><div class="k">Duration (hours)</div><input type="number" id="hours" value="48" min="0" step="1"/></div>
  <div class="card"><div class="k">…or budget (sats)</div><input type="number" id="budget" placeholder="spend → PHd" min="0" step="1000"/></div>
  <div class="card"><div class="k">…or work directly (PHd)</div><input type="number" id="phd" placeholder="set PHd" min="0" step="1"/></div>
</div>
<div id="lockin" class="stale" style="margin-top:16px"></div>
<h3>What you get</h3>
<div class="grid">
  <div class="card"><div class="k">Work</div><div class="v" id="r_phd">–</div><div class="sub">PHd of shares</div></div>
  <div class="card"><div class="k">Cost @ live hashprice</div><div class="v" id="r_cost">–</div><div class="sub" id="r_cost_usd">sats</div></div>
  <div class="card"><div class="k">🥑 10T share (Bravocado)</div><div class="v green" id="r_10t">–</div><div class="sub">P(≥1) · 1 per ${RATE_10T_PHD} PHd</div></div>
  <div class="card"><div class="k">🏠 21T share (homeminers)</div><div class="v amber" id="r_21t">–</div><div class="sub">P(≥1) · 1 per ${RATE_21T_PHD} PHd</div></div>
  <div class="card"><div class="k">🎰 Block</div><div class="v red" id="r_block">–</div><div class="sub">P(≥1) · 1 per ${RATE_BLOCK_PHD} PHd @127T</div></div>
  <div class="card"><div class="k">Best diff (expected)</div><div class="v" id="r_diff">–</div><div class="sub">~1–1.5× total work</div></div>
</div>
<h3>Steady vs moonshot</h3>
<div class="card" id="equiv" style="border-color:#33501f;background:#0d1408"></div>
<p class="muted-note" style="margin-top:10px">
  Your odds depend <strong>only on total PHd</strong> — not on how you buy it. A slow-and-steady order and a short moonshot of the
  <em>same PHd</em> have <strong>identical expected odds</strong>. The difference is <strong>variance</strong>: the moonshot swings harder
  (bigger chance of nothing, bigger chance of a monster), steady grinds toward the average. "It's all about total hashes."
</p>
<h3>The KMH 48-hour rule</h3>
<p class="muted-note">
  On <a href="https://app.kissmyhash.com" target="_blank" rel="noopener">Kiss My Hash</a>, orders of <strong>48h or more</strong> lock in your price and delivered hash;
  under 48h you take whatever the market gives ("pray"). Parasite's Refinery is pay-as-you-go either way. Duration doesn't change your odds for a given PHd —
  it changes <em>cost certainty</em>. Set duration ≥ 48h above to see the lock-in flag.
</p>
<p class="muted-note" style="margin-top:14px">P(≥1 hit in W PHd) = 1 − e<sup>−W/rate</sup>. Long-run probabilities, not promises. Not financial advice.</p>

</div>
</section>

<h2>Is renting worth it right now? 💸</h2>
<p class="muted-note">
  Raw hashvalue: one PHd of pool work is worth <strong>${fmtInt(breakEvenSats)} sats</strong> — a block's reward (3.125 BTC subsidy, <em>no</em> tx fees) spread across the <strong>${fmtInt(pm.phdNeeded)} PHd</strong> it takes to find a block at today's difficulty (D=${pm.D.toFixed(1)}T). Hold that up against what the Refinery actually charges.
</p>
<div class="grid">
  <div class="card"><div class="k">Break-even hashprice</div><div class="v">${fmtInt(breakEvenSats)}</div><div class="sub">sats/PHd · block reward ÷ work per block</div></div>
  <div class="card"><div class="k">Live Refinery hashprice</div><div class="v">${fmtInt(hashprice)}</div><div class="sub">sats/PHd · what you pay right now</div></div>
  <div class="card" style="border-color:${beStyle.border};background:${beStyle.bg}"><div class="k ${beStyle.cls}">Verdict ${beStyle.emoji}</div><div class="v ${beStyle.cls}">${beRatioPct}%</div><div class="sub">${beStyle.text} · live is ${beRatioPct}% of break-even</div></div>
</div>
<p class="muted-note" style="margin-top:8px">
  This is the <strong>raw hashvalue</strong> — it ignores variance and pot-sharing, so it isn't your expected payout, just whether a PHd is priced above or below what it earns on average. Subsidy only; folding in mempool fees would nudge break-even up a little. Not financial advice.
</p>

<h2>Odds of a block within… ⏱</h2>
<p class="muted-note">At the current expected wait of <strong>${fmtDuration(pm.expectedDays * 24)}</strong> per block (D=${pm.D.toFixed(1)}T, H=${pm.hGauge.toFixed(0)} PH/s), here's P(≥1 block) over each window = 1 − e<sup>−t/expected</sup>.</p>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
  ${probCards}
</div>
<div class="stale" style="background:#1a0d0d;border-color:#5c2b2b;color:#ffbcbc;margin-top:14px">
  Memoryless: these are <strong>probabilities, not predictions</strong>. A deep pot does <em>not</em> make the next block likelier — the odds above depend only on hashrate and difficulty, never on how long it's been. Scorekeeping, not forecasting.
</div>

<h2>Cado &amp; block pace at a hashrate ⚡</h2>
<p class="muted-note">Drop in a hashrate to see the long-run pace it produces — 10T cados per day, blocks per day, and your slice of the pool this round. Prefilled with the live pool hashrate (${pm.hGauge.toFixed(0)} PH/s).</p>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">
  <div class="card"><div class="k">Hashrate (PH/s)</div><input type="number" id="pace_h" value="${pm.hGauge.toFixed(1)}" step="1" min="0"/></div>
  <div class="card"><div class="k">🥑 10T cados / day</div><div class="v green" id="pace_cados">–</div><div class="sub">H ÷ ${RATE_10T_PHD} PHd per cado</div></div>
  <div class="card"><div class="k">🎰 Blocks / day</div><div class="v red" id="pace_blocks">–</div><div class="sub">H ÷ ${RATE_BLOCK_PHD} PHd per block</div></div>
  <div class="card"><div class="k">🏁 Your finder odds this round</div><div class="v" id="pace_finder">–</div><div class="sub">H ÷ pool ${pm.hGauge.toFixed(0)} PH/s</div></div>
</div>
<p class="muted-note" style="margin-top:8px">One PH/s sustained for one day is one PHd of work, so a day's pace is just PH/s ÷ the PHd-per-hit rate. Finder odds = your share of pool hashrate if a block landed while you're running. Long-run averages, not a schedule.</p>

<script>
(function(){
  var $ = function(id){return document.getElementById(id);};
  var poolH = ${pm.hGauge}, R10 = ${RATE_10T_PHD}, RBLK = ${RATE_BLOCK_PHD};
  function fmtNum(n){ if(!isFinite(n)) return "—"; if(n>=100) return Math.round(n).toLocaleString("en-US"); if(n>=10) return n.toFixed(1); if(n>=1) return n.toFixed(2); return n.toFixed(3); }
  function recomputePace(){
    var H = parseFloat($("pace_h").value)||0;
    $("pace_cados").textContent = H>0 ? fmtNum(H/R10)+" /day" : "–";
    $("pace_blocks").textContent = H>0 ? fmtNum(H/RBLK)+" /day" : "–";
    var finder = poolH>0 ? Math.min(1, H/poolH) : 0;
    $("pace_finder").textContent = H>0 ? (finder*100>=99.95 ? "≈100%" : (finder*100).toFixed(finder*100<1?2:1)+"%") : "–";
  }
  $("pace_h").addEventListener("input", recomputePace);
  recomputePace();
})();
</script>

${luckAudit}

<p class="muted-note" style="margin-top:24px"><strong>W</strong> = "Total Work Since Last Block" and <strong>D</strong> = "Minimum Needed Diff" (network difficulty), both in T — exactly as labelled on parasite.space. Because W and D share a unit, depth is just their ratio. W resets to 0 the moment the pool finds a block. Share price excludes transaction fees (subsidy only).</p>
<p class="muted-note">data ${pm.stale ? "stale" : "fresh"} · pool last ok ${timeAgo(pm.lastSuccess)}</p>

<script src="/potmath.js"></script>
<script>
// Your cut of this pot. The one thing anyone types is their own work this
// round; the pool's numbers (W, D, H) and the BTC price come in live from the
// headline card's data-* attributes, re-read every time the card refreshes
// (the "pm:live" event below), and are shown greyed out with a LIVE tag.
(function(){
  var P = window.PotMath, $ = function(id){return document.getElementById(id);};
  var live = {W:0, D:0, H:0, BTC:0, blk:0}, checkedAt = Date.now();
  var TO_T = {k:1e-9, m:1e-6, g:1e-3, t:1, p:1e3, e:1e6};
  function fmtInt(n){return Math.round(n).toLocaleString("en-US");}
  function fmtDur(days){ if(!isFinite(days)||days<=0) return "—"; var h=days*24; if(h<1) return Math.round(h*60)+"m"; if(h<24) return h.toFixed(1)+"h"; var d=Math.floor(h/24), r=Math.round(h-d*24); return r>0? d+"d "+r+"h" : d+"d"; }
  function fmtUsd(n){ return "$"+n.toLocaleString("en-US",{minimumFractionDigits:2, maximumFractionDigits:2}); }
  function fmtBtc(sats){ return (Math.round(sats)/1e8).toFixed(8).replace(/\\.?0+$/,"")+" BTC"; }
  function fmtShare(f){ var p=f*100; return p>=10 ? p.toFixed(1)+"%" : p>=0.01 ? p.toFixed(2)+"%" : p>0 ? "<0.01%" : "0%"; }
  // "5.24", "5.24T", "850G", "1.2P", "1,234.5" or "5,24" → work in T.
  function parseWork(s){
    s = String(s).trim().replace(/,(?=\\d{3}(?!\\d))/g,"").replace(",",".");
    var m = s.match(/^(\\d+\\.?\\d*|\\.\\d+)\\s*([kmgtpe])?$/i);
    return m ? parseFloat(m[1]) * TO_T[(m[2]||"t").toLowerCase()] : NaN;
  }
  function readLive(){
    var el = document.querySelector("#pmcard [data-w]");
    if(!el) return;
    var n = function(k){ var v = parseFloat(el.getAttribute("data-"+k)); return isFinite(v) ? v : 0; };
    live.W = n("w"); live.D = n("d"); live.H = n("h"); live.blk = n("blk");
    if(n("btc")>0) live.BTC = n("btc");
    checkedAt = Date.now();
  }
  function paintLive(){
    var m = P.computePotMath(live.W, live.D, live.H);
    $("pm_w").value = live.W.toFixed(2)+" T";
    $("pm_d").value = live.D.toFixed(2)+" T";
    $("pm_h").value = live.H.toFixed(2)+" PH/s";
    $("pm_blk").textContent = live.blk>0 ? " (#"+fmtInt(live.blk)+")" : "";
    $("pm_sats").textContent = live.W>0 ? fmtInt(m.satsPerG)+" sats/G" : "–";
    $("pm_depth").textContent = live.D>0 ? m.depth.toFixed(2)+"×" : "–";
    $("pm_rarity").textContent = live.D>0 ? Math.round(m.rarity*100)+"%" : "–";
    $("pm_wait").textContent = fmtDur(m.expectedDays);
  }
  function recompute(){
    var raw = $("pm_g").value, g = parseWork(raw), W = live.W;
    var out = $("pm_stake"), alt = $("pm_stake_alt"), cap = $("pm_stake_c");
    alt.textContent = "";
    if(raw.trim()===""){ out.textContent="–"; cap.textContent="enter your work this round to see your cut"; return; }
    if(!(g>=0)){ out.textContent="–"; cap.textContent="type a number, like 5.24 (850G and 1.2P work too)"; return; }
    if(!(W>0)){ out.textContent="–"; cap.textContent="waiting for the pool's live numbers…"; return; }
    if(g>W){ out.textContent="⚠ too high"; cap.textContent="That's more than the whole pool's work this round ("+W.toFixed(2)+" T). Use just your own work this round and check the unit (850G = 0.85T). When the pool finds a block, the round starts again at 0."; return; }
    var sats = P.stakeValue(g*1000, W);
    out.textContent = fmtInt(sats)+" sats";
    alt.textContent = "("+(live.BTC>0 ? "≈ "+fmtUsd(sats/1e8*live.BTC)+" · " : "")+fmtBtc(sats)+")";
    cap.textContent = Number(g.toFixed(6))+" T of the pool's "+W.toFixed(2)+" T this round = "+fmtShare(g/W)+" of the pot — your payout if it cracked right now (subsidy only)";
  }
  function age(){ var s=Math.round((Date.now()-checkedAt)/1000); $("pm_age").textContent = s<5 ? "just now" : s<90 ? s+"s ago" : Math.round(s/60)+" min ago"; }
  function update(){ readLive(); paintLive(); recompute(); age(); }
  $("pm_g").addEventListener("input", recompute);
  document.addEventListener("pm:live", update);
  setInterval(age, 5000);
  update();
})();
</script>
<script>
const C = ${consts};
const $C = (id) => document.getElementById(id);
function pAtLeastOne(w, rate){ if(w<=0) return 0; return 1 - Math.exp(-w/rate); }
function fmtPct(p){ const v = p*100; return v>=99.99 ? "≈100%" : (v<0.01 && v>0 ? "<0.01%" : v.toFixed(v<1?2:1)+"%"); }
function fmtDiffC(d){ if(d>=1e12) return (d/1e12).toFixed(2)+"T"; if(d>=1e9) return (d/1e9).toFixed(2)+"G"; return Math.round(d).toString(); }
function fmtSats(s){ return Math.round(s).toLocaleString("en-US")+" sats"; }
function recomputeRental(){
  const hr = parseFloat($C("hr").value)||0;
  const hours = parseFloat($C("hours").value)||0;
  const budget = parseFloat($C("budget").value);
  const phdOverride = parseFloat($C("phd").value);
  let phd, source;
  if(!isNaN(phdOverride) && $C("phd").value!==""){ phd = phdOverride; source="phd"; }
  else if(!isNaN(budget) && $C("budget").value!==""){ phd = budget / C.HASHPRICE; source="budget"; }
  else { phd = hr * hours/24; source="hrhours"; }

  const cost = phd * C.HASHPRICE;
  const usd = C.BTC>0 ? (cost/1e8)*C.BTC : 0;
  $C("r_phd").textContent = (phd<10?phd.toFixed(1):Math.round(phd).toLocaleString("en-US"))+" PHd";
  $C("r_cost").textContent = fmtSats(cost);
  $C("r_cost_usd").textContent = usd>0 ? "≈ $"+usd.toFixed(2)+" @ live hashprice" : "at live hashprice";
  $C("r_10t").textContent = fmtPct(pAtLeastOne(phd, C.RATE_10T_PHD));
  $C("r_21t").textContent = fmtPct(pAtLeastOne(phd, C.RATE_21T_PHD));
  $C("r_block").textContent = fmtPct(pAtLeastOne(phd, C.RATE_BLOCK_PHD));
  const workDiff = phd * C.PHD_TO_DIFF;
  $C("r_diff").textContent = fmtDiffC(workDiff)+" – "+fmtDiffC(workDiff*1.5);

  const li = $C("lockin");
  if(hours>=48){ li.style.display="block"; li.style.borderColor="#33501f"; li.style.background="#0d1408"; li.style.color="#c7f59a";
    li.innerHTML="🔒 <strong>"+hours+"h ≥ 48h</strong> — on KMH this locks in your price &amp; delivered hash. Cost certainty: high.";
  } else if(source!=="phd"){ li.style.display="block"; li.style.borderColor="#f5c451"; li.style.background="#2a1a00"; li.style.color="#f5c451";
    li.innerHTML="⚠ <strong>"+hours+"h &lt; 48h</strong> — under 48h on KMH you're not locked in (variable price/hash — \\"pray\\"). Refinery is pay-as-you-go.";
  } else { li.style.display="none"; }

  const steadyHr = 5, steadyHrs = (phd/steadyHr*24);
  const moonHr = 120, moonHrs = (phd/moonHr*24);
  const p10 = fmtPct(pAtLeastOne(phd, C.RATE_10T_PHD));
  $C("equiv").innerHTML =
    "<div class='k'>Same "+(phd<10?phd.toFixed(1):Math.round(phd))+" PHd, two ways — identical odds</div>"+
    "<table style='margin-top:8px'><tr><th>Style</th><th>Config</th><th>10T odds</th></tr>"+
    "<tr><td>🐢 Steady</td><td>"+steadyHr+" PH/s for "+steadyHrs.toFixed(0)+"h</td><td class='green'>"+p10+"</td></tr>"+
    "<tr><td>🚀 Moonshot</td><td>"+moonHr+" PH/s for "+moonHrs.toFixed(1)+"h</td><td class='green'>"+p10+"</td></tr>"+
    "</table><div class='sub'>Same expected odds — the moonshot just has higher variance.</div>";
}
["hr","hours","budget","phd"].forEach(id => $C(id).addEventListener("input", recomputeRental));
recomputeRental();
</script>
<script>
// Refresh only the live Pot Math card in place — no full-page reload, so the
// calculator keeps what you typed and the page never flashes. "pm:live" tells
// the calculator to pick up the card's fresh numbers.
(function(){
  function refresh(){
    fetch("/potmath/card",{cache:"no-store"})
      .then(function(r){return r.ok?r.text():null;})
      .then(function(html){ if(html){var el=document.getElementById("pmcard"); if(el){ el.innerHTML=html; document.dispatchEvent(new Event("pm:live")); }} })
      .catch(function(){});
  }
  setInterval(refresh, 45000);
})();
</script>

<style>
/* Three clear bands: percentile labels ABOVE, the bar, then the "you are here"
   value BELOW — so nothing stacks on top of anything else. */
.pbar{position:relative;height:34px;margin:46px 0 48px;background:linear-gradient(90deg,#0d1408,#1a0d0d);border:1px solid var(--line)}
.pbar-fill{position:absolute;left:0;top:0;bottom:0;background:rgba(143,209,79,.16);border-right:2px solid var(--green)}
.pbar .pmk{position:absolute;top:0;bottom:0;transform:translateX(-50%);color:var(--dim);font-size:13px}
.pbar .pmk i{position:absolute;top:0;bottom:0;left:50%;width:1px;background:#333}
.pbar .pmk b{position:absolute;top:-26px;left:50%;transform:translateX(-50%);font-weight:400;white-space:nowrap;padding:0 4px;background:var(--bg)}
.pbar-here{position:absolute;top:0;bottom:0;width:2px;background:var(--green);transform:translateX(-50%);color:var(--green)}
.pbar-here i{position:absolute;bottom:-17px;left:50%;transform:translateX(-50%);font-style:normal;font-size:12px;line-height:1}
.pbar-here b{position:absolute;top:48px;left:50%;transform:translateX(-50%);font-size:13px;white-space:nowrap;background:var(--bg);padding:0 5px}
.calcwrap{border:1px solid var(--line);background:#070707;margin:26px 0;padding:0;scroll-margin-top:90px}
.calcwrap>.calchead{margin:0;padding:18px 22px;color:var(--green);font-size:19px;letter-spacing:1px;text-transform:none;border-bottom:1px solid var(--line)}
.calcbody{padding:8px 22px 22px}
.calcbody h3{margin-top:26px}
/* Yours (green: the one box you type in) vs the pool's (greyed out, LIVE). */
.card.mine{border-color:#33501f;background:#0d1408}
.card.livec{border-color:#1a1a1a;background:#080808}
.card.livec .v,.card.livec input{color:#7a7a7a}
.card.livec input{background:#0b0b0b;border-color:#1a1a1a;cursor:default;outline:none}
.live{color:var(--green);font-size:12px;letter-spacing:1px;white-space:nowrap}
.live i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);margin-right:5px;vertical-align:1px}
@media (prefers-reduced-motion:no-preference){.live i{animation:pmlive 2s ease-in-out infinite}}
@keyframes pmlive{50%{opacity:.3}}
.pm-alt{display:inline-block;font-size:.55em}
table.heat{border-collapse:collapse}
table.heat th{font-size:10px;color:#8a8a8a;padding:2px 3px;text-align:center;border:0}
table.heat th.day{text-align:right;padding-right:8px}
table.heat td.cell{width:26px;height:20px;border:1px solid #000}
</style>
`;

  return renderPage({
    title: "Calculator",
    active: "calculator",
    body,
    staleBanner: pm.stale
      ? `Upstream data looks stale (pool last ok ${timeAgo(pm.lastSuccess)}). Showing last-good values.`
      : null,
  });
}
