import { jsonForScript } from "./format.js";
import { config } from "../config.js";
import {
  RATE_10T_PHD,
  RATE_21T_PHD,
  RATE_BLOCK_PHD,
  PLEB_SHARE_EXPECTED_RETURN,
} from "../math/constants.js";
import type { MarketBoard } from "../data/venues/index.js";

/** Pool targets the wizard can aim rented hashrate at. */
export const POOL_TARGETS = {
  standard: { label: "Parasite standard", host: "parasite.wtf:42069" },
  highdiff: { label: "Parasite high-diff", host: "parasite.wtf:42068" },
  solo: { label: "solo.ckpool", host: "stratum.ckpool.org:4334" },
} as const;

/** PH threshold at/above which we default to the high-diff port. */
export const HIGH_DIFF_PH_THRESHOLD = 10;

/**
 * The "Get Hash → Point at Parasite" order wizard. Steps 1–3 run entirely
 * client-side off the live board prices + the pool's own odds formulas (same
 * constants as the server math module). Execution is honest about custody:
 *   • NiceHash / MRR  → order from the USER'S linked account (vault pending).
 *   • Refinery / KMH  → deep-link + copy-paste config card, user pays.
 * Parahawk never holds funds; it only ever presses buttons the user authorized.
 */
export interface WizardCtx {
  connected: boolean;
  linkedVenues: string[];
  csrf: string;
}

