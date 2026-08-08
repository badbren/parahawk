import { renderPage } from "../layout.js";
import { config } from "../../config.js";
import { esc, timeAgo, fmtInt } from "../format.js";
import { csrfToken, type Session } from "../../services/auth.js";
import { getAllManualPrices } from "../../services/manual-prices.js";

/** Venues that take an admin-set manual price (no public feed). */
export const MANUAL_VENUES: Array<{ slug: string; name: string; hint: string }> = [
  { slug: "kissmyhash", name: "Kiss My Hash", hint: "Log in, get a 1 PH / 24h quote for Parasite, and enter the BTC/PH/day × 100,000,000 as sats/PHd (e.g. 0.00058638 → 58638)." },
  { slug: "braiins", name: "Braiins", hint: "Only if/when Braiins Hashpower adds Parasite. Enter their USD/TH/day converted to sats/PHd." },
];

/** True when this session is the configured owner. */
export function isAdmin(session: Session | null): boolean {
  return Boolean(session && config.adminAddress && session.address.trim().toLowerCase() === config.adminAddress);
}

export async function renderAdmin(session: Session | null, msg?: string): Promise<string> {
  // Not the owner → don't even hint at the controls.
  if (!isAdmin(session)) {
    const why = !session
      ? `Connect the owner wallet on the <a href="/account">Account</a> page first.`
      : !config.adminAddress
        ? `No owner is configured yet (set <code>ADMIN_ADDRESS</code>).`
        : `This wallet isn't the owner.`;
    const body = `<h1>Admin</h1><p class="lead">Owner-only.</p><div class="card" style="max-width:620px">${why}</div>`;
    return renderPage({ title: "Admin", active: "", body });
  }

  const prices = await getAllManualPrices().catch(() => []);
  const byVenue = new Map(prices.map((p) => [p.venue, p]));
  const csrf = csrfToken(session!.address);

  const flash = msg
    ? `<div class="stale" style="background:#0c1408;border-color:#2c4a1c;color:#c7f59a">${esc(msg === "saved" ? "✅ Price updated." : msg)}</div>`
    : "";

  const cards = MANUAL_VENUES.map((v) => {
    const cur = byVenue.get(v.slug);
    const currentLine = cur
      ? `Current: <strong>${fmtInt(cur.satsPerPhd)} sats/PHd</strong> <span class="dim">· updated ${timeAgo(cur.updatedAt)}</span>`
      : `<span class="dim">no manual price set</span>`;
    return `
<div class="card">
  <h3 style="margin-top:0">${esc(v.name)}</h3>
  <div style="margin-bottom:10px">${currentLine}</div>
  <p class="muted-note" style="font-size:14px">${esc(v.hint)}</p>
  <form method="POST" action="/admin/price" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
    <input type="hidden" name="csrf" value="${esc(csrf)}"/>
    <input type="hidden" name="venue" value="${esc(v.slug)}"/>
    <label class="dim" style="font-size:13px;display:flex;flex-direction:column;gap:4px">sats/PHd
      <input type="number" name="sats" min="1" step="1" value="${cur ? Math.round(cur.satsPerPhd) : ""}" required style="width:180px"/></label>
    <button type="submit">Save</button>
  </form>
</div>`;
  }).join("");

  const body = `
<h1>Admin</h1>
<p class="lead">Set prices for venues with no public feed. They show on the board as <strong>"manual · updated Xm ago"</strong> — honest, never dressed up as live.</p>
${flash}
<div class="card" style="max-width:620px;margin-bottom:22px">Signed in as owner <span class="green" style="word-break:break-all">${esc(session!.address)}</span></div>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">${cards}</div>
`;
  return renderPage({ title: "Admin", active: "", body });
}
