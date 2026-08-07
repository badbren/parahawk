import { renderPage } from "../layout.js";
import { getUserStats } from "../../data/parasite.js";
import { getOverview } from "../../services/overview.js";
import { getStore } from "../../db/index.js";
import { computeOdometer } from "../../math/work.js";
import { oddsForWork } from "../../math/odds.js";
import { potMathFromOverview } from "../../services/potmath.js";
import { stakeValue } from "../../math/potmath.js";
import { PHD_TO_DIFF } from "../../math/constants.js";
import { BADGE_DEFS } from "../../data/badges.js";
import {
  fmtHashrate,
  fmtDiff,
  fmtPhd,
  fmtPct,
  fmtInt,
  fmtUsd,
  fmtSats,
  fmtDuration,
  jsonForScript,
  esc,
} from "../format.js";
import type { AddressSnapshot } from "../../db/types.js";

function isBc1(addr: string): boolean {
  return /^bc1[0-9a-z]{6,87}$/i.test(addr);
}

function pct(p: number): string {
  const v = p * 100;
  if (v >= 99.99) return "≈100%";
  if (v > 0 && v < 0.01) return "<0.01%";
  return `${v.toFixed(v < 1 ? 2 : 1)}%`;
}

function orderRows(
  orders: { id: string; status: string; requestedPhd: number; deliveredPhd?: number; hashratePhs: number; bestShare: number; progressPercent: number; provider?: string }[],
): string {
  if (orders.length === 0) return `<tr><td colspan="6" class="dim">no orders</td></tr>`;
  return orders
    .slice()
    .sort((a, b) => b.requestedPhd - a.requestedPhd)
    .map((o) => {
      const statusColor = o.status === "fulfilled" ? "green" : o.status === "expired" ? "red" : "amber";
      const prov = o.provider ?? "UNKNOWN";
      return `<tr>
        <td>${esc(o.id)}</td>
        <td class="${prov === "Refinery" ? "green" : "dim"}">${esc(prov)}</td>
        <td class="${statusColor}">${o.status}</td>
        <td>${Math.round(o.requestedPhd)} PHd</td>
        <td>${fmtDiff(o.bestShare)}</td>
        <td><div class="bar"><span style="width:${Math.min(100, o.progressPercent)}%"></span></div> ${o.progressPercent}%</td>
      </tr>`;
    })
    .join("");
}

