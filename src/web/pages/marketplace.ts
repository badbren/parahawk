import { renderPage } from "../layout.js";
import { getMarketBoard, type BoardRow } from "../../data/venues/index.js";
import { wizardSection } from "../marketplace-wizard.js";
import { fmtSats, fmtUsd, fmtInt, timeAgo, esc } from "../format.js";
import { csrfToken, type Session } from "../../services/auth.js";
import { getLinkedAccounts } from "../../services/linked.js";

/** Verdict chip: 🟢 good ≤52k · ⚪ normal 52–58k · 🔴 expensive >58k. */
function verdictChip(row: BoardRow): string {
  if (row.satsPerPhd <= 0) return `<span class="dim">—</span>`;
  const map = {
    good: ["🟢", "green", "good"],
    normal: ["⚪", "dim", "fair"],
    expensive: ["🔴", "red", "pricey"],
  } as const;
  const [dot, cls, label] = map[row.verdict];
  return `<span class="${cls}">${dot} ${label}</span>`;
}

/** How the price was obtained + how fresh, stated honestly. */
function sourceCell(row: BoardRow): string {
  if (row.error) {
    return `<span class="red">unreachable</span>${
      row.fetchedAt ? ` <span class="dim">· cached ${timeAgo(row.fetchedAt)}</span>` : ""
    }`;
  }
  const kind =
    row.source === "api"
      ? `<span class="green">API</span>`
      : row.source === "scraped"
        ? `<span class="amber">scraped</span>`
        : `<span class="amber">manual</span>`;
  const fresh = row.live ? "live" : row.fetchedAt ? timeAgo(row.fetchedAt) : "—";
  return `${kind} <span class="dim">· ${fresh}</span>`;
}

function priceCell(row: BoardRow): string {
  if (row.satsPerPhd <= 0) {
    return `<span class="dim">no price</span>`;
  }
  return `<strong>${fmtInt(row.satsPerPhd)}</strong> <span class="dim">sats</span>`;
}

/** "cheaper/dearer than Refinery" delta for a row. */
function vsRefineryCell(row: BoardRow): string {
  if (row.satsPerPhd <= 0 || row.slug === "refinery") return `<span class="dim">—</span>`;
  const d = Math.round(row.vsRefinerySats);
  if (d > 0) return `<span class="green">−${fmtInt(d)}/PHd</span>`;
  if (d < 0) return `<span class="red">+${fmtInt(-d)}/PHd</span>`;
  return `<span class="dim">±0</span>`;
}

