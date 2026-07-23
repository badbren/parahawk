import { renderPage } from "../layout.js";
import { getHistory } from "../../services/history.js";
import { fmtInt, fmtDiff, esc } from "../format.js";

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

  // 10T+ hits as scatter points {x: ts, y: difficulty in T} + parallel meta for tooltips
  const hitPoints = h.hits.map((x) => ({ x: x.ts, y: Math.round((x.difficulty / 1e12) * 10) / 10 }));
  const hitMeta = h.hits.map((x) => ({
    addr: x.address,
    order: x.orderId,
    worker: x.worker,
    tier: x.tier,
    when: new Date(x.ts).toLocaleString("en-US"),
  }));

  const data = JSON.stringify({ timeLabels, hashrateVals, hashpriceVals, potLabels, potHours, potPhd, hitPoints, hitMeta });

  const hitsTable =
    h.hits.length === 0
      ? `<p class="muted-note">No 10T+ hits collected in this window yet.</p>`
      : `<table>
          <tr><th>When</th><th>Tier</th><th>Address</th><th>Difficulty</th><th>Order</th><th>Worker</th></tr>
          ${h.hits
            .slice()
            .sort((a, b) => b.ts - a.ts)
            .slice(0, 40)
            .map((x) => {
              const tierClass = x.tier === "21T" ? "amber" : "red";
              return `<tr>
                <td class="dim">${esc(new Date(x.ts).toLocaleString("en-US"))}</td>
                <td class="${tierClass}">${esc(x.tier)}</td>
                <td><a href="/address/${esc(x.address)}">${esc(x.address.slice(0, 12))}…${esc(x.address.slice(-4))}</a></td>
                <td>${fmtDiff(x.difficulty)}</td>
                <td>${x.orderId ? esc(x.orderId) : "<span class='dim'>—</span>"}</td>
                <td class="dim">${x.worker ? esc(x.worker) : "—"}</td>
              </tr>`;
            })
            .join("")}
        </table>`;

  const body = `
<h1>History</h1>
<p class="lead">Charts built from Parahawk's own time series — last ${h.rangeDays} days · ${fmtInt(h.sampleCount)} samples · ${h.potLengths.length} completed pot cycles.</p>

<h2>Pool hashrate (PH/s)</h2>
<canvas id="c_hashrate" height="90"></canvas>

<h2>Refinery hashprice (sats/PHd)</h2>
<canvas id="c_hashprice" height="90"></canvas>

<h2>🔴 10T+ hits (Bravocado board)</h2>
<p class="muted-note">Every 10T+ share the pool has seen — red = 10T (Bravocado), amber = 21T+ (homeminers). Hover a dot for who hit it, their share difficulty, and order.</p>
<canvas id="c_hits" height="80"></canvas>

<h3 style="margin-top:18px;color:#fff;font-size:13px;text-transform:uppercase;letter-spacing:1px">Who hit it</h3>
${hitsTable}

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
const RED = "#ff5c5c";
new Chart(document.getElementById("c_hits"), {
  type:"scatter",
  data:{ datasets:[{
    label:"10T+ hits",
    data:D.hitPoints,
    pointBackgroundColor:D.hitMeta.map(m => m.tier==="21T" ? AMBER : RED),
    pointBorderColor:D.hitMeta.map(m => m.tier==="21T" ? AMBER : RED),
    pointRadius:5, pointHoverRadius:7
  }]},
  options:{ responsive:true,
    plugins:{ legend:{display:false}, tooltip:{ callbacks:{
      label:(ctx)=>{ const m=D.hitMeta[ctx.dataIndex]||{}; return [
        m.tier+" hit — "+ctx.parsed.y+"T",
        (m.addr||"").slice(0,14)+"…"+(m.addr||"").slice(-4),
        "order: "+(m.order||"—")+"  worker: "+(m.worker||"—"),
        m.when ];
      }
    }}},
    scales:{
      x:{ type:"linear", ticks:{ maxTicksLimit:8, callback:(v)=>{ const d=new Date(v); return (d.getMonth()+1)+"/"+d.getDate()+" "+String(d.getHours()).padStart(2,"0")+":00"; } }, grid:{color:LINE} },
      y:{ title:{display:true,text:"share diff (T)"}, grid:{color:LINE}, beginAtZero:true }
    }
  }
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