export async function renderAddress(addressRaw: string): Promise<string> {
  const address = addressRaw.trim();
  if (!isBc1(address)) {
    return renderPage({
      title: "Wallet",
      active: "",
      body: `<h1>Wallet stats</h1><p class="lead">"${esc(address)}" doesn't look like a bc1 address.</p><p>Paste a full <code>bc1…</code> address in the search box, or open one from the <a href="/board">Bravocados board →</a></p>`,
    });
  }

  const [o, u, hits, snaps] = await Promise.all([
    getOverview(),
    getUserStats(address),
    getStore().getHitsForAddress(address, 25).catch(() => []),
    getStore().getAddressSnapshots(address, 500).catch(() => [] as AddressSnapshot[]),
  ]);

  // Record a snapshot of this visit so the hashrate timeline builds up over time
  // (Parasite has no historical per-address hashrate endpoint). Fire-and-forget.
  void getStore()
    .insertAddressSnapshot({
      address,
      ts: Date.now(),
      hashrate: u.hashratePhs,
      bestDifficulty: u.bestDifficulty,
      totalWork: u.totalWorkDiff,
    })
    .catch(() => {});

  const odo = computeOdometer(u.totalWorkDiff, u.bestDifficulty, o.pool.networkDifficulty);
  const odds = oddsForWork(odo.lifetimePhd);
  const pm = potMathFromOverview(o);
  const btc = o.pool.btcPriceUsd;

  // Your stake in the CURRENT pot (estimated from live hashrate × pot age).
  const userPhdThisRound = u.hashratePhs * o.potAge.days;
  const userWorkGThisRound = (userPhdThisRound * PHD_TO_DIFF) / 1e9;
  const stakeSats = stakeValue(userWorkGThisRound, pm.W);
  const stakeUsd = btc > 0 ? (stakeSats / 1e8) * btc : 0;
  const luck = odo.luckRatio >= 1.1 ? "🍀 luckier than expected" : odo.luckRatio <= 0.9 ? "🥲 below expectation" : "≈ on expectation";
  const luckClass = odo.luckRatio >= 1.1 ? "green" : odo.luckRatio <= 0.9 ? "red" : "amber";

  // ── achievements row ─────────────────────────────────────────────────────────
  const badges = u.badges ?? {};
  const badgeCells = BADGE_DEFS.map((b) => {
    const n = badges[b.key] ?? 0;
    const earned = n > 0;
    return `<div class="badge ${earned ? "on" : "off"}" title="${esc(b.name)} — ${esc(b.howto)}">
      <div class="badge-ic">${b.emoji}</div>
      <div class="badge-nm">${esc(b.name)}</div>
      <div class="badge-ct">${earned ? (n > 1 ? `×${fmtInt(n)}` : "✓") : "—"}</div>
    </div>`;
  }).join("");

  // ── rental spend ─────────────────────────────────────────────────────────────
  const hashprice = o.pool.hashpriceSatsPerPhd || 0;
  const delivered = (ord: { deliveredPhd?: number; requestedPhd: number; progressPercent: number }) =>
    ord.deliveredPhd ?? (ord.requestedPhd * ord.progressPercent) / 100;
  const totalDeliveredPhd = u.orders.reduce((s, ord) => s + delivered(ord), 0);
  const totalRequestedPhd = u.orders.reduce((s, ord) => s + ord.requestedPhd, 0);
  const spendSats = totalDeliveredPhd * hashprice;
  const spendUsd = btc > 0 ? (spendSats / 1e8) * btc : 0;
  const activeOrders = u.orders.filter((x) => x.status === "active").length;
  const lifetimeOrders = u.refineryOrderCount ?? u.orders.length;

  // ── charts data ──────────────────────────────────────────────────────────────
  const since14d = Date.now() - 14 * 86_400_000;
  const hrPoints = snaps
    .filter((s) => s.ts >= since14d)
    .sort((a, b) => a.ts - b.ts)
    .map((s) => ({ t: s.ts, v: Math.round(s.hashrate * 100) / 100 }));
  // include the live reading as the latest point
  hrPoints.push({ t: Date.now(), v: Math.round(u.hashratePhs * 100) / 100 });
  const diffPoints = (u.diffHistory ?? [])
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((d) => ({ t: d.ts, v: d.diff }));
  const chartData = jsonForScript({ hr: hrPoints, diff: diffPoints });
  const haveHrHistory = hrPoints.length >= 3;

  const shortAddr = `${address.slice(0, 14)}…${address.slice(-8)}`;

  const body = `
<div class="wallethead">
  <div class="wh-l">
    <div class="k">Wallet · Parasite mining stats</div>
    <h1 style="margin:4px 0 6px">${esc(shortAddr)}</h1>
    <div class="addr" style="word-break:break-all">${esc(address)}</div>
    ${u.lnAddress ? `<div class="muted-note" style="margin-top:4px">⚡ ${esc(u.lnAddress)}</div>` : ""}
  </div>
  <div class="wh-r">
    ${u.uptime ? `<span class="chip">up ${esc(u.uptime)}</span>` : ""}
    ${u.workers ? `<span class="chip">${fmtInt(u.workers)} workers</span>` : ""}
    <span class="chip ${u.hashratePhs > 0 ? "green" : "dim"}">${u.hashratePhs > 0 ? `${fmtHashrate(u.hashratePhs)} live` : "idle"}</span>
  </div>
</div>

<h2>🏆 Achievements</h2>
<div class="badges">${badgeCells}</div>
<p class="muted-note">Parasite badges this wallet has earned. Highlighted = earned (with count); dim = not yet. <a href="/board">See who holds the most →</a></p>

<div class="grid statrow" style="margin-top:22px">
  <div class="card"><div class="k">🥑 Cados won</div><div class="v green">${fmtInt(u.cadosWon ?? 0)}</div><div class="sub">10T+ shares that earned a Bravocado</div></div>
  <div class="card"><div class="k">🥇 Blocks found</div><div class="v">${fmtInt(u.blocksFound ?? 0)}</div><div class="sub">shares that solved a block</div></div>
  <div class="card"><div class="k">⛏️ Blocks contributed</div><div class="v">${fmtInt(u.blocksParticipated ?? 0)}</div><div class="sub">${u.blockCount ? `${fmtInt(u.blockCount)} lifetime shares` : "blocks landed a share in"}</div></div>
  <div class="card"><div class="k">🏭 Rental orders</div><div class="v">${fmtInt(lifetimeOrders)}</div><div class="sub">${activeOrders ? `${activeOrders} active now` : "lifetime Refinery orders"}</div></div>
</div>

<div class="grid statrow">
  <div class="card"><div class="k">Lifetime work</div><div class="v">${fmtPhd(odo.lifetimePhd)}</div><div class="sub">${fmtDiff(odo.totalWorkDiff)} total work</div></div>
  <div class="card"><div class="k">Best difficulty</div><div class="v">${fmtDiff(odo.bestDiff)}</div><div class="sub">${fmtPct(odo.bestDiffBlockPercent, 3)} of a block</div></div>
  <div class="card"><div class="k">Live hashrate</div><div class="v">${fmtHashrate(u.hashratePhs)}</div></div>
  <div class="card"><div class="k">Luck</div><div class="v ${luckClass}">${odo.luckRatio.toFixed(2)}×</div><div class="sub">${luck}</div></div>
</div>

<h2>Your stake in this pot</h2>
<div class="card" style="border-color:#33501f;background:#0d1408">
  <div class="k green">💰 Projected payout if the pot cracked right now</div>
  <div class="v green">${fmtInt(stakeSats)} sats${stakeUsd > 0 ? ` <span class="dim" style="font-size:20px">≈ ${fmtUsd(stakeUsd)}</span>` : ""}</div>
  <div class="sub">~${fmtInt(userWorkGThisRound)} G banked this round (${fmtHashrate(u.hashratePhs)} × ${fmtDuration(o.potAge.hours)} pot age) × ${fmtInt(pm.satsPerG)} sats/G — subsidy only, estimated from live hashrate. <a href="/potmath">what's a pot's depth? →</a></div>
</div>

<h2>📈 Hashrate — last 14 days</h2>
<div class="card">
  ${haveHrHistory
    ? `<div style="position:relative;height:240px"><canvas id="c_hr"></canvas></div>`
    : `<p class="muted-note" style="margin:6px 0">⏳ Parahawk is building this wallet's hashrate timeline from here on — Parasite doesn't publish per-wallet history, so it fills in as the wallet is polled. Check back. Live now: <span class="green">${fmtHashrate(u.hashratePhs)}</span>.</p>`}
</div>

<h2>⚡ Best share per block <span class="dim" style="font-size:13px">· recent</span></h2>
<div class="card">
  ${diffPoints.length >= 2
    ? `<div style="position:relative;height:240px"><canvas id="c_diff"></canvas></div>
       <p class="muted-note" style="margin:10px 0 0">Each point is this wallet's best share in a recent block (difficulty units). The 10T line is the Bravocado threshold.</p>`
    : `<p class="muted-note" style="margin:6px 0">No recent per-block shares reported for this wallet.</p>`}
