import { renderPage } from "../layout.js";
import { config } from "../../config.js";
import { esc, timeAgo, fmtInt, fmtUsd } from "../format.js";
import { csrfToken, type Session } from "../../services/auth.js";
import {
  addressKey,
  getAllManualPrices,
  getPriceChanges,
  getPriceEditorBans,
  type PriceBan,
  type PriceChange,
} from "../../services/manual-prices.js";
import { isOwnerAddress } from "../../services/price-updates.js";
import { displayNamesFor, shortAddress } from "../../profile/names.js";
import { getOverview } from "../../services/overview.js";

/** Venues that take an admin-set manual price (no public feed). */
export const MANUAL_VENUES: Array<{ slug: string; name: string; hint: string }> = [
  { slug: "kissmyhash", name: "Kiss My Hash", hint: "On KMH, set 1 PH / 24h + Parasite and read the total — e.g. $38.04. Type that here." },
  { slug: "braiins", name: "Braiins", hint: "Only if/when Braiins Hashpower adds Parasite. Enter the USD total for a 1 PH / 24h quote." },
];

/** True when this session is the configured owner. */
export function isAdmin(session: Session | null): boolean {
  return Boolean(session && config.adminAddress && session.address.trim().toLowerCase() === config.adminAddress);
}

/** USD total for a 1 PH / 24h (= 1 PHd) order → sats/PHd at the given BTC price. */
export function usdPerPhdToSatsPerPhd(usd: number, btcPriceUsd: number): number {
  if (!(usd > 0) || !(btcPriceUsd > 0)) return 0;
  return (usd / btcPriceUsd) * 1e8;
}

/**
 * Owner-only: every change to a hand-typed price — yours and Trusted members'
 * (src/web/price-routes.ts) — newest first, with Revert, and Block for
 * whoever made it. Blocked wallets are listed underneath with Unblock.
 */
function renderPriceUpdatesSection(
  changes: PriceChange[],
  bans: PriceBan[],
  names: Map<string, string>,
  csrf: string,
): string {
  const venueName = (slug: string) => MANUAL_VENUES.find((v) => v.slug === slug)?.name ?? slug;
  const blocked = new Set(bans.map((b) => addressKey(b.address)));
  const who = (addr: string) =>
    isOwnerAddress(addr)
      ? `<span class="green">you</span>`
      : `${names.get(addr) ? `${esc(names.get(addr)!)} ` : ""}<span class="dim" title="${esc(addr)}">${esc(shortAddress(addr))}</span>`;
  const sats = (n: number | null) => (n == null || n <= 0 ? `<span class="dim">none</span>` : fmtInt(n));
  const form = (action: string, label: string, address?: string) =>
    `<form method="POST" action="${action}" style="display:inline;margin:0 4px 0 0"><input type="hidden" name="csrf" value="${esc(csrf)}"/>${
      address ? `<input type="hidden" name="address" value="${esc(address)}"/>` : ""
    }<button type="submit" style="padding:3px 10px;font-size:13px">${label}</button></form>`;

  const rows = changes
    .map((c) => {
      const isBlocked = blocked.has(addressKey(c.by));
      const actions = [
        c.kind === "update" ? form(`/api/prices/history/${encodeURIComponent(c.id)}/revert`, "Revert") : "",
        !isOwnerAddress(c.by) && !isBlocked ? form("/api/prices/bans", "Block", c.by) : "",
      ].join("");
      return `<tr>
  <td>${timeAgo(c.at)}</td>
  <td>${esc(venueName(c.venue))}</td>
  <td>${sats(c.oldSats)} → <strong>${sats(c.newSats)}</strong> <span class="dim">sats/PHd${c.usd != null ? ` · $${c.usd.toFixed(2)}` : ""}${c.kind === "revert" ? " · put back" : ""}</span></td>
  <td>${who(c.by)}${isBlocked ? ` <span class="red">blocked</span>` : ""}</td>
  <td style="white-space:nowrap">${actions}</td>
</tr>`;
    })
    .join("");

  const banList = bans.length
    ? `<ul style="margin:8px 0 0;padding-left:20px">${bans
        .map((b) => `<li style="margin:6px 0">${who(b.address)} <span class="dim">· blocked ${timeAgo(b.at)}</span> ${form("/api/prices/bans/remove", "Unblock", b.address)}</li>`)
        .join("")}</ul>`
    : `<p class="dim" style="margin:6px 0 0">Nobody.</p>`;

  return `
<h2>Community price updates</h2>
<p class="lead">Members with the <strong>Trusted</strong> badge can update a stale hand-typed price from the Marketplace. Every change — theirs and yours — is listed here. <strong>Revert</strong> puts back the price it replaced; <strong>Block</strong> stops that wallet editing prices (it keeps its badge).</p>
${changes.length
    ? `<div class="card" style="padding:0;overflow-x:auto;margin-bottom:16px"><table style="margin:0">
  <thead><tr><th>When</th><th>Venue</th><th>Change</th><th>Who</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`
    : `<div class="card" style="margin-bottom:16px"><span class="dim">No price changes logged yet.</span></div>`}
<h3 style="margin:0">Blocked from editing prices</h3>
${banList}`;
}

