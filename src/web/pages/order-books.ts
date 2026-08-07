import { renderPage } from "../layout.js";
import { getRouterOrders } from "../../data/parasite.js";
import { getOverview } from "../../services/overview.js";
import { getAddressResolver } from "../../services/winners.js";
import { walletCell } from "../addr.js";
import {
  fmtDiff,
  fmtHashrate,
  fmtInt,
  fmtSats,
  fmtUsd,
  fmtPhd,
  fmtPct,
  esc,
} from "../format.js";

/** deliveredPhd × live hashprice → spend in sats, plus its USD value. */
function spendFor(
  deliveredPhd: number,
  hashpriceSatsPerPhd: number,
  btcPriceUsd: number,
): { sats: number; usd: number } {
  const sats = deliveredPhd * hashpriceSatsPerPhd;
  return { sats, usd: (sats / 1e8) * btcPriceUsd };
}

export async function renderOrderBooks(): Promise<string> {
  const [orders, overview, resolve] = await Promise.all([
    getRouterOrders(),
    getOverview(),
    getAddressResolver().catch(() => (() => null) as (m: string) => string | null),
  ]);

  const poolPhs = overview.pool.poolHashratePhs;
  const hashprice = overview.pool.hashpriceSatsPerPhd;
  const btcPrice = overview.pool.btcPriceUsd;

  const active = orders.filter((o) => o.status === "active");
  const fulfilled = orders.filter((o) => o.status === "fulfilled");
  const expired = orders.filter((o) => o.status === "expired");

  // ── 1. rental demand gauge ──────────────────────────────────────────────────
  const rentedPhs = active.reduce((a, o) => a + o.hashratePhs, 0);
  const requestedActivePhd = active.reduce((a, o) => a + o.requestedPhd, 0);
  const pctRented = poolPhs > 0 ? (rentedPhs / poolPhs) * 100 : 0;

  // ── 2. biggest active renters (grouped by address) ──────────────────────────
  interface Renter {
    address: string;
    orders: number;
    requestedPhd: number;
    deliveredPhd: number;
    hashratePhs: number;
  }
  const byAddr = new Map<string, Renter>();
  for (const o of active) {
    const addr = o.address || "unknown";
    const r =
      byAddr.get(addr) ??
      { address: addr, orders: 0, requestedPhd: 0, deliveredPhd: 0, hashratePhs: 0 };
    r.orders += 1;
    r.requestedPhd += o.requestedPhd;
    r.deliveredPhd += o.deliveredPhd ?? 0;
    r.hashratePhs += o.hashratePhs;
    byAddr.set(addr, r);
  }
  const topRenters = [...byAddr.values()]
    .sort((a, b) => b.hashratePhs - a.hashratePhs || b.requestedPhd - a.requestedPhd)
    .slice(0, 15);

  const renterRows =
    topRenters.length === 0
      ? `<tr><td colspan="6" class="dim">no active renters right now</td></tr>`
      : topRenters
          .map((r, i) => {
            const spend = spendFor(r.deliveredPhd, hashprice, btcPrice);
            return `<tr>
              <td class="dim">${i + 1}</td>
              <td>${walletCell(r.address, resolve)}</td>
              <td class="dim">${fmtInt(r.orders)}</td>
              <td>${fmtHashrate(r.hashratePhs)}</td>
              <td>${fmtPhd(r.requestedPhd)} <span class="dim">/ ${fmtPhd(r.deliveredPhd)} del</span></td>
              <td>${fmtSats(spend.sats)} <span class="dim">· ${fmtUsd(spend.usd)}</span></td>
            </tr>`;
          })
          .join("");

  // ── 3. fill & flow stats ────────────────────────────────────────────────────
  const totalRequested = orders.reduce((a, o) => a + o.requestedPhd, 0);
  const totalDelivered = orders.reduce((a, o) => a + (o.deliveredPhd ?? 0), 0);
  const fillRate = totalRequested > 0 ? (totalDelivered / totalRequested) * 100 : 0;
  const avgOrderPhd = orders.length > 0 ? totalRequested / orders.length : 0;

  // ── existing order book table (unchanged behaviour) ─────────────────────────
  const provCounts = new Map<string, number>();
  for (const o of orders) {
    const p = o.provider ?? "UNKNOWN";
    provCounts.set(p, (provCounts.get(p) ?? 0) + 1);
  }
  const provSummary = [...provCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${esc(p)} <span class="dim">${n}</span>`)
    .join(" · ");

  const orderRows =
    orders.length === 0
      ? `<tr><td colspan="7" class="dim">no orders (or Refinery data unavailable)</td></tr>`
      : orders
          .slice(0, 50)
          .map((o) => {
            const sc = o.status === "fulfilled" ? "green" : o.status === "expired" ? "red" : "amber";
            const addr = o.address ?? "";
            const prov = o.provider ?? "UNKNOWN";
            const provClass = prov === "Refinery" ? "green" : "dim";
            return `<tr>
              <td class="dim">${esc(o.id)}</td>
              <td>${addr ? walletCell(addr, resolve) : "<span class='dim'>—</span>"}</td>
              <td class="${provClass}">${esc(prov)}</td>
              <td class="${sc}">${o.status}</td>
              <td>${fmtHashrate(o.hashratePhs)}</td>
              <td>${fmtDiff(o.bestShare)}</td>
              <td><div class="bar"><span style="width:${Math.min(100, o.progressPercent)}%"></span></div> ${o.progressPercent}%</td>
            </tr>`;
          })
          .join("");

  const body = `
<h1>Order Books</h1>
<p class="lead">Live rental orders routed into the Parasite Pool via parasite.space's Refinery. Auto-refreshes every 45s.</p>

<div class="stale" style="background:#1a1400;border-color:#50411f;color:#f5e0a0">
  Only <strong>Refinery</strong> orders are identifiable in Parasite's public data. KMH (<a href="https://app.kissmyhash.com" target="_blank" rel="noopener">Kiss My Hash</a>) and direct hardware rentals can't be split out — KMH is login-gated and routes hashrate as ordinary workers — so there's no separate KMH book to show here.
</div>

<h2>📈 Rental demand</h2>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
  <div class="card"><div class="k">Live rented hashrate</div><div class="v">${fmtHashrate(rentedPhs)}</div><div class="sub">summed across ${fmtInt(active.length)} active order${active.length === 1 ? "" : "s"}</div></div>
  <div class="card"><div class="k">Share of the pool</div><div class="v">${fmtPct(pctRented)}</div><div class="sub">${fmtPct(pctRented)} of the pool is rented right now (pool ${fmtHashrate(poolPhs)})</div></div>
  <div class="card"><div class="k">Requested in the active book</div><div class="v">${fmtPhd(requestedActivePhd)}</div><div class="sub">total PHd requested across open orders</div></div>
</div>

<h2 style="margin-top:26px">🐋 Biggest active renters</h2>
<p class="muted-note">Active orders grouped by wallet — who's pulling the most hashrate right now. Estimated spend is delivered PHd × the live hashprice (${fmtSats(hashprice)}/PHd). Addresses link to each miner's odometer.</p>
<div class="tscroll"><table>
  <thead><tr><th>#</th><th>Address</th><th>Orders</th><th>Live hashrate</th><th>Requested / delivered</th><th>Est. spend (delivered)</th></tr></thead>
  <tbody>${renterRows}</tbody>
</table></div>

<h2 style="margin-top:26px">🔀 Fill &amp; flow</h2>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
  <div class="card"><div class="k">Order states</div><div class="v"><span class="amber">${fmtInt(active.length)}</span> <span class="dim" style="font-size:20px">active</span></div><div class="sub"><span class="green">${fmtInt(fulfilled.length)}</span> fulfilled · <span class="red">${fmtInt(expired.length)}</span> expired · ${fmtInt(orders.length)} total</div></div>
  <div class="card"><div class="k">Overall fill rate</div><div class="v">${fmtPct(fillRate)}</div><div class="sub">Σ delivered ${fmtPhd(totalDelivered)} / Σ requested ${fmtPhd(totalRequested)}</div></div>
  <div class="card"><div class="k">Average order size</div><div class="v">${fmtPhd(avgOrderPhd)}</div><div class="sub">mean requested PHd per order</div></div>
</div>

<h2 style="margin-top:26px">⚙️ Refinery order book — ${active.length} active</h2>
<p class="muted-note">Addresses are full here, so they link to each miner's odometer. <strong>Via</strong>: ${provSummary || "—"}.</p>
<table>
  <tr><th>ID</th><th>Address</th><th>Via</th><th>Status</th><th>Hashrate</th><th>Best share</th><th>Progress</th></tr>
  ${orderRows}
</table>

<p class="muted-note" style="margin-top:18px">
  <strong>Via = Refinery</strong> only when we can prove it — the worker connected through parasite.space's Refinery (the <code>.refinery</code> suffix). Everything else is <strong>UNKNOWN</strong>: other rental proxies,
  <a href="https://app.kissmyhash.com" target="_blank" rel="noopener">Kiss My Hash</a>, or direct hardware all look the same in Parasite's public data (KMH is login-gated and routes hashrate as ordinary workers), so we don't guess.
</p>
<p class="muted-note">Refinery order addresses are public. Not financial advice.</p>

<style>
.tscroll{max-height:520px;overflow-y:auto;border:1px solid var(--line)}
.tscroll table{margin:0}
.tscroll thead th{position:sticky;top:0;background:#0d0d0d;z-index:1}
.tscroll::-webkit-scrollbar{width:8px}
.tscroll::-webkit-scrollbar-thumb{background:#222;border-radius:4px}
</style>
<script>setTimeout(function(){location.reload();},45000);</script>
`;

  return renderPage({ title: "Order Books", active: "order books", body });
}