</div>

<h2>🏭 Rental history &amp; spend</h2>
<div class="grid statrow">
  <div class="card"><div class="k">Estimated spend</div><div class="v">${fmtSats(spendSats)}</div><div class="sub">${spendUsd > 0 ? `≈ ${fmtUsd(spendUsd)} · ` : ""}~${Math.round(totalDeliveredPhd).toLocaleString("en-US")} PHd delivered @ live hashprice</div></div>
  <div class="card"><div class="k">Work ordered</div><div class="v">${Math.round(totalRequestedPhd).toLocaleString("en-US")}<small class="dim" style="font-size:15px"> PHd</small></div><div class="sub">${fmtInt(u.orders.length)} orders shown · ${fmtInt(lifetimeOrders)} lifetime</div></div>
  <div class="card"><div class="k">Delivered</div><div class="v">${totalRequestedPhd > 0 ? Math.round((totalDeliveredPhd / totalRequestedPhd) * 100) : 0}<small class="dim" style="font-size:15px">% fill</small></div><div class="sub">${activeOrders} active now</div></div>
</div>
<div class="tscroll" style="margin-top:12px"><table>
  <thead><tr><th>ID</th><th>Via</th><th>Status</th><th>Requested</th><th>Best share</th><th>Progress</th></tr></thead>
  <tbody>${orderRows(u.orders)}</tbody>
