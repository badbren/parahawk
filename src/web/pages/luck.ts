import { renderPage } from "../layout.js";
import { getLuckAudit, type LuckCell } from "../../services/luck.js";
import { fmtInt, fmtPhd } from "../format.js";
import { RATE_10T_PHD } from "../../math/constants.js";

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
  const audit = await getLuckAudit();
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

  const body = `
<h1>The luck audit 🔬</h1>
<p class="lead">Does Parasite pay better at 3am? At the weekend? This page tests the myth against Parahawk's own collected data — no vibes, just the numbers.</p>

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
