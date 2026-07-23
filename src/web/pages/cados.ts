import { renderPage } from "../layout.js";
import { getCadoData } from "../../services/cados.js";
import { fmtInt } from "../format.js";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dateLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getUTCDate()}`;
}

export async function renderCados(): Promise<string> {
  const c = await getCadoData();

  // cumulative timeline points
  const cumLabels = c.awards.map((a) => dateLabel(a.ts));
  const cumData = c.awards.map((_, i) => i + 1);
  const hourLabels = Array.from({ length: 24 }, (_, h) => `${h}`);
  const peakHour = c.byHour.indexOf(Math.max(...c.byHour, 0));
  const peakDow = c.byDow.indexOf(Math.max(...c.byDow, 0));

  const data = JSON.stringify({
    cumLabels,
    cumData,
    hourLabels,
    byHour: c.byHour,
    dowLabels: DOW,
    byDow: c.byDow,
  });

  const span =
    c.firstTs && c.lastTs
      ? `${dateLabel(c.firstTs)} – ${dateLabel(c.lastTs)}`
      : "—";

  const body = `
<h1>Bravocado awards 🥑</h1>
<p class="lead">When each Bravocado was handed out — reconstructed on-chain from the OMB dispensary wallet's transfers. ${c.ok ? "" : "<span class='amber'>(live fetch failed — showing what we have)</span>"}</p>

<div class="grid">
  <div class="card"><div class="k">Cados awarded</div><div class="v">${fmtInt(c.count)}</div><div class="sub">on-chain transfers</div></div>
  <div class="card"><div class="k">Span</div><div class="v" style="font-size:18px">${span}</div></div>
  <div class="card"><div class="k">Busiest day</div><div class="v">${c.count ? DOW[peakDow] : "—"}</div><div class="sub">${c.count ? c.byDow[peakDow] + " awards" : ""}</div></div>
  <div class="card"><div class="k">Busiest hour</div><div class="v">${c.count ? peakHour + ":00" : "—"}</div><div class="sub">UTC · ${c.count ? c.byHour[peakHour] + " awards" : ""}</div></div>
  <div class="card"><div class="k">Median gap</div><div class="v">${c.medianGapHours != null ? c.medianGapHours.toFixed(1) + "h" : "—"}</div><div class="sub">between awards</div></div>
</div>

<h2>Cados awarded over time</h2>
<canvas id="c_cum" height="80"></canvas>

<h2>By hour of day (UTC)</h2>
<p class="muted-note">Do cados cluster at certain hours? Each bar = number of cados awarded in that UTC hour.</p>
<canvas id="c_hour" height="70"></canvas>

<h2>By weekday (UTC)</h2>
<canvas id="c_dow" height="60"></canvas>

<p class="muted-note" style="margin-top:20px">
  <strong>How this is built &amp; its limits:</strong> a cado counts as awarded when it leaves the
  dispensary wallet <code>${c.dispensary.slice(0, 10)}…${c.dispensary.slice(-6)}</code> to a holder's ordinal wallet.
  That transfer time tracks when a miner qualified, but isn't the exact share timestamp — and recipients are
  <code>bc1p</code> ordinal wallets, not the <code>bc1q</code> mining addresses, so we can't join to a miner's Parasite stats.
  Small sample (${c.count}), so read the trend, not any single bar. Data via mempool.space, cached ~30 min.
</p>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script>
const D = ${data};
const GREEN="#8fd14f", AMBER="#f5c451", DIM="#8a8a8a", LINE="#222";
Chart.defaults.color=DIM; Chart.defaults.borderColor=LINE; Chart.defaults.font.family="Consolas, monospace";
new Chart(document.getElementById("c_cum"), {
  type:"line",
  data:{ labels:D.cumLabels, datasets:[{ data:D.cumData, borderColor:GREEN, backgroundColor:"rgba(143,209,79,.08)", fill:true, stepped:true, pointRadius:0 }]},
  options:{ responsive:true, plugins:{legend:{display:false}}, scales:{ x:{ ticks:{maxTicksLimit:8}, grid:{color:LINE} }, y:{ title:{display:true,text:"cumulative cados"}, grid:{color:LINE}, beginAtZero:true } } }
});
new Chart(document.getElementById("c_hour"), {
  type:"bar",
  data:{ labels:D.hourLabels, datasets:[{ data:D.byHour, backgroundColor:"rgba(143,209,79,.55)" }]},
  options:{ responsive:true, plugins:{legend:{display:false}}, scales:{ x:{ title:{display:true,text:"hour (UTC)"}, grid:{color:LINE} }, y:{ grid:{color:LINE}, beginAtZero:true, ticks:{precision:0} } } }
});
new Chart(document.getElementById("c_dow"), {
  type:"bar",
  data:{ labels:D.dowLabels, datasets:[{ data:D.byDow, backgroundColor:"rgba(245,196,81,.6)" }]},
  options:{ responsive:true, plugins:{legend:{display:false}}, scales:{ x:{ grid:{color:LINE} }, y:{ grid:{color:LINE}, beginAtZero:true, ticks:{precision:0} } } }
});
</script>
`;

  return renderPage({ title: "Bravocado awards", active: "cados", body });
}