export function wizardSection(board: MarketBoard, ctx: WizardCtx = { connected: false, linkedVenues: [], csrf: "" }): string {
  // Only priced, Parasite-capable venues can be ordered against.
  const venues = board.rows
    .filter((r) => r.satsPerPhd > 0 && r.canTargetParasite)
    .map((r) => ({
      venue: r.venue,
      slug: r.slug,
      sats: r.satsPerPhd,
      url: r.url,
      source: r.source,
      // NiceHash / MRR expose an order API → in-Parahawk execution (vault-gated).
      api: r.slug === "nicehash" || r.slug === "miningrigrentals",
    }));

  const cfg = {
    venues,
    refinerySats: board.refinerySatsPerPhd,
    btcPrice: board.btcPriceUsd,
    rate10: RATE_10T_PHD,
    rate21: RATE_21T_PHD,
    rateBlock: RATE_BLOCK_PHD,
    plebReturn: PLEB_SHARE_EXPECTED_RETURN,
    pools: POOL_TARGETS,
    highDiffPh: HIGH_DIFF_PH_THRESHOLD,
    lightningAddress: config.lightningAddress,
    connected: ctx.connected,
    linkedVenues: ctx.linkedVenues,
    csrf: ctx.csrf,
  };

  return `
<h2 style="margin-top:34px">🛒 Order wizard — get hash, point it at Parasite</h2>
<p class="muted-note">Pick a size, see the odds and the price at every venue, then order from your own account. <strong>Non-custodial:</strong> your money only ever moves inside venues you already trust — Parahawk just finds the cheapest and aims it at the pot.</p>

<div class="wiz">
  <!-- Step 1 — size -->
  <div class="wstep">
    <div class="wlabel">1 · How much hash?</div>
    <div class="presets" id="wiz-presets">
      <button type="button" data-ph="1" data-hrs="24">1 PH · 24h</button>
      <button type="button" data-ph="5" data-hrs="24" class="on">5 PH · 24h</button>
      <button type="button" data-ph="25" data-hrs="24">25 PH · 24h</button>
      <button type="button" data-ph="50" data-hrs="48">50 PH · 48h</button>
    </div>
    <div class="wcustom">
      <label>PH/s <input id="wiz-ph" type="number" min="0.1" step="0.1" value="5"></label>
      <label>Hours <input id="wiz-hrs" type="number" min="1" step="1" value="24"></label>
    </div>
  </div>

  <!-- Step 2 — aim -->
  <div class="wstep">
    <div class="wlabel">2 · Aim it</div>
    <label class="wfull">Your payout address (bc1q…)
      <input id="wiz-addr" type="text" placeholder="bc1q…" autocomplete="off" spellcheck="false"></label>
    <div class="wrow">
      <label>Worker <input id="wiz-worker" type="text" value="parahawk"></label>
      <label>Pool target
        <select id="wiz-pool">
          <option value="standard">Parasite standard · 42069</option>
          <option value="highdiff">Parasite high-diff · 42068</option>
          <option value="solo">solo.ckpool · 4334</option>
        </select>
      </label>
    </div>
    <div class="dim" id="wiz-pool-hint" style="font-size:13px;margin-top:6px"></div>
  </div>
</div>

<!-- Step 3 — odds + prices -->
<div class="wpanel">
  <div class="wodds">
    <div class="wlabel">Your order</div>
    <div class="wbig" id="wiz-phd">— PHd</div>
    <table class="woddsT">
      <tr><td>10T+ (Bravocado) chance</td><td id="wiz-o10" class="green">—</td></tr>
      <tr><td>21T+ chance</td><td id="wiz-o21" class="amber">—</td></tr>
      <tr><td>Block chance</td><td id="wiz-oblk" class="red">—</td></tr>
      <tr><td>Expected pleb-share return</td><td id="wiz-oret" class="dim">—</td></tr>
    </table>
  </div>
  <div class="wcost">
    <div class="wlabel">Cost at each venue <span class="dim" style="text-transform:none;letter-spacing:0">· cheapest wins</span></div>
    <table class="wcostT"><tbody id="wiz-costs"></tbody></table>
    <div class="wsave" id="wiz-save"></div>
  </div>
</div>

<!-- Execution -->
<div class="wexec" id="wiz-exec"></div>

<style>
.wiz{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:8px}
.wstep{border:1px solid var(--line);background:#0a0a0a;padding:18px}
.wlabel{color:var(--dim);text-transform:uppercase;letter-spacing:1.5px;font-size:14px;margin-bottom:12px}
.presets{display:flex;flex-wrap:wrap;gap:8px}
.presets button{background:#0f0f0f;color:var(--fg);border:1px solid var(--line);padding:9px 12px;font-size:15px;text-transform:none;letter-spacing:0;font-weight:400}
.presets button.on{background:var(--green);color:#04120a;border-color:var(--green);font-weight:700}
.wcustom{display:flex;gap:12px;margin-top:12px}
.wcustom label,.wrow label,.wfull{display:flex;flex-direction:column;gap:5px;color:var(--dim);font-size:13px;text-transform:uppercase;letter-spacing:.5px;flex:1}
.wfull{margin-bottom:12px}
.wrow{display:flex;gap:12px}
.wstep input,.wstep select{font-size:16px;text-transform:none;letter-spacing:0}
.wstep select{background:#0a0a0a;border:1px solid var(--line);color:var(--fg);padding:12px 10px}
.wpanel{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}
.wodds,.wcost{border:1px solid var(--line);background:#0a0a0a;padding:18px}
.wbig{font-size:40px;color:#fff;margin:4px 0 10px}
.woddsT td,.wcostT td{padding:8px 6px;border-bottom:1px solid var(--line);font-size:16px}
.woddsT td:last-child,.wcostT td:last-child{text-align:right;font-variant-numeric:tabular-nums}
.wcostT tr.win td{color:#fff}
.wcostT .wbadge{background:var(--green);color:#04120a;font-size:11px;font-weight:900;padding:1px 6px;border-radius:3px;margin-left:6px}
.wsave{margin-top:14px;color:var(--green);font-size:17px;min-height:1.2em}
.wexec{margin-top:18px}
.wcard{border:1px solid var(--green);background:#0b1207;padding:20px}
.wcard h3{margin:0 0 12px;color:#fff}
.wcfg{font-family:inherit;background:#050805;border:1px solid var(--line);padding:12px 14px;font-size:15px;color:var(--fg);white-space:pre-wrap;word-break:break-all;margin:10px 0}
.wghost{border:1px solid var(--red);background:#1a0808;color:#ff9a9a;padding:12px 15px;font-size:15px;margin:12px 0}
.wexec a.btn,.wexec button.btn{display:inline-block;background:var(--green);color:#04120a;padding:12px 20px;font-weight:700;text-transform:uppercase;letter-spacing:1px;border:0;cursor:pointer;font-size:16px}
.wexec .btn.ghosted{background:#141414;color:var(--dim);border:1px dashed var(--line)}
.wexec .copy{background:#0f0f0f;color:var(--fg);border:1px solid var(--line);padding:8px 14px;font-size:14px;text-transform:none;letter-spacing:0;cursor:pointer}
.wtip{margin-top:14px;border:1px solid #4a3a10;background:#141001;padding:16px 18px;color:#f5e0a0;font-size:16px}
.wtipaddr{margin-top:8px;color:var(--green);word-break:break-all;font-size:15px}
@media(max-width:760px){.wiz,.wpanel{grid-template-columns:1fr}}
</style>
<script>
(function(){
  var CFG = ${jsonForScript(cfg)};
  var $ = function(id){return document.getElementById(id);};
  var state = {ph:5, hrs:24, poolManual:false};

  function pct(p){
    if(p>=0.9995) return "~100%";
    if(p>=0.01) return (p*100).toFixed(1)+"%";
    if(p>=0.0001) return (p*100).toFixed(2)+"%";
    return "<0.01%";
  }
  function poisson(w,rate){ return w<=0?0:(rate<=0?1:1-Math.exp(-w/rate)); }
  function commas(n){ return Math.round(n).toLocaleString("en-US"); }
  function fmtUsd(n){ return "$"+n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}); }

  function poolKey(ph){ return state.poolManual ? $("wiz-pool").value : (ph>=CFG.highDiffPh ? "highdiff":"standard"); }

  function recompute(){
    var ph = Math.max(0, Number(state.ph)||0);
    var hrs = Math.max(0, Number(state.hrs)||0);
    var phd = ph * (hrs/24);
    $("wiz-phd").textContent = phd.toLocaleString("en-US",{maximumFractionDigits:1})+" PHd";

    // odds
    $("wiz-o10").textContent = pct(poisson(phd, CFG.rate10));
    $("wiz-o21").textContent = pct(poisson(phd, CFG.rate21));
    $("wiz-oblk").textContent = pct(poisson(phd, CFG.rateBlock));
    $("wiz-oret").textContent = "~"+Math.round(CFG.plebReturn*100)+"% of cost (long-run avg)";

    // default pool target unless the user picked one
    if(!state.poolManual){ $("wiz-pool").value = poolKey(ph); }
    var pk = $("wiz-pool").value;
    $("wiz-pool-hint").textContent = ph>=CFG.highDiffPh
      ? "≥"+CFG.highDiffPh+" PH → high-diff port recommended (42068)."
      : "Under "+CFG.highDiffPh+" PH → standard port is fine (42069).";

    // cost per venue, cheapest first
    var rows = CFG.venues.map(function(v){
      return {v:v, sats:v.sats*phd, usd:(v.sats*phd/1e8)*CFG.btcPrice};
    }).sort(function(a,b){return a.sats-b.sats;});
    var cheapest = rows.length?rows[0]:null;
    $("wiz-costs").innerHTML = rows.map(function(r,i){
      var win = i===0?" win":"";
      var badge = i===0?' <span class="wbadge">BEST</span>':'';
      return '<tr class="'+(win.trim())+'"><td>'+r.v.venue+badge+'</td>'+
        '<td>'+commas(r.sats)+' sats <span class="dim">· '+fmtUsd(r.usd)+'</span></td></tr>';
    }).join("");

    // savings vs Refinery
    var refCost = CFG.refinerySats*phd;
    var save = cheapest ? (refCost - cheapest.sats) : 0;
    if(cheapest && cheapest.v.slug!=="refinery" && save>0){
      $("wiz-save").innerHTML = "You'd save ≈ <strong>"+commas(save)+" sats</strong> ("+fmtUsd(save/1e8*CFG.btcPrice)+
        ") vs renting the same from Refinery.";
    } else if(cheapest){
      $("wiz-save").innerHTML = "<span class='dim'>Refinery is the cheapest option for this order right now.</span>";
    } else { $("wiz-save").textContent = ""; }

    renderExec(cheapest, phd);
  }

  function renderExec(cheapest, phd){
    var box = $("wiz-exec");
    if(!cheapest){ box.innerHTML=""; return; }
    var v = cheapest.v;
    var addr = ($("wiz-addr").value||"").trim() || "your-bc1q-address";
    var worker = ($("wiz-worker").value||"parahawk").trim() || "parahawk";
    var pool = CFG.pools[$("wiz-pool").value];
    var user = addr+"."+worker;

    var cfgCard = "pool:     "+pool.host+"\\nusername: "+user+"\\npassword: x\\nsize:     "+
      state.ph+" PH/s for "+state.hrs+"h  ("+phd.toLocaleString("en-US",{maximumFractionDigits:1})+" PHd)";

    var ghost = v.slug==="refinery"
      ? '<div class="wghost">⚠️ Pay with a HIGH-PRIORITY fee (add ~5 sat/vB over the estimate). If your payment doesn\\'t confirm within ~6 blocks the order can expire at 0% — a ghost order.</div>'
      : "";

    if(v.api){
      // NiceHash / MRR — order from the user's own linked account.
      var linked = CFG.linkedVenues.indexOf(v.slug) >= 0;
      var canOrder = CFG.connected && linked && v.slug==="nicehash";
      var intro = '<p class="muted-note" style="margin:0 0 12px">Parahawk places this order from your own '+v.venue+' balance, pre-aimed at '+pool.host+' as '+esc_js(user)+' — you never leave the tab. Non-custodial: your key can place orders but never withdraw.</p>';
      var action;
      if(canOrder){
        action = '<button type="button" class="btn" id="wiz-order">⚡ Place order from your '+v.venue+' account</button>'+
                 '<span id="wiz-order-out" class="dim" style="margin-left:12px"></span>';
      } else if(v.slug!=="nicehash"){
        action = '<span class="dim">'+v.venue+' in-app ordering is coming soon — for now, <a href="'+v.url+'" target="_blank" rel="noopener nofollow">open '+v.venue+' ↗</a>.</span>';
      } else if(!CFG.connected){
        action = '<a class="btn" href="/account">Connect &amp; link your '+v.venue+' key to order</a>';
      } else {
        action = '<a class="btn" href="/account">Link your '+v.venue+' key to order</a>';
      }
      box.innerHTML =
        '<div class="wcard"><h3>Order '+v.venue+' from your own account</h3>'+
        intro+'<div class="wcfg">'+cfgCard+'</div>'+action+'</div>';
      if(canOrder){
        var ob=$("wiz-order");
        ob.onclick=function(){
          ob.disabled=true; var out=$("wiz-order-out"); out.textContent="Placing…";
          var totalSats=v.sats*phd; var amountBtc=totalSats/1e8; var priceBtcPerPhDay=v.sats/1e8;
          var body="csrf="+encodeURIComponent(CFG.csrf)+"&venue=nicehash&phd="+phd+"&phRate="+state.ph+
            "&durationHrs="+state.hrs+"&pool="+encodeURIComponent($("wiz-pool").value)+"&worker="+encodeURIComponent(worker)+
            "&priceBtcPerPhDay="+priceBtcPerPhDay+"&amountBtc="+amountBtc;
          fetch("/account/order",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body})
            .then(function(r){return r.json();})
            .then(function(j){
              if(j.error){ out.innerHTML='<span class="red">'+j.error+'</span>'; ob.disabled=false; return; }
              out.innerHTML = j.dryRun
                ? '<span class="amber">✅ Dry-run OK — flow verified, no real order placed (live ordering is off). Balance '+j.balanceBtc+' BTC.</span>'
                : '<span class="green">✅ Order placed → '+j.pool+' (id '+j.orderId+')</span>';
            })
            .catch(function(){ out.innerHTML='<span class="red">order failed</span>'; ob.disabled=false; });
        };
      }
    } else {
      // Refinery / KMH — deep-link + copy-paste config card.
      box.innerHTML =
        '<div class="wcard"><h3>Open '+v.venue+' with your setup</h3>'+
        ghost+
        '<p class="muted-note" style="margin:0 0 8px">Paste this into '+v.venue+', then pay from your own wallet:</p>'+
        '<div class="wcfg" id="wiz-cfgtext">'+cfgCard+'</div>'+
        '<a class="btn" href="'+v.url+'" target="_blank" rel="noopener nofollow">Open '+v.venue+' ↗</a> '+
        '<button type="button" class="copy" id="wiz-copy">Copy config</button>'+
        '</div>';
      var cp = $("wiz-copy");
      if(cp) cp.onclick=function(){
        navigator.clipboard && navigator.clipboard.writeText(cfgCard.replace(/\\\\n/g,"\\n"));
        cp.textContent="Copied ✓"; setTimeout(function(){cp.textContent="Copy config";},1500);
      };
    }

    // Post-order tip prompt — framed around sats saved vs Refinery. Optional,
    // rides alongside the order (never skims it). Hidden if no LN address set.
    if(CFG.lightningAddress){
      var saved = (v.slug!=="refinery") ? Math.max(0,(CFG.refinerySats - v.sats)*phd) : 0;
      var ask = saved>0
        ? 'Best price on the board — that\\'s ≈ <strong>'+commas(saved)+' sats</strong> saved vs Refinery. ⚡ Tip the hawk?'
        : '⚡ Parahawk found you the board\\'s cheapest hash — tip the hawk?';
      box.insertAdjacentHTML('beforeend',
        '<div class="wtip"><div>'+ask+'</div>'+
        '<div class="wtipaddr">'+esc_js(CFG.lightningAddress)+
        ' <button type="button" class="copy" id="wiz-tipcopy">copy</button></div>'+
        '<div class="dim" style="font-size:13px;margin-top:8px">Optional, and never taken from your order — Parahawk earns only from tips and venue referrals. <a href="/about">how we stay free</a>.</div></div>');
      var tc = $("wiz-tipcopy");
      if(tc) tc.onclick=function(){
        navigator.clipboard && navigator.clipboard.writeText(CFG.lightningAddress);
        tc.textContent="copied ✓"; setTimeout(function(){tc.textContent="copy";},1500);
      };
    }
  }
  function esc_js(s){ return String(s).replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  // wire inputs
  var presets = $("wiz-presets").querySelectorAll("button");
  presets.forEach(function(b){
    b.onclick=function(){
      presets.forEach(function(x){x.classList.remove("on");});
      b.classList.add("on");
      state.ph = Number(b.dataset.ph); state.hrs = Number(b.dataset.hrs);
      state.poolManual = false;
      $("wiz-ph").value = state.ph; $("wiz-hrs").value = state.hrs;
      recompute();
    };
  });
  $("wiz-ph").oninput=function(){ state.ph=Number(this.value); clearPreset(); state.poolManual=false; recompute(); };
  $("wiz-hrs").oninput=function(){ state.hrs=Number(this.value); clearPreset(); recompute(); };
  $("wiz-pool").onchange=function(){ state.poolManual=true; recompute(); };
  ["wiz-addr","wiz-worker"].forEach(function(id){ $(id).oninput=recompute; });
  function clearPreset(){ presets.forEach(function(x){x.classList.remove("on");}); }

  recompute();
})();
</script>
`;
}