</table></div>
<p class="muted-note">Spend is an estimate: delivered PHd × the live Refinery hashprice (${fmtInt(hashprice)} sats/PHd) — Parasite doesn't publish the price each order actually paid.</p>

${
  u.rigs && u.rigs.length > 0
    ? `<h2>⛏️ Rigs${u.workers ? ` (${u.workers} workers` : ""}${u.uptime ? ` · up ${esc(u.uptime)}` : ""}${u.workers ? ")" : ""}</h2>
       <div class="tscroll"><table>
         <thead><tr><th>Worker</th><th>Hashrate</th><th>Best diff</th></tr></thead>
         <tbody>${u.rigs
           .map(
             (r) => `<tr>
               <td>${esc(r.name)}</td>
               <td class="${r.hashratePhs > 0 ? "" : "dim"}">${r.hashratePhs > 0 ? fmtHashrate(r.hashratePhs) : "idle"}</td>
               <td>${fmtDiff(r.bestDiff)}</td>
             </tr>`,
           )
           .join("")}</tbody>
       </table></div>`
    : ""
}

<h2>🔴 10T+ hits <span class="dim" style="font-size:13px">· observed by Parahawk</span></h2>
${
  hits.length === 0
    ? `<p class="muted-note">No 10T+ hits recorded live for this wallet yet — the Cados-won badge above is the authoritative all-time count.</p>`
    : `<div class="tscroll"><table>
        <thead><tr><th>When</th><th>Tier</th><th>Difficulty</th><th>Worker</th></tr></thead>
        <tbody>${hits
          .map(
            (x) => `<tr>
              <td class="dim">${esc(new Date(x.ts).toLocaleString("en-US"))}</td>
              <td class="${x.tier === "21T" ? "amber" : x.tier === "10T" ? "red" : "dim"}">${esc(x.tier)}</td>
              <td>${fmtDiff(x.difficulty)}</td>
              <td class="dim">${x.worker ? esc(x.worker) : "—"}</td>
            </tr>`,
          )
          .join("")}</tbody>
      </table></div>`
}

<h2>Badge odds at this much work</h2>
<div class="grid statrow">
  <div class="card"><div class="k">🥑 10T (Bravocado)</div><div class="v green">${pct(odds.tenTChance)}</div><div class="sub">P(≥1) at this much work</div></div>
  <div class="card"><div class="k">🏠 21T (homeminers)</div><div class="v amber">${pct(odds.twentyOneTChance)}</div><div class="sub">P(≥1) at this much work</div></div>
  <div class="card"><div class="k">🎰 Block</div><div class="v red">${pct(odds.blockChance)}</div><div class="sub">P(≥1) at this much work</div></div>
</div>
<p class="muted-note">Expected best difficulty for this much work: ~${fmtDiff(odo.expectedBestDiffMin)} – ${fmtDiff(odo.expectedBestDiffMax)} (1–1.5× total work). Observed best is ${odo.luckRatio.toFixed(2)}× the midpoint.</p>

<p class="muted-note" style="margin-top:18px">Public on-chain Parasite mining stats, best-effort. Achievement counts come straight from Parasite's account badges. Not financial advice.</p>

<style>
.wallethead{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:flex-start;border:1px solid var(--line);background:#0a0a0a;padding:20px 22px;margin-bottom:8px}
.wallethead .k{color:var(--dim);font-size:14px;text-transform:uppercase;letter-spacing:1.5px}
.wallethead .addr{color:var(--green);font-size:15px}
.wh-r{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.chip{border:1px solid var(--line);background:#0d0d0d;padding:5px 12px;font-size:14px;color:var(--dim);white-space:nowrap}
.chip.green{color:var(--green);border-color:#33501f}
.badges{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px}
.badge{border:1px solid var(--line);background:#0a0a0a;padding:14px 10px;text-align:center}
.badge.on{border-color:#33501f;background:#0d1408}
.badge.off{opacity:.4}
.badge-ic{font-size:34px;line-height:1}
.badge.off .badge-ic{filter:grayscale(1)}
.badge-nm{font-size:13px;color:#b7c9a6;margin-top:6px}
.badge.off .badge-nm{color:var(--dim)}
.badge-ct{font-size:15px;color:#fff;margin-top:2px}
.badge.off .badge-ct{color:var(--dim)}
.statrow{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.statrow .card .v{font-size:34px}
.tscroll{max-height:520px;overflow:auto;border:1px solid var(--line)}
.tscroll table{margin:0}
.tscroll thead th{position:sticky;top:0;background:#0d0d0d;z-index:1}
</style>
${
  haveHrHistory || diffPoints.length >= 2
    ? `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script>
const AD = ${chartData};
const GREEN="#8fd14f", DIM="#8a8a8a", LINE="#222", RED="#ff5c5c";
if (window.Chart) {
  Chart.defaults.color=DIM; Chart.defaults.borderColor=LINE; Chart.defaults.font.family="Consolas, monospace";
  const fmtT = (v)=> v>=1e12? (v/1e12).toFixed(1)+"T" : v>=1e9? (v/1e9).toFixed(0)+"G" : v;
  const hr = document.getElementById("c_hr");
  if (hr && AD.hr.length>=3) new Chart(hr, {
    type:"line",
    data:{ labels:AD.hr.map(p=>new Date(p.t).toLocaleDateString("en-US",{month:"short",day:"numeric"})),
      datasets:[{ data:AD.hr.map(p=>p.v), borderColor:GREEN, backgroundColor:"rgba(143,209,79,.08)", fill:true, tension:.25, pointRadius:0 }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{ ticks:{maxTicksLimit:8}, grid:{color:LINE} }, y:{ title:{display:true,text:"PH/s"}, grid:{color:LINE}, beginAtZero:true } } }
  });
  const df = document.getElementById("c_diff");
  if (df && AD.diff.length>=2) new Chart(df, {
    type:"line",
    data:{ labels:AD.diff.map(p=>new Date(p.t).toLocaleDateString("en-US",{month:"short",day:"numeric"})),
      datasets:[{ data:AD.diff.map(p=>p.v), borderColor:GREEN, backgroundColor:"rgba(143,209,79,.08)", fill:true, tension:.2, pointRadius:2, pointBackgroundColor:GREEN }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ x:{ ticks:{maxTicksLimit:8}, grid:{color:LINE} }, y:{ ticks:{callback:fmtT}, grid:{color:LINE}, beginAtZero:true, suggestedMax: 10e12 } } }
  });
}
</script>`
    : ""
}
`;

  return renderPage({ title: `Wallet ${address.slice(0, 10)}…`, active: "", body });
}
