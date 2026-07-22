import { renderPage } from "../layout.js";
import { getHistory } from "../../services/history.js";
import { fmtInt } from "../format.js";

function labelOf(ms: number): string {
  const d = new Date(ms);
  const mo = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  return `${mo} ${day} ${hh}:00`;
}

export async function renderHistory(): Promise<string> {
  const h = await getHistory(7);

  const timeLabels = h.hashrate.map((p) => labelOf(p.t));
  const hashrateVals = h.hashrate.map((p) => Math.round(p.v * 10) / 10);
  const hashpriceVals = h.hashprice.map((p) => Math.round(p.v));
  const potLabels = h.potLengths.map((p) => `#${p.height}`);
  const potHours = h.potLengths.map((p) => Math.round(p.durationHours * 10) / 10);
  const potPhd = h.potLengths.map((p) => Math.round(p.estPhd));

  const data = JSON.stringify({ timeLabels, hashrateVals, hashpriceVals, potLabels, potHours, potPhd });

  const body = `
<h1>History</h1>
<p class="lead">Charts built from Parahawk's own time series — last ${h.rangeDays} days · ${fmtInt(h.sampleCount)} samples · ${h.potLengths.length} completed pot cycles.</p>

<h2>Pool hashrate (PH/s)</h2>
<canvas id="c_hashrate" height="90"></canvas>

<h2>Refinery hashprice (sats/PHd)</h2>
<canvas id="c_hashprice" height="90"></canvas>

<h2>Pot lengths per cycle</h2>
<p class="muted-note">Each completed cycle: duration (hours) and estimated PHd banked in the pot.</p>
<canvas id="c_pots" height="90"></canvas>

<p class="muted-note" style="margin-top:20px">${h.sampleCount < 24 ? "⚠ Small sample so far — charts fill in as the pollers collect data." : "Data auto-collects every ~45s; raw samples roll up hourly after 7 days."}</p>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script>
const D = ${data};
const GREEN = "#8fd14f", AMBER = "#f5c451", DIM = "#8a8a8a", LINE = "#222";
Chart.defaults.color = DIM;
Chart.defaults.borderColor = LINE;
Chart.defaults.font.family = "Consolas, monospace";
const baseOpts = (yTitle) => ({
  responsive:true, maintainAspectRatio:true,
  plugins:{ legend:{ display:false } },
  scales:{
    x:{ ticks:{ maxTicksLimit:8, autoSkip:true }, grid:{ color:LINE } },
    y:{ title:{ display:true, text:yTitle, color:DIM }, grid:{ color:LINE } }
  },
  elements:{ point:{ radius:0 }, line:{ borderWidth:1.5, tension:.25 } }
});
new Chart(document.getElementById("c_hashrate"), {
  type:"line",
  data:{ labels:D.timeLabels, datasets:[{ data:D.hashrateVals, borderColor:GREEN, backgroundColor:"rgba(143,209,79,.08)", fill:true }] },
  options: baseOpts("PH/s")
});
new Chart(document.getElementById("c_hashprice"), {
  type:"line",
  data:{ labels:D.timeLabels, datasets:[{ data:D.hashpriceVals, borderColor:AMBER, backgroundColor:"rgba(245,196,81,.08)", fill:true }] },
  options: baseOpts("sats/PHd")
});
new Chart(document.getElementById("c_pots"), {
  type:"bar",
  data:{ labels:D.potLabels, datasets:[
    { label:"Duration (h)", data:D.potHours, backgroundColor:"rgba(143,209,79,.5)", yAxisID:"y" },
    { label:"Est. PHd", data:D.potPhd, backgroundColor:"rgba(245,196,81,.5)", yAxisID:"y1" }
  ]},
  options:{ responsive:true, plugins:{ legend:{ display:true } },
    scales:{
      y:{ position:"left", title:{display:true,text:"hours"}, grid:{color:LINE} },
      y1:{ position:"right", title:{display:true,text:"PHd"}, grid:{drawOnChartArea:false} },
      x:{ grid:{color:LINE} }
    } }
});
</script>
`;

  return renderPage({ title: "History", active: "history", body });
}
