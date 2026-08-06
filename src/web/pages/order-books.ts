import { renderPage } from "../layout.js";
import { getRefineryState } from "../../data/parasite.js";
import { fmtDiff, fmtHashrate, esc } from "../format.js";

/** A full bc1/3/1 address (Refinery) gets a link; masked ones don't. */
function addrCell(address: string): string {
  const masked = address.includes("...");
  const short = masked ? address : `${address.slice(0, 12)}…${address.slice(-4)}`;
  return masked ? `<span class="dim">${esc(short)}</span>` : `<a href="/address/${esc(address)}">${esc(short)}</a>`;
}

export async function renderOrderBooks(): Promise<string> {
  const refinery = await getRefineryState();

  const active = refinery.orders.filter((o) => o.status === "active");
  // provider breakdown across all orders
  const provCounts = new Map<string, number>();
  for (const o of refinery.orders) {
    const p = o.provider ?? "UNKNOWN";
    provCounts.set(p, (provCounts.get(p) ?? 0) + 1);
  }
  const provSummary = [...provCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${esc(p)} <span class="dim">${n}</span>`)
    .join(" · ");

  const orderRows =
    refinery.orders.length === 0
      ? `<tr><td colspan="7" class="dim">no orders (or Refinery data unavailable)</td></tr>`
      : refinery.orders
          .slice(0, 50)
          .map((o) => {
            const sc = o.status === "fulfilled" ? "green" : o.status === "expired" ? "red" : "amber";
            const addr = (o as { address?: string }).address ?? "";
            const prov = o.provider ?? "UNKNOWN";
            const provClass = prov === "Refinery" ? "green" : "dim";
            return `<tr>
              <td class="dim">${esc(o.id)}</td>
              <td>${addr ? addrCell(addr) : "<span class='dim'>—</span>"}</td>
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

<h2>⚙️ Refinery order book — ${active.length} active</h2>
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
<script>setTimeout(function(){location.reload();},45000);</script>
`;

  return renderPage({ title: "Order Books", active: "order books", body });
}