export interface AdminPageOptions {
  /**
   * Just the price tools, no site header — the Admin window's Prices tab
   * (src/shell/apps/admin.ts). Traffic and the rest of the owner's numbers live
   * in that window now.
   */
  bare?: boolean;
}

export async function renderAdmin(session: Session | null, msg?: string, opts: AdminPageOptions = {}): Promise<string> {
  const bare = opts.bare === true;
  if (!isAdmin(session)) {
    const why = !session
      ? `Connect the owner wallet on the <a href="/account">Account</a> page first.`
      : !config.adminAddress
        ? `No owner is configured yet (set <code>ADMIN_ADDRESS</code>).`
        : `This wallet isn't the owner.`;
    const body = `<h1>Admin</h1><p class="lead">Owner-only.</p><div class="card" style="max-width:620px">${why}</div>`;
    return renderPage({ title: "Admin", active: "", body, bare });
  }

  const [prices, overview, priceChanges, priceBans] = await Promise.all([
    getAllManualPrices().catch(() => []),
    getOverview().catch(() => null),
    getPriceChanges({ limit: 30 }).catch(() => [] as PriceChange[]),
    getPriceEditorBans().catch(() => [] as PriceBan[]),
  ]);
  const btc = overview?.pool.btcPriceUsd ?? 0;
  const byVenue = new Map(prices.map((p) => [p.venue, p]));
  const csrf = csrfToken(session!.address);
  const editorNames = await displayNamesFor([...priceChanges.map((c) => c.by), ...priceBans.map((b) => b.address)])
    .catch(() => new Map<string, string>());

  const flash = msg
    ? `<div class="stale" style="background:#0c1408;border-color:#2c4a1c;color:#c7f59a">${esc(msg === "saved" ? "✅ Price updated." : msg)}</div>`
    : "";

  const cards = MANUAL_VENUES.map((v) => {
    const cur = byVenue.get(v.slug);
    const curUsd = cur && btc > 0 ? (cur.satsPerPhd / 1e8) * btc : 0;
    const currentLine = cur
      ? `Current: <strong>${fmtInt(cur.satsPerPhd)} sats/PHd</strong>${btc > 0 ? ` <span class="dim">≈ ${fmtUsd(curUsd)}/PHd</span>` : ""} <span class="dim">· updated ${timeAgo(cur.updatedAt)}</span>`
      : `<span class="dim">no manual price set</span>`;
    return `
<div class="card">
  <h3 style="margin-top:0">${esc(v.name)}</h3>
  <div style="margin-bottom:10px">${currentLine}</div>
  <p class="muted-note" style="font-size:14px">${esc(v.hint)}</p>
  <form method="POST" action="/admin/price" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
    <input type="hidden" name="csrf" value="${esc(csrf)}"/>
    <input type="hidden" name="venue" value="${esc(v.slug)}"/>
    <label class="dim" style="font-size:13px;display:flex;flex-direction:column;gap:4px">USD total (1 PH / 24h)
      <input type="number" name="usd" min="0.01" step="0.01" value="${curUsd > 0 ? curUsd.toFixed(2) : ""}" placeholder="38.04" required style="width:160px" data-usd/></label>
    <button type="submit">Save</button>
    <span class="dim conv" style="font-size:14px">= — sats/PHd</span>
  </form>
</div>`;
  }).join("");

  const body = `
<h1>${bare ? "Prices" : "Admin"}</h1>
<p class="lead">Enter what a venue's <strong>1 PH / 24h</strong> quote costs in USD; Parahawk converts to sats/PHd at the live BTC price (${btc > 0 ? fmtUsd(btc) : "—"}) and shows it on the board as <strong>"manual · updated Xm ago"</strong>.</p>
${flash}
<div class="card" style="max-width:640px;margin-bottom:22px">Signed in as owner <span class="green" style="word-break:break-all">${esc(session!.address)}</span></div>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">${cards}</div>
${renderPriceUpdatesSection(priceChanges, priceBans, editorNames, csrf)}
<script>
(function(){
  var BTC = ${btc > 0 ? btc : 0};
  function upd(inp){
    var f = inp.closest('form'); var out = f.querySelector('.conv');
    var usd = Number(inp.value)||0;
    out.textContent = (usd>0 && BTC>0) ? ('= '+Math.round(usd/BTC*1e8).toLocaleString('en-US')+' sats/PHd') : '= — sats/PHd';
  }
  document.querySelectorAll('[data-usd]').forEach(function(inp){ inp.addEventListener('input',function(){upd(inp);}); upd(inp); });
})();
</script>
`;
  return renderPage({ title: "Admin", active: "", body, bare });
}
