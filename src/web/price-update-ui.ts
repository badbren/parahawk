/**
 * The Marketplace's hand-typed price rows: who last set the price, and — for a
 * visitor with the "Trusted" badge, or the owner — a small "Update price" box
 * that posts to /api/prices (src/web/price-routes.ts). Signed-in visitors
 * without the badge see one line saying it exists.
 *
 * marketplace.ts calls manualPriceUi() once per render, row() for each board
 * row, and puts `tail` (styles + the box's script) at the end of the page.
 */
import { esc, timeAgo } from "./format.js";
import { csrfToken, type Session } from "../services/auth.js";
import { getAllManualPrices, isPriceEditorBanned, type ManualPrice } from "../services/manual-prices.js";
import { COMMUNITY_VENUES, isOwnerAddress } from "../services/price-updates.js";
import { permissionsFor } from "../activity/permissions.js";
import { displayNamesFor, shortAddress } from "../profile/names.js";
import { MANUAL_VENUES, isAdmin } from "./pages/admin.js";

export interface ManualPriceUi {
  /** Extra lines for a board row's venue cell — "" for rows that aren't hand-typed. */
  row(r: { slug: string; source: string }): string;
  /** Styles + the box's script, for the end of the page. */
  tail: string;
}

const STYLE = `<style>
.pu-meta b{color:var(--fg);font-weight:normal}
details.pu{margin-top:6px;font-size:14px;text-transform:none;letter-spacing:0}
details.pu summary{cursor:pointer;color:var(--green);display:inline-block}
details.pu[open] summary{margin-bottom:6px}
.pu-form{display:flex;flex-wrap:wrap;gap:8px;align-items:end;border:1px solid var(--line);background:#070707;padding:10px 12px;max-width:360px}
.pu-form label{display:flex;flex-direction:column;gap:4px;color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.5px}
.pu-form input{width:120px;font-size:15px}
.pu-hint{margin:0;flex-basis:100%;color:var(--dim);font-size:13px;line-height:1.4}
.pu-conv{font-size:13px}
.pu-msg{flex-basis:100%;font-size:13px;min-height:1em}
.pu-lock{font-size:12px}
</style>`;

const SCRIPT = `<script>
(function(){
  document.querySelectorAll('form.pu-form').forEach(function(f){
    var inp=f.querySelector('input[name=usd]'), out=f.querySelector('.pu-conv'), msg=f.querySelector('.pu-msg'), btn=f.querySelector('button');
    var BTC=Number(f.getAttribute('data-btc'))||0;
    function conv(){ var u=Number(inp.value)||0; out.textContent=(u>0&&BTC>0)?('= '+Math.round(u/BTC*1e8).toLocaleString('en-US')+' sats/PHd'):''; }
    function say(t,cls){ msg.textContent=t; msg.className='pu-msg '+cls; }
    inp.addEventListener('input',conv); conv();
    f.addEventListener('submit',function(e){
      e.preventDefault(); btn.disabled=true; say('Saving…','dim');
      fetch('/api/prices/'+encodeURIComponent(f.getAttribute('data-venue')),{
        method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({usd:Number(inp.value), csrf:f.getAttribute('data-csrf')})
      }).then(function(r){ return r.json().then(function(j){return {ok:r.ok,j:j};},function(){return {ok:r.ok,j:{}};}); })
        .then(function(x){
          if(x.ok){ say('Saved — thanks! Refreshing…','green'); setTimeout(function(){location.reload();},900); return; }
          say((x.j&&x.j.error)||'Couldn\\'t save that — try again.','red'); btn.disabled=false;
        })
        .catch(function(){ say('Couldn\\'t reach Parahawk — try again.','red'); btn.disabled=false; });
    });
  });
})();
</script>`;

export async function manualPriceUi(session: Session | null, btcPriceUsd: number): Promise<ManualPriceUi> {
  const prices = await getAllManualPrices().catch(() => [] as ManualPrice[]);
  const byVenue = new Map(prices.map((p) => [p.venue, p]));
  const setters = prices.map((p) => p.updatedBy).filter((a): a is string => typeof a === "string" && a !== "" && !isOwnerAddress(a));
  const names = setters.length > 0 ? await displayNamesFor(setters).catch(() => new Map<string, string>()) : new Map<string, string>();

  let canEdit = false;
  if (session) {
    if (isAdmin(session)) {
      canEdit = true;
    } else {
      const [banned, perms] = await Promise.all([
        isPriceEditorBanned(session.address).catch(() => true),
        permissionsFor(session.address, { admin: false }),
      ]);
      canEdit = !banned && perms.has("edit_prices");
    }
  }
  const csrf = session ? csrfToken(session.address) : "";
  const who = (addr: string) => (isOwnerAddress(addr) ? "the owner" : `<b>${esc(names.get(addr) ?? shortAddress(addr))}</b>`);

  const row = (r: { slug: string; source: string }): string => {
    const venue = MANUAL_VENUES.find((v) => v.slug === r.slug);
    if (!venue || r.source !== "manual") return "";
    const p = byVenue.get(venue.slug);
    const meta = p
      ? `<div class="dim vnote pu-meta">updated ${timeAgo(p.updatedAt)}${p.updatedBy ? ` by ${who(p.updatedBy)}` : ""}</div>`
      : "";
    if (!COMMUNITY_VENUES.has(venue.slug)) return meta;
    if (canEdit) {
      const curUsd = p && btcPriceUsd > 0 ? (p.satsPerPhd / 1e8) * btcPriceUsd : 0;
      return `${meta}<details class="pu"><summary>Update price</summary>
  <form class="pu-form" data-venue="${esc(venue.slug)}" data-csrf="${esc(csrf)}" data-btc="${btcPriceUsd > 0 ? btcPriceUsd : 0}">
    <p class="pu-hint">${esc(venue.hint)}</p>
    <label>USD total (1 PH / 24h)
      <input type="number" name="usd" min="0.01" step="0.01" inputmode="decimal" required value="${curUsd > 0 ? curUsd.toFixed(2) : ""}" placeholder="38.04"/></label>
    <button type="submit">Save</button>
    <span class="dim pu-conv"></span>
    <div class="pu-msg" role="status" aria-live="polite"></div>
  </form></details>`;
    }
    return session
      ? `${meta}<div class="dim vnote pu-lock">🔒 Members with the Trusted badge can update this price when it's out of date.</div>`
      : meta;
  };

  return { row, tail: STYLE + (canEdit ? SCRIPT : "") };
}
