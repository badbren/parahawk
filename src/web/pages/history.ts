import { renderPage } from "../layout.js";
import { getHistory } from "../../services/history.js";
import { getPoolStatsSeries, type PoolSeries } from "../../data/parasite.js";
import { fmtInt, fmtDiff, esc } from "../format.js";

function maskAddr(a: string): string {
  if (a.includes("...") || a.includes("…")) return a;
  return `${a.slice(0, 12)}…${a.slice(-4)}`;
}

function addrCell(a: string): string {
  const masked = a.includes("...") || a.includes("…");
  return masked
    ? `<span class="dim">${esc(maskAddr(a))}</span>`
    : `<a href="/address/${esc(a)}">${esc(maskAddr(a))}</a>`;
}

function labelOf(ms: number): string {
  const d = new Date(ms);
  const mo = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mo} ${day} ${hh}:${mm}`;
}

/** Small button group rendered at the top-right of a chart card header. */
function toggle(metric: string, active: "1h" | "4h" | "1d" | "1w"): string {
  const windows: Array<["1h" | "4h" | "1d" | "1w", string]> = [
    ["1h", "1H"],
    ["4h", "4H"],
    ["1d", "1D"],
    ["1w", "1W"],
  ];
  return `<div class="tf-group" data-metric="${metric}">${windows
    .map(
      ([w, lbl]) =>
        `<button data-window="${w}"${w === active ? ' class="active"' : ""}>${lbl}</button>`,
    )
    .join("")}</div>`;
}

export async function renderHistory(): Promise<string> {
  const h = await getHistory(7);

  // Default-window seeds for the live parasite series (1D for hashrate/users/
  // workers). Falls back to Parahawk's own store if the upstream call fails so
  // the page still renders.
  let pool: PoolSeries;
  try {
    pool = await getPoolStatsSeries("1d");
  } catch {
    pool = { hashrate: h.hashrate, users: h.users, workers: [] };
  }

  // Pool hashrate (default 1D) — from parasite.space historical series.
  const hrLabels = pool.hashrate.map((p) => labelOf(p.t));
  const hrVals = pool.hashrate.map((p) => Math.round(p.v * 10) / 10);

  // Refinery hashprice (default 1W) — thin, from Parahawk's own store.
  const hpLabels = h.hashprice.map((p) => labelOf(p.t));
  const hpVals = h.hashprice.map((p) => Math.round(p.v));

  // Users / workers online (default 1D).
  const uwLabels = pool.users.map((p) => labelOf(p.t));
  const usersVals = pool.users.map((p) => Math.round(p.v));
  const workersVals = pool.workers.map((p) => Math.round(p.v));

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

  const data = JSON.stringify({
    hrLabels,
    hrVals,
    hpLabels,
    hpVals,
    uwLabels,
    usersVals,
    workersVals,
    potLabels,
    potHours,
    potPhd,
    hitPoints,
    hitMeta,
  });

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
              const tierClass = x.tier === "21T" ? "amber" : x.tier === "10T" ? "red" : "dim";
              return `<tr>
                <td class="dim">${esc(new Date(x.ts).toLocaleString("en-US"))}</td>
                <td class="${tierClass}">${esc(x.tier)}</td>
                <td>${addrCell(x.address)}</td>
                <td>${fmtDiff(x.difficulty)}</td>
                <td>${x.orderId ? esc(x.orderId) : "<span class='dim'>—</span>"}</td>
                <td class="dim">${x.worker ? esc(x.worker) : "—"}</td>
              </tr>`;
            })
            .join("")}
        </table>`;

  const body = `
<style>
.chartbox { border:1px solid #222; border-radius:6px; padding:14px 16px 8px; margin:18px 0; background:#0d0d0d; }
.chartbox-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:6px; flex-wrap:wrap; }
.chartbox-head h2 { margin:0; font-size:14px; border:0; padding:0; }
.chartbox .cap { margin:2px 0 8px; }
.tf-group { display:inline-flex; gap:4px; }
.tf-group button { font-family:Consolas,monospace; font-size:11px; padding:3px 9px; background:#141414; color:#8a8a8a; border:1px solid #222; border-radius:4px; cursor:pointer; letter-spacing:.5px; transition:.12s; }
.tf-group button:hover { color:#ccc; border-color:#333; }
.tf-group button.active { background:rgba(143,209,79,.15); color:#8fd14f; border-color:#8fd14f; }
</style>

<h1>Pool history</h1>
<p class="lead">Charts built from Parahawk's own time series — last ${h.rangeDays} days · ${fmtInt(h.sampleCount)} samples · ${h.potLengths.length} completed pot cycles.</p>

<div class="chartbox">
  <div class="chartbox-head">
    <h2>Pool hashrate (PH/s)</h2>
    ${toggle("hashrate", "1d")}
  </div>
  <canvas id="c_hashrate" height="90"></canvas>
</div>

<div class="chartbox">
  <div class="chartbox-head">
    <h2>Refinery hashprice (sats/PHd)</h2>
    ${toggle("hashprice", "1w")}
  </div>
  <p class="muted-note cap">Hashprice history is collected by Parahawk and deepens over time — it only moves at difficulty retargets, so short windows may look flat or sparse.</p>
  <canvas id="c_hashprice" height="90"></canvas>
</div>

<div class="chartbox">
  <div class="chartbox-head">
    <h2>Users / workers online</h2>
    ${toggle("usersworkers", "1d")}
  </div>
  <canvas id="c_usersworkers" height="90"></canvas>
</div>

<h2>🔴 Top diffs per block — 10T+ pop out</h2>
<p class="muted-note">The best share found each block. Grey = sub-10T (the norm), 🔴 red = 10T+ (Bravocado), 🟠 amber = 21T+ (homeminers). Hover a dot for the miner (masked by Parasite), difficulty, and block. See the <a href="/board">Bravocado board</a> for the 10T+ club.</p>
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

// Client-side twin of the server labelOf (short date + time).
function jsLabel(ms){
  const d = new Date(ms);
  const mo = d.toLocaleString("en-US",{month:"short"});
  const pad = (n)=>String(n).padStart(2,"0");
  return mo+" "+d.getDate()+" "+pad(d.getHours())+":"+pad(d.getMinutes());
}

const CHARTS = {};
CHARTS.hashrate = new Chart(document.getElementById("c_hashrate"), {
  type:"line",
  data:{ labels:D.hrLabels, datasets:[{ data:D.hrVals, borderColor:GREEN, backgroundColor:"rgba(143,209,79,.08)", fill:true }] },
  options: baseOpts("PH/s")
});
CHARTS.hashprice = new Chart(document.getElementById("c_hashprice"), {
  type:"line",
  data:{ labels:D.hpLabels, datasets:[{ data:D.hpVals, borderColor:AMBER, backgroundColor:"rgba(245,196,81,.08)", fill:true }] },
  options: baseOpts("sats/PHd")
});
CHARTS.usersworkers = new Chart(document.getElementById("c_usersworkers"), {
  type:"line",
  data:{ labels:D.uwLabels, datasets:[
    { label:"Users", data:D.usersVals, borderColor:GREEN, backgroundColor:"rgba(143,209,79,.06)", fill:false },
    { label:"Workers", data:D.workersVals, borderColor:AMBER, backgroundColor:"rgba(245,196,81,.06)", fill:false }
  ]},
  options:{ ...baseOpts("online"), plugins:{ legend:{ display:true } } }
});

// Timeframe toggles: fetch the selected window and swap the chart's data.
document.querySelectorAll(".tf-group").forEach((group) => {
  group.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-window]");
    if (!btn) return;
    const metric = group.getAttribute("data-metric");
    const win = btn.getAttribute("data-window");
    group.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    try {
      if (metric === "usersworkers") {
        const [u, w] = await Promise.all([
          fetch("/api/pool-history?metric=users&window="+win).then((r)=>r.json()),
          fetch("/api/pool-history?metric=workers&window="+win).then((r)=>r.json())
        ]);
        const c = CHARTS.usersworkers;
        c.data.labels = u.points.map((p)=>jsLabel(p.t));
        c.data.datasets[0].data = u.points.map((p)=>p.v);
        c.data.datasets[1].data = w.points.map((p)=>p.v);
        c.update();
      } else {
        const res = await fetch("/api/pool-history?metric="+metric+"&window="+win).then((r)=>r.json());
        const c = CHARTS[metric];
        c.data.labels = res.points.map((p)=>jsLabel(p.t));
        c.data.datasets[0].data = res.points.map((p)=>p.v);
        c.update();
      }
    } catch (err) { /* leave the current view in place on fetch error */ }
  });
});

const RED = "#ff5c5c", DIMDOT = "#4a4a4a";
const dotColor = (t) => t==="21T" ? AMBER : t==="10T" ? RED : DIMDOT;
new Chart(document.getElementById("c_hits"), {
  type:"scatter",
  data:{ datasets:[{
    label:"top diffs",
    data:D.hitPoints,
    pointBackgroundColor:D.hitMeta.map(m => dotColor(m.tier)),
    pointBorderColor:D.hitMeta.map(m => dotColor(m.tier)),
    pointRadius:D.hitMeta.map(m => m.tier==="sub" ? 3 : 6),
    pointHoverRadius:8
  }]},
  options:{ responsive:true,
    plugins:{ legend:{display:false}, tooltip:{ callbacks:{
      label:(ctx)=>{ const m=D.hitMeta[ctx.dataIndex]||{}; return [
        m.tier+" hit — "+ctx.parsed.y+"T",
        (function(a){a=a||"";return (a.indexOf("...")>=0||a.indexOf("…")>=0)?a:(a.slice(0,14)+"…"+a.slice(-4));})(m.addr),
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

  return renderPage({ title: "History", active: "pool", body });
}
