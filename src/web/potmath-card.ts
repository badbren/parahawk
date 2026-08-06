import type { PotMathSnapshot } from "../services/potmath.js";
import { fmtInt, fmtDuration } from "./format.js";

/** "1 in N" for a rarity probability (min 1). */
function oneIn(p: number): number {
  return p > 0 ? Math.max(1, Math.round(1 / p)) : 0;
}

/**
 * The headline POT MATH card — four big numbers, each with a plain-English
 * caption, plus a smaller raw-inputs row. Shared by the homepage; the same
 * numbers power /calc (client-side) and the bot's /pot.
 */
export function potMathCard(pm: PotMathSnapshot): string {
  const depth = pm.depth.toFixed(2);
  const luck = Math.round(pm.luckPct);
  const rarityPct = Math.round(pm.rarity * 100);
  const sats = fmtInt(pm.satsPerG);
  const waitGauge = fmtDuration(pm.expectedDays * 24);
  const wait1d = Math.round(pm.expectedDays1d);
  const waitGaugeDays = Math.round(pm.expectedDays);
  // Raw inputs, trimmed to 2 decimals for the key row + captions.
  const W = pm.W.toFixed(2);
  const D = pm.D.toFixed(2);
  const nextD = pm.nextD.toFixed(2);
  const hGauge = pm.hGauge.toFixed(2);
  const h1d = pm.h1d.toFixed(2);
  const h6d = pm.h6d.toFixed(2);
  const h9d = pm.h9d.toFixed(2);

  return `
<style>
.potmath{border:2px solid var(--green);background:#0b1206;padding:26px 26px 20px;margin:0 0 22px}
.potmath .hd{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.potmath .hd .t{font-size:22px;letter-spacing:3px;text-transform:uppercase;color:var(--green);font-weight:700}
.potmath .hd .s{color:var(--dim);font-size:16px}
.potmath .four{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}
.potmath .cell{border:1px solid #24361a;background:#0a0a0a;padding:18px}
.potmath .cell .lbl{color:var(--dim);font-size:14px;text-transform:uppercase;letter-spacing:1.5px}
.potmath .cell .num{font-size:52px;color:#fff;line-height:1.02;margin:8px 0 2px}
.potmath .cell .num small{font-size:22px;color:var(--dim)}
.potmath .cell .cap{color:#b7c9a6;font-size:15px;margin-top:8px;min-height:2.6em}
.potmath .raw{margin-top:18px;color:var(--dim);font-size:16px;border-top:1px solid #24361a;padding-top:14px}
.potmath .raw b{color:#fff;font-weight:400}
.potmath .keys{margin-top:16px;border-top:1px solid #24361a;padding-top:14px}
.potmath .keys .keyhd{color:var(--green);font-size:14px;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px}
.potmath .keys ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:6px 24px}
.potmath .keys li{color:#b7c9a6;font-size:15px;line-height:1.5}
.potmath .keys li b{color:#fff;font-weight:600}
.potmath .keys li sub,.potmath .keys li sup{color:#b7c9a6}
</style>
<section class="potmath">
  <div class="hd">
    <span class="t">⛏ Pot Math</span>
    <span class="s">the four numbers that describe this round — scorekeeping, not forecasting</span>
  </div>
  <div class="four">
    <div class="cell">
      <div class="lbl">Round depth</div>
      <div class="num">${depth}<small>×</small></div>
      <div class="cap">This pot: ${depth}× an average round (${luck}% luck).</div>
    </div>
    <div class="cell">
      <div class="lbl">Round rarity</div>
      <div class="num">${rarityPct}<small>%</small></div>
      <div class="cap">~${rarityPct}% of rounds get this deep — about 1 in ${oneIn(pm.rarity)}. Normal.</div>
    </div>
    <div class="cell">
      <div class="lbl">Share price</div>
      <div class="num">${sats}<small> sats/G</small></div>
      <div class="cap">Pays ~${sats} sats per G of banked work right now (subsidy only).</div>
    </div>
    <div class="cell">
      <div class="lbl">Expected wait</div>
      <div class="num" style="font-size:40px">${waitGauge}</div>
      <div class="cap">At ${hGauge} PH/s live, ~${waitGaugeDays}d to a block (1D avg ${h1d} PH/s → ~${wait1d}d).</div>
    </div>
  </div>
  <div class="raw">
    <b>W</b> ${W}T work since last block ·
    <b>D</b> ${D}T needed <span class="dim">→ ${nextD}T next retarget</span> ·
    <b>H</b> ${hGauge} PH/s live <span class="dim">·</span> 1D ${h1d} <span class="dim">·</span> 6D ${h6d} <span class="dim">·</span> 9D ${h9d} PH/s
  </div>
  <div class="keys">
    <div class="keyhd">The key &amp; formulas</div>
    <ul>
      <li><b>W</b> — total work since the last block (T). Resets to 0 when the pool finds a block.</li>
      <li><b>D</b> — minimum needed diff = network difficulty (T).</li>
      <li><b>H</b> — pool hashrate (PH/s): live gauge, plus 1D/6D/9D averages.</li>
      <li><b>Round depth</b> = W ÷ D &nbsp;=&nbsp; ${W} ÷ ${D} = <b>${depth}×</b></li>
      <li><b>Round rarity</b> = e<sup>−W/D</sup> = <b>${rarityPct}%</b> <span class="dim">(~1 in ${oneIn(pm.rarity)})</span></li>
      <li><b>Share price</b> = 212,500 ÷ W<sub>(T)</sub> = <b>${sats}</b> sats/G <span class="dim">(subsidy only)</span></li>
      <li><b>Work / block</b> = D · 2³² ÷ 86,400 ÷ 10¹⁵ = <b>${fmtInt(pm.phdNeeded)}</b> PHd</li>
      <li><b>Expected wait</b> = (Work / block) ÷ H = <b>${waitGauge}</b> <span class="dim">@ ${hGauge} PH/s</span></li>
    </ul>
  </div>
</section>`;
}
