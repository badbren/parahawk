import { renderPage } from "../layout.js";
import {
  RATE_10T_PHD,
  RATE_21T_PHD,
  RATE_BLOCK_PHD,
  PLEB_SHARE_EXPECTED_RETURN,
  PHD_TO_DIFF,
} from "../../math/constants.js";

export async function renderCalc(): Promise<string> {
  const consts = JSON.stringify({
    RATE_10T_PHD,
    RATE_21T_PHD,
    RATE_BLOCK_PHD,
    PLEB: PLEB_SHARE_EXPECTED_RETURN,
    PHD_TO_DIFF,
  });

  const body = `
<h1>Odds calculator</h1>
<p class="lead">Same Poisson math the bot uses. All client-side — nothing is sent anywhere.</p>

<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
  <div class="card">
    <div class="k">Hashrate (PH/s)</div>
    <input type="number" id="hr" value="75" min="0" step="0.1"/>
  </div>
  <div class="card">
    <div class="k">Duration (days)</div>
    <input type="number" id="days" value="6.67" min="0" step="0.1"/>
  </div>
  <div class="card">
    <div class="k">…or work directly (PHd)</div>
    <input type="number" id="phd" placeholder="auto from hashrate×days" min="0" step="1"/>
  </div>
</div>

<h2>Results</h2>
<div class="grid">
  <div class="card"><div class="k">Work</div><div class="v" id="r_phd">–</div><div class="sub">PHd of shares</div></div>
  <div class="card"><div class="k">10T share (Bravocado)</div><div class="v green" id="r_10t">–</div><div class="sub">P(≥1) · 1 per ${RATE_10T_PHD} PHd</div></div>
  <div class="card"><div class="k">21T share (homeminers)</div><div class="v amber" id="r_21t">–</div><div class="sub">P(≥1) · 1 per ${RATE_21T_PHD} PHd</div></div>
  <div class="card"><div class="k">Block</div><div class="v red" id="r_block">–</div><div class="sub">P(≥1) · 1 per ${RATE_BLOCK_PHD} PHd @127T</div></div>
  <div class="card"><div class="k">Best diff (expected)</div><div class="v" id="r_diff">–</div><div class="sub">~1–1.5× total work</div></div>
  <div class="card"><div class="k">Expected pleb return</div><div class="v" id="r_ret">–</div><div class="sub">long-run mean of rental cost</div></div>
</div>

<p class="muted-note" style="margin-top:18px">P(≥1 hit in W PHd) = 1 − e<sup>−W/rate</sup>. These are long-run probabilities, not promises — variance is large. Not financial advice.</p>

<script>
const C = ${consts};
const $ = (id) => document.getElementById(id);
function pAtLeastOne(w, rate){ if(w<=0) return 0; return 1 - Math.exp(-w/rate); }
function fmtPct(p){ const v = p*100; return v>=99.99 ? "≈100%" : (v<0.01 && v>0 ? "<0.01%" : v.toFixed(v<1?2:1)+"%"); }
function fmtDiff(d){ if(d>=1e12) return (d/1e12).toFixed(2)+"T"; if(d>=1e9) return (d/1e9).toFixed(2)+"G"; return Math.round(d).toString(); }
function recompute(){
  const hr = parseFloat($("hr").value)||0;
  const days = parseFloat($("days").value)||0;
  const phdOverride = parseFloat($("phd").value);
  const phd = (!isNaN(phdOverride) && $("phd").value!=="") ? phdOverride : hr*days;
  $("r_phd").textContent = phd.toFixed(phd<10?1:0)+" PHd";
  $("r_10t").textContent = fmtPct(pAtLeastOne(phd, C.RATE_10T_PHD));
  $("r_21t").textContent = fmtPct(pAtLeastOne(phd, C.RATE_21T_PHD));
  $("r_block").textContent = fmtPct(pAtLeastOne(phd, C.RATE_BLOCK_PHD));
  const workDiff = phd * C.PHD_TO_DIFF;
  $("r_diff").textContent = fmtDiff(workDiff*1.0)+" – "+fmtDiff(workDiff*1.5);
  $("r_ret").textContent = "~"+Math.round(C.PLEB*100)+"%";
}
["hr","days","phd"].forEach(id => $(id).addEventListener("input", recompute));
recompute();
</script>
`;

  return renderPage({ title: "Calculator", active: "calc", body });
}
