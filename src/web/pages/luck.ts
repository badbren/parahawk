import { renderPage } from "../layout.js";
import { getLuckAudit, type LuckCell } from "../../services/luck.js";
import { getOverview } from "../../services/overview.js";
import { potMathFromOverview } from "../../services/potmath.js";
import { fmtInt, fmtPhd } from "../format.js";
import { RATE_10T_PHD } from "../../math/constants.js";

/** Depth (= −ln p) at which an average round has rarity p, for the percentile bar. */
const PBAR_MAX_DEPTH = 3.5;
const PBAR_MARKERS: Array<[number, string]> = [
  [0.6931, "50%"],
  [1.4697, "23%"],
  [2.3026, "10%"],
  [2.9957, "5%"],
];

const RATE_10T_LABEL = `${RATE_10T_PHD} PHd`;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Map a ratio (~1.0 = expected) to a heatmap colour. */
function cellColor(c: LuckCell | undefined): string {
  if (!c) return "#0a0a0a";
  if (c.lowConfidence) return "#141414";
  const r = c.ratio;
  // below expectation → dim; around 1 → green-ish; well above → bright green (a "signal")
  if (r >= 1.5) return "#8fd14f";
  if (r >= 1.2) return "#5f8f34";
  if (r >= 0.8) return "#33501f";
  if (r >= 0.5) return "#1e3013";
  return "#141a10";
}

export async function renderLuck(): Promise<string> {
  const [audit, o] = await Promise.all([getLuckAudit(), getOverview().catch(() => null)]);
  const pm = o ? potMathFromOverview(o) : null;
  const seedW = pm?.W ?? 184;
  const seedD = pm?.D ?? 126.4;

  const map = new Map<string, LuckCell>();
  for (const c of audit.cells) map.set(`${c.dayOfWeek}:${c.hourOfDay}`, c);

  const markerSpans = PBAR_MARKERS.map(
    ([d, label]) =>
      `<span class="pmk" style="left:${((d / PBAR_MAX_DEPTH) * 100).toFixed(1)}%"><i></i><b>${label}</b></span>`,
  ).join("");

  const potDepthSection = `
<h2 style="margin-top:8px">Where this pot sits 📏</h2>
<p class="muted-note">Round depth = W / D. Rarity = e<sup>−W/D</sup> — the share of average rounds that run at least this deep. Type the work banked so far this round to move the marker.</p>

<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
  <div class="card"><div class="k">W — work so far this round (T)</div><input type="number" id="lk_w" value="${seedW}" step="0.1" min="0"/></div>
  <div class="card"><div class="k">D — minimum needed diff (T)</div><input type="number" id="lk_d" value="${seedD}" step="0.1" min="0"/></div>
  <div class="card"><div class="k">Round depth</div><div class="v" id="lk_depth">–</div><div class="sub" id="lk_luck">luck</div></div>
  <div class="card"><div class="k">Round rarity</div><div class="v" id="lk_rarity">–</div><div class="sub" id="lk_rarity_c">1 in N rounds</div></div>
</div>

<div class="pbar">
  <div class="pbar-fill" id="lk_fill"></div>
  ${markerSpans}
  <span class="pbar-here" id="lk_here"><b id="lk_here_lbl">you</b><i>▼</i></span>
</div>
<p class="muted-note" style="margin-top:6px">← shallower (found quick) &nbsp;·&nbsp; deeper (overdue) → &nbsp; markers show the depth at which only 50 / 23 / 10 / 5% of rounds run this long.</p>

<div class="stale" style="background:#1a0d0d;border-color:#5c2b2b;color:#ffbcbc;margin-top:18px">
  <strong>These numbers are SCOREKEEPING, not forecasting.</strong> Mining is memoryless: the pot being deep does <em>not</em> make the next block more likely. Anyone saying "we're due" is describing the past, not the future.
</div>

<script src="/potmath.js"></script>
<script>
(function(){
  var P=window.PotMath, $=function(id){return document.getElementById(id);};
  var MAX=${PBAR_MAX_DEPTH};
  function recompute(){
    var W=parseFloat($("lk_w").value)||0, D=parseFloat($("lk_d").value)||0;
    var m=P.computePotMath(W,D,0);
    var ok=W>0&&D>0;
    $("lk_depth").textContent = ok? m.depth.toFixed(2)+"×" : "–";
    $("lk_luck").textContent = ok? Math.round(m.luckPct)+"% luck" : "luck";
    $("lk_rarity").textContent = ok? Math.round(m.rarity*100)+"%" : "–";
    $("lk_rarity_c").textContent = ok? "~1 in "+Math.max(1,Math.round(1/m.rarity))+" rounds get this deep" : "1 in N rounds";
    var pos=Math.max(0,Math.min(100,(m.depth/MAX)*100));
    $("lk_fill").style.width=pos+"%";
    $("lk_here").style.left=pos+"%";
    $("lk_here_lbl").textContent = ok? m.depth.toFixed(2)+"×" : "you";
  }
  ["lk_w","lk_d"].forEach(function(id){$(id).addEventListener("input",recompute);});
  recompute();
})();
</script>

<style>
.pbar{position:relative;height:34px;margin:26px 0 4px;background:linear-gradient(90deg,#0d1408,#1a0d0d);border:1px solid var(--line)}
.pbar-fill{position:absolute;left:0;top:0;bottom:0;background:rgba(143,209,79,.16);border-right:2px solid var(--green)}
.pbar .pmk{position:absolute;top:0;bottom:0;transform:translateX(-50%);color:var(--dim);font-size:13px}
.pbar .pmk i{position:absolute;top:0;bottom:0;left:50%;width:1px;background:#333}
.pbar .pmk b{position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-weight:400;white-space:nowrap}
.pbar-here{position:absolute;top:0;transform:translateX(-50%);color:var(--green);text-align:center}
.pbar-here b{position:absolute;bottom:-2px;left:50%;transform:translateX(-50%);font-size:13px;white-space:nowrap}
.pbar-here i{position:absolute;top:2px;left:50%;transform:translateX(-50%);font-style:normal}
</style>
`;

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

  const body = `
<h1>Luck &amp; pot depth</h1>
<p class="lead">How deep is this pot, how rare is that, and does Parasite pay better at 3am? Scorekeeping from the numbers — never a forecast.</p>

${potDepthSection}

<h2>The luck audit 🔬</h2>
<div class="stale" style="background:#0d1408;border-color:#33501f;color:#c7f59a">
  <strong>The claim to beat:</strong> one 10T+ share is expected per <strong>~${RATE_10T_LABEL}</strong> of pool work, everywhere, at every hour.
  If any hour-of-day / day-of-week bucket <em>sustainedly</em> beats that, there's a method — and it'll glow below. Expectation is a flat, boring ~100%.
</div>

<h2>Share quality by hour × weekday (UTC)</h2>
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

<h2>Totals</h2>
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
  Method &amp; caveats: best-diff-since-block is cumulative within a pot cycle, so this is a proxy, not a per-share hit count. It's designed to surface a <em>sustained</em> hour/day bias if one exists, not to prove its absence. Judge the trend, not a single cell. Not financial advice.
</p>

<style>
table.heat{border-collapse:collapse}
table.heat th{font-size:10px;color:#8a8a8a;padding:2px 3px;text-align:center;border:0}
table.heat th.day{text-align:right;padding-right:8px}
table.heat td.cell{width:26px;height:20px;border:1px solid #000}
</style>
`;

  return renderPage({ title: "Luck audit", active: "luck", body });
}
