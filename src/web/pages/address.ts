import { renderPage } from "../layout.js";
import { getUserStats } from "../../data/parasite.js";
import { getOverview } from "../../services/overview.js";
import { computeOdometer } from "../../math/work.js";
import { oddsForWork } from "../../math/odds.js";
import {
  fmtHashrate,
  fmtDiff,
  fmtPhd,
  fmtPct,
  esc,
} from "../format.js";

function isBc1(addr: string): boolean {
  return /^bc1[0-9a-z]{6,87}$/i.test(addr);
}

function pct(p: number): string {
  const v = p * 100;
  if (v >= 99.99) return "≈100%";
  if (v > 0 && v < 0.01) return "<0.01%";
  return `${v.toFixed(v < 1 ? 2 : 1)}%`;
}

function orderRows(orders: { id: string; status: string; requestedPhd: number; hashratePhs: number; bestShare: number; progressPercent: number }[]): string {
  if (orders.length === 0) return `<tr><td colspan="5" class="dim">no orders</td></tr>`;
  return orders
    .map((o) => {
      const statusColor = o.status === "fulfilled" ? "green" : o.status === "expired" ? "red" : "amber";
      return `<tr>
        <td>${esc(o.id)}</td>
        <td class="${statusColor}">${o.status}</td>
        <td>${o.requestedPhd} PHd</td>
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
      title: "Address",
      active: "",
      body: `<h1>Address</h1><p class="lead">"${esc(address)}" doesn't look like a bc1 address.</p><p><a href="/calc">Try the calculator →</a></p>`,
    });
  }

  const [o, u] = await Promise.all([getOverview(), getUserStats(address)]);
  const odo = computeOdometer(u.totalWorkDiff, u.bestDifficulty, o.pool.networkDifficulty);
  const odds = oddsForWork(odo.lifetimePhd);
  const luck = odo.luckRatio >= 1.1 ? "🍀 luckier than expected" : odo.luckRatio <= 0.9 ? "🥲 below expectation" : "≈ on expectation";
  const luckClass = odo.luckRatio >= 1.1 ? "green" : odo.luckRatio <= 0.9 ? "red" : "amber";

  const body = `
<h1>Odometer</h1>
<p class="lead" style="word-break:break-all">${esc(address)}</p>

<div class="grid">
  <div class="card"><div class="k">Lifetime work</div><div class="v">${fmtPhd(odo.lifetimePhd)}</div><div class="sub">${fmtDiff(odo.totalWorkDiff)} total work</div></div>
  <div class="card"><div class="k">Live hashrate</div><div class="v">${fmtHashrate(u.hashratePhs)}</div></div>
  <div class="card"><div class="k">Best difficulty</div><div class="v">${fmtDiff(odo.bestDiff)}</div><div class="sub">${fmtPct(odo.bestDiffBlockPercent, 3)} of a block</div></div>
  <div class="card"><div class="k">Luck</div><div class="v ${luckClass}">${odo.luckRatio.toFixed(2)}×</div><div class="sub">${luck}</div></div>
</div>

<h2>Badge progress</h2>
<div class="grid">
  <div class="card"><div class="k">🥑 10T (Bravocado)</div><div class="v green">${pct(odds.tenTChance)}</div><div class="sub">P(≥1) at this much work</div></div>
  <div class="card"><div class="k">🏠 21T (homeminers)</div><div class="v amber">${pct(odds.twentyOneTChance)}</div><div class="sub">P(≥1) at this much work</div></div>
  <div class="card"><div class="k">🎰 Block</div><div class="v red">${pct(odds.blockChance)}</div><div class="sub">P(≥1) at this much work</div></div>
</div>
<p class="muted-note">Expected best difficulty for this much work: ~${fmtDiff(odo.expectedBestDiffMin)} – ${fmtDiff(odo.expectedBestDiffMax)} (1–1.5× total work). Observed best is ${odo.luckRatio.toFixed(2)}× the midpoint.</p>

<h2>Refinery orders</h2>
<table>
  <tr><th>ID</th><th>Status</th><th>Requested</th><th>Best share</th><th>Progress</th></tr>
  ${orderRows(u.orders)}
</table>

<p class="muted-note" style="margin-top:18px">Public on-chain mining stats, best-effort. Not financial advice.</p>
`;

  return renderPage({ title: `Odometer ${address.slice(0, 10)}…`, active: "", body });
}