export async function renderMarketplace(session: Session | null = null): Promise<string> {
  const board = await getMarketBoard();
  const linked = session ? await getLinkedAccounts(session.address).catch(() => []) : [];
  const wizardCtx = {
    connected: Boolean(session),
    linkedVenues: linked.map((l) => l.venue),
    csrf: session ? csrfToken(session.address) : "",
  };

  const rows = board.rows
    .map((r) => {
      const badge = r.best
        ? ` <span class="badge-best">BEST PRICE</span>`
        : "";
      const soloBadge = !r.canTargetParasite
        ? ` <span class="badge-solo">no Parasite route</span>`
        : "";
      const nameCell = r.url && r.url !== "#"
        ? `<a href="${esc(r.url)}" target="_blank" rel="noopener nofollow">${esc(r.venue)}</a>`
        : esc(r.venue);
      const note = r.note ? `<div class="dim vnote">${esc(r.note)}</div>` : "";
      const cap = r.capacityPhd ? `${r.capacityPhd.toFixed(1)} PHd` : "—";
      const rowCls = r.best ? ' class="best-row"' : r.satsPerPhd <= 0 ? ' class="dead-row"' : "";
      return `<tr${rowCls}>
        <td>${nameCell}${badge}${soloBadge}${note}</td>
        <td>${priceCell(r)}</td>
        <td>${r.usdPerPhd > 0 ? fmtUsd(r.usdPerPhd, 2) : "<span class='dim'>—</span>"}</td>
        <td>${cap}</td>
        <td>${sourceCell(r)}</td>
        <td>${vsRefineryCell(r)}</td>
        <td>${verdictChip(r)}</td>
      </tr>`;
    })
    .join("");

  // ── Savings headline: cheapest Parasite-capable venue vs the Refinery baseline,
  //    sized against a reference order so the number is concrete. ───────────────
  const best = board.best;
  const REF_ORDER_PHD = 25; // "if you rented 25 PHd today…"
  const savingsPerPhd = best ? board.refinerySatsPerPhd - best.satsPerPhd : 0;
  const savingsForOrder = Math.max(0, savingsPerPhd) * REF_ORDER_PHD;

  const headline =
    best && best.slug !== "refinery" && savingsPerPhd > 0
      ? `<div class="save-hero">
           <div class="k">Cheapest right now</div>
           <div class="v"><a href="${esc(best.url)}" target="_blank" rel="noopener nofollow">${esc(best.venue)}</a> @ ${fmtInt(best.satsPerPhd)} sats/PHd</div>
           <div class="sub">
             That's <span class="green">${fmtInt(savingsPerPhd)} sats/PHd cheaper than Refinery</span>
             (${fmtInt(board.refinerySatsPerPhd)}). Rent 25 PHd through it and you'd save
             <span class="green">≈ ${fmtSats(savingsForOrder)}</span> vs going straight to Refinery.
           </div>
         </div>`
      : best
        ? `<div class="save-hero">
             <div class="k">Cheapest right now</div>
             <div class="v"><a href="${esc(best.url)}" target="_blank" rel="noopener nofollow">${esc(best.venue)}</a> @ ${fmtInt(best.satsPerPhd)} sats/PHd</div>
             <div class="sub">Refinery is the best price on the board today — no cheaper venue beats it right now.</div>
           </div>`
        : "";

  const body = `
<h1>Marketplace</h1>
<p class="lead">Every hashrate rental venue, one price. Parahawk normalizes each to <strong>sats/PHd</strong> so you can see — at a glance — who's cheapest, then rent from your own account and point it straight at Parasite. We're a price router, never a wallet. Auto-refreshes every 60s.</p>

<p style="margin:-8px 0 18px"><a href="/order-books">📖 Live Refinery order book →</a> <span class="dim">— see who's renting into the pot right now.</span></p>

<div class="promise">🔒 <strong>Non-custodial, always.</strong> Parahawk never holds your funds. You rent from your own venue account with your own balance; we just find you the best price and help you aim it at the pot.</div>

${headline}

<h2>💹 Live price board</h2>
<table class="board">
  <thead><tr>
    <th>Venue</th><th>Price</th><th>USD/PHd</th><th>Capacity</th><th>Source</th><th>vs Refinery</th><th>Verdict</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>

<p class="muted-note" style="margin-top:14px">
  Baseline for the verdict chips is the ~50k sats/PHd fair value: <span class="green">🟢 ≤52k good</span> ·
  <span class="dim">⚪ 52–58k fair</span> · <span class="red">🔴 &gt;58k pricey</span>.
  Every row shows <strong>how</strong> its price was obtained (API / scraped / manual) and <strong>when</strong> — we never dress a stale number up as live.
</p>

${wizardSection(board, wizardCtx)}

<h2 style="margin-top:34px">🔍 Delivery auditor — did you get what you paid for?</h2>
<p class="muted-note">Rented some hash and want to check it actually showed up? Enter the address, how much you were promised, and the window. Parahawk compares it to the work actually delivered pool-side.</p>
<div class="aud">
  <label>Address <input id="aud-addr" type="text" placeholder="bc1q…" autocomplete="off" spellcheck="false"></label>
  <label>Promised PHd <input id="aud-phd" type="number" min="0.1" step="0.1" placeholder="e.g. 25"></label>
  <label>Window (hours) <input id="aud-hrs" type="number" min="1" step="1" value="24"></label>
  <button type="button" id="aud-go">Audit</button>
</div>
<div id="aud-out" class="aud-out"></div>

<p class="muted-note" style="margin-top:24px">The live Refinery order book (who's renting into the pot right now) is on the <a href="/order-books">order-books page</a>.</p>

<style>
.aud{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin:12px 0}
.aud label{display:flex;flex-direction:column;gap:5px;color:var(--dim);font-size:13px;text-transform:uppercase;letter-spacing:.5px}
.aud input{font-size:16px}
.aud #aud-addr{min-width:280px}
.aud-out{margin-top:8px}
.aud-verdict{border:1px solid var(--line);background:#0a0a0a;padding:20px 22px}
.aud-verdict .big{font-size:34px;color:#fff;margin-bottom:6px}
.aud-share{margin-top:12px;background:#050805;border:1px solid var(--line);padding:10px 14px;font-size:14px;color:var(--fg);word-break:break-word}
</style>
<script>
(function(){
  var $=function(id){return document.getElementById(id);};
  var go=$("aud-go"); if(!go) return;
  go.onclick=function(){
    var addr=($("aud-addr").value||"").trim(), phd=Number($("aud-phd").value||0), hrs=Number($("aud-hrs").value||24);
    if(!addr||!(phd>0)){ $("aud-out").innerHTML='<p class="dim">Enter an address and promised PHd.</p>'; return; }
    $("aud-out").innerHTML='<p class="dim">Auditing…</p>';
    fetch('/api/audit?address='+encodeURIComponent(addr)+'&phd='+phd+'&hours='+hrs)
      .then(function(r){return r.json();})
      .then(function(a){
        if(a.error){ $("aud-out").innerHTML='<p class="red">'+a.error+'</p>'; return; }
        var cls=a.verdict==='delivered'?'green':a.verdict==='partial'?'amber':a.verdict==='under'?'red':'dim';
        var head=a.pct==null?'NOT ENOUGH DATA':(a.verdict.toUpperCase()+' '+a.pct.toFixed(1)+'%');
        var body=a.deliveredPhd==null?'':('<div class="dim">'+a.deliveredPhd.toFixed(1)+' PHd delivered vs '+a.promisedPhd.toFixed(1)+' promised over '+a.windowHours+'h</div>');
        var cav=a.caveat?'<div class="dim" style="margin-top:8px;font-size:14px">⚠ '+a.caveat+'</div>':'';
        $("aud-out").innerHTML='<div class="aud-verdict"><div class="big '+cls+'">'+head+'</div>'+body+cav+
          '<div class="aud-share">'+a.shareLine+'</div></div>';
      })
      .catch(function(){ $("aud-out").innerHTML='<p class="red">Audit failed — try again.</p>'; });
  };
})();
</script>

<style>
.promise{border:1px solid #2c4a1c;background:#0c1408;color:#c7f59a;padding:14px 18px;margin:0 0 22px;font-size:17px}
.save-hero{border:1px solid var(--green);background:#0b1207;padding:24px 26px;margin:0 0 26px}
.save-hero .k{color:var(--dim);text-transform:uppercase;letter-spacing:2px;font-size:15px}
.save-hero .v{font-size:34px;color:#fff;margin:8px 0}
.save-hero .sub{color:var(--dim);font-size:18px;line-height:1.5}
table.board td:first-child{min-width:200px}
.vnote{font-size:13px;margin-top:3px;text-transform:none;letter-spacing:0}
.best-row{background:#0c1408}
.dead-row{opacity:.55}
.badge-best{background:var(--green);color:#04120a;font-size:12px;font-weight:900;padding:2px 8px;letter-spacing:1px;border-radius:3px;vertical-align:middle}
.badge-solo{background:#2a1a00;color:var(--amber);border:1px solid #50411f;font-size:12px;padding:2px 7px;letter-spacing:.5px;border-radius:3px;vertical-align:middle}
</style>
<script>setTimeout(function(){location.reload();},60000);</script>
`;

  return renderPage({ title: "Marketplace", active: "marketplace", body });
}
