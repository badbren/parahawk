import { renderPage } from "../layout.js";
import { getOverview } from "../../services/overview.js";
import { potMathFromOverview } from "../../services/potmath.js";
import {
  RATE_10T_PHD,
  RATE_21T_PHD,
  RATE_BLOCK_PHD,
  PLEB_SHARE_EXPECTED_RETURN,
  PHD_TO_DIFF,
} from "../../math/constants.js";

export async function renderCalc(): Promise<string> {
  const o = await getOverview().catch(() => null);
  const hashprice = o?.pool.hashpriceSatsPerPhd ?? 50_000;
  const btc = o?.pool.btcPriceUsd ?? 0;

  // Live Pot Math inputs to prefill the interactive card (fallbacks if data is down).
  const pm = o ? potMathFromOverview(o) : null;
  const seedW = pm?.W ?? 184;
  const seedD = pm?.D ?? 126.4;
  const seedH = pm?.hGauge ?? 99;

  const potMathSection = `
<h2 style="margin-top:8px">🧮 Pot Math — this round</h2>
<p class="muted-note">Enter the pot's work (W), network difficulty (D), and pool hashrate (H) — today's live values are prefilled. Then drop in <strong>your own banked work this round</strong> to see your cut if the pot cracked right now.</p>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">
  <div class="card"><div class="k">W — work since last block (T)</div><input type="number" id="pm_w" value="${seedW}" step="0.1" min="0"/></div>
  <div class="card"><div class="k">D — minimum needed diff (T)</div><input type="number" id="pm_d" value="${seedD}" step="0.1" min="0"/></div>
  <div class="card"><div class="k">H — pool hashrate (PH/s)</div><input type="number" id="pm_h" value="${seedH}" step="1" min="0"/></div>
  <div class="card" style="border-color:#33501f;background:#0d1408"><div class="k green">Your work this round (T)</div><input type="number" id="pm_g" placeholder="e.g. 5" step="0.1" min="0"/></div>
</div>
<div class="grid" style="margin-top:14px">
  <div class="card"><div class="k">Round depth</div><div class="v" id="pm_depth">–</div><div class="sub" id="pm_depth_c">W / D</div></div>
  <div class="card"><div class="k">Round rarity</div><div class="v" id="pm_rarity">–</div><div class="sub">P(round ≥ W) = e^(−W/D)</div></div>
  <div class="card"><div class="k">Share price</div><div class="v green" id="pm_sats">–</div><div class="sub">212,500 / W · subsidy only</div></div>
  <div class="card"><div class="k">Expected wait</div><div class="v" id="pm_wait">–</div><div class="sub" id="pm_wait_c">at H</div></div>
  <div class="card" style="border-color:#33501f;background:#0d1408"><div class="k green">💰 Your stake in this pot</div><div class="v green" id="pm_stake">–</div><div class="sub" id="pm_stake_c">enter your work this round (T) to see your cut</div></div>
</div>
<script src="/potmath.js"></script>
<script>
(function(){
  var P = window.PotMath, $ = function(id){return document.getElementById(id);};
  function fmtInt(n){return Math.round(n).toLocaleString("en-US");}
  function fmtDur(days){ if(!isFinite(days)||days<=0) return "—"; var h=days*24; if(h<24) return h.toFixed(1)+"h"; var d=Math.floor(h/24), r=Math.round(h-d*24); return r>0? d+"d "+r+"h" : d+"d"; }
  function recompute(){
    var W=parseFloat($("pm_w").value)||0, D=parseFloat($("pm_d").value)||0, H=parseFloat($("pm_h").value)||0, g=parseFloat($("pm_g").value);
    var m=P.computePotMath(W,D,H);
    $("pm_depth").textContent = (W>0&&D>0)? m.depth.toFixed(2)+"×" : "–";
    $("pm_depth_c").textContent = (W>0&&D>0)? Math.round(m.luckPct)+"% luck (W / D)" : "W / D";
    $("pm_rarity").textContent = (D>0)? Math.round(m.rarity*100)+"%" : "–";
    $("pm_sats").textContent = (W>0)? fmtInt(m.satsPerG)+" sats/G" : "–";
    $("pm_wait").textContent = fmtDur(m.expectedDays);
    $("pm_wait_c").textContent = "at "+(H||0)+" PH/s";
    if(!isNaN(g) && $("pm_g").value!=="" && W>0){
      var gG = g*1000; // T → G (1T = 1,000 G)
      $("pm_stake").textContent = fmtInt(P.stakeValue(gG,W))+" sats";
      $("pm_stake_c").textContent = g+" T ("+fmtInt(gG)+" G) × "+fmtInt(m.satsPerG)+" sats/G — payout if the pot cracked now (subsidy only)";
    } else {
      $("pm_stake").textContent = "–";
      $("pm_stake_c").textContent = "enter your work this round (T) to see your cut";
    }
  }
  ["pm_w","pm_d","pm_h","pm_g"].forEach(function(id){$(id).addEventListener("input",recompute);});
  recompute();
})();
</script>
`;

  const consts = JSON.stringify({
    RATE_10T_PHD,
    RATE_21T_PHD,
    RATE_BLOCK_PHD,
    PLEB: PLEB_SHARE_EXPECTED_RETURN,
    PHD_TO_DIFF,
    HASHPRICE: hashprice,
    BTC: btc,
  });

  const body = `
<h1>Calculators</h1>
<p class="lead">Pot Math for the current round, plus a rental strategy &amp; odds tool. All client-side, sharing Parahawk's one math module.</p>

${potMathSection}

<h2>Rental strategy &amp; odds</h2>
<p class="muted-note" style="margin-bottom:20px">How much hash, for how long, at what cost — and what are your real odds? Live hashprice: <span class="green">${Math.round(hashprice).toLocaleString("en-US")} sats/PHd</span>.</p>

<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
  <div class="card">
    <div class="k">Hashrate (PH/s)</div>
    <input type="number" id="hr" value="11" min="0" step="0.1"/>
  </div>
  <div class="card">
    <div class="k">Duration (hours)</div>
    <input type="number" id="hours" value="48" min="0" step="1"/>
  </div>
  <div class="card">
    <div class="k">…or budget (sats)</div>
    <input type="number" id="budget" placeholder="spend → PHd" min="0" step="1000"/>
  </div>
  <div class="card">
    <div class="k">…or work directly (PHd)</div>
    <input type="number" id="phd" placeholder="set PHd" min="0" step="1"/>
  </div>
</div>

<div id="lockin" class="stale" style="margin-top:16px"></div>

<h2>What you get</h2>
<div class="grid">
  <div class="card"><div class="k">Work</div><div class="v" id="r_phd">–</div><div class="sub">PHd of shares</div></div>
  <div class="card"><div class="k">Cost @ live hashprice</div><div class="v" id="r_cost">–</div><div class="sub" id="r_cost_usd">sats</div></div>
  <div class="card"><div class="k">🥑 10T share (Bravocado)</div><div class="v green" id="r_10t">–</div><div class="sub">P(≥1) · 1 per ${RATE_10T_PHD} PHd</div></div>
  <div class="card"><div class="k">🏠 21T share (homeminers)</div><div class="v amber" id="r_21t">–</div><div class="sub">P(≥1) · 1 per ${RATE_21T_PHD} PHd</div></div>
  <div class="card"><div class="k">🎰 Block</div><div class="v red" id="r_block">–</div><div class="sub">P(≥1) · 1 per ${RATE_BLOCK_PHD} PHd @127T</div></div>
  <div class="card"><div class="k">Best diff (expected)</div><div class="v" id="r_diff">–</div><div class="sub">~1–1.5× total work</div></div>
</div>

<h2>Steady vs moonshot</h2>
<div class="card" id="equiv" style="border-color:#33501f;background:#0d1408"></div>
<p class="muted-note" style="margin-top:10px">
  Your odds depend <strong>only on total PHd</strong> — not on how you buy it. A slow-and-steady order and a short moonshot of the
  <em>same PHd</em> have <strong>identical expected odds</strong>. The difference is <strong>variance</strong>: the moonshot swings harder
  (bigger chance of nothing, bigger chance of a monster), steady grinds toward the average. "It's all about total hashes."
</p>

<h2>The KMH 48-hour rule</h2>
<p class="muted-note">
  On <a href="https://app.kissmyhash.com" target="_blank" rel="noopener">Kiss My Hash</a>, orders of <strong>48h or more</strong> lock in your price and delivered hash;
  under 48h you take whatever the market gives ("pray"). Parasite's Refinery is pay-as-you-go either way. Duration doesn't change your odds for a given PHd —
  it changes <em>cost certainty</em>. Set duration ≥ 48h above to see the lock-in flag.
</p>

<p class="muted-note" style="margin-top:14px">P(≥1 hit in W PHd) = 1 − e<sup>−W/rate</sup>. Long-run probabilities, not promises. Not financial advice.</p>

<script>
const C = ${consts};
const $ = (id) => document.getElementById(id);
function pAtLeastOne(w, rate){ if(w<=0) return 0; return 1 - Math.exp(-w/rate); }
function fmtPct(p){ const v = p*100; return v>=99.99 ? "≈100%" : (v<0.01 && v>0 ? "<0.01%" : v.toFixed(v<1?2:1)+"%"); }
function fmtDiff(d){ if(d>=1e12) return (d/1e12).toFixed(2)+"T"; if(d>=1e9) return (d/1e9).toFixed(2)+"G"; return Math.round(d).toString(); }
function fmtSats(s){ return Math.round(s).toLocaleString("en-US")+" sats"; }
function recompute(){
  const hr = parseFloat($("hr").value)||0;
  const hours = parseFloat($("hours").value)||0;
  const budget = parseFloat($("budget").value);
  const phdOverride = parseFloat($("phd").value);
  let phd, source;
  if(!isNaN(phdOverride) && $("phd").value!==""){ phd = phdOverride; source="phd"; }
  else if(!isNaN(budget) && $("budget").value!==""){ phd = budget / C.HASHPRICE; source="budget"; }
  else { phd = hr * hours/24; source="hrhours"; }

  const cost = phd * C.HASHPRICE;
  const usd = C.BTC>0 ? (cost/1e8)*C.BTC : 0;
  $("r_phd").textContent = (phd<10?phd.toFixed(1):Math.round(phd).toLocaleString("en-US"))+" PHd";
  $("r_cost").textContent = fmtSats(cost);
  $("r_cost_usd").textContent = usd>0 ? "≈ $"+usd.toFixed(2)+" @ live hashprice" : "at live hashprice";
  $("r_10t").textContent = fmtPct(pAtLeastOne(phd, C.RATE_10T_PHD));
  $("r_21t").textContent = fmtPct(pAtLeastOne(phd, C.RATE_21T_PHD));
  $("r_block").textContent = fmtPct(pAtLeastOne(phd, C.RATE_BLOCK_PHD));
  const workDiff = phd * C.PHD_TO_DIFF;
  $("r_diff").textContent = fmtDiff(workDiff)+" – "+fmtDiff(workDiff*1.5);

  // lock-in flag (only meaningful when buying by hashrate×hours)
  const li = $("lockin");
  if(hours>=48){ li.style.display="block"; li.style.borderColor="#33501f"; li.style.background="#0d1408"; li.style.color="#c7f59a";
    li.innerHTML="🔒 <strong>"+hours+"h ≥ 48h</strong> — on KMH this locks in your price &amp; delivered hash. Cost certainty: high.";
  } else if(source!=="phd"){ li.style.display="block"; li.style.borderColor="#f5c451"; li.style.background="#2a1a00"; li.style.color="#f5c451";
    li.innerHTML="⚠ <strong>"+hours+"h &lt; 48h</strong> — under 48h on KMH you're not locked in (variable price/hash — \\"pray\\"). Refinery is pay-as-you-go.";
  } else { li.style.display="none"; }

  // steady vs moonshot equivalence, using this PHd
  const steadyHr = 5, steadyHrs = (phd/steadyHr*24);
  const moonHr = 120, moonHrs = (phd/moonHr*24);
  const p10 = fmtPct(pAtLeastOne(phd, C.RATE_10T_PHD));
  $("equiv").innerHTML =
    "<div class='k'>Same "+(phd<10?phd.toFixed(1):Math.round(phd))+" PHd, two ways — identical odds</div>"+
    "<table style='margin-top:8px'><tr><th>Style</th><th>Config</th><th>10T odds</th></tr>"+
    "<tr><td>🐢 Steady</td><td>"+steadyHr+" PH/s for "+steadyHrs.toFixed(0)+"h</td><td class='green'>"+p10+"</td></tr>"+
    "<tr><td>🚀 Moonshot</td><td>"+moonHr+" PH/s for "+moonHrs.toFixed(1)+"h</td><td class='green'>"+p10+"</td></tr>"+
    "</table><div class='sub'>Same expected odds — the moonshot just has higher variance.</div>";
}
["hr","hours","budget","phd"].forEach(id => $(id).addEventListener("input", recompute));
recompute();
</script>
`;

  return renderPage({ title: "Rental strategy", active: "calc", body });
}
