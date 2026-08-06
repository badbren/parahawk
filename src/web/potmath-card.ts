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
      <div class="cap">At ${pm.hGauge} PH/s live, ~${waitGaugeDays}d to a block (1D avg ${pm.h1d} PH/s → ~${wait1d}d).</div>
    </div>
  </div>
  <div class="raw">
    <b>W</b> ${pm.W}T work since last block ·
    <b>D</b> ${pm.D}T needed <span class="dim">→ ${pm.nextD}T next retarget</span> ·
    <b>H</b> ${pm.hGauge} PH/s live <span class="dim">·</span> 1D ${pm.h1d} <span class="dim">·</span> 6D ${pm.h6d} <span class="dim">·</span> 9D ${pm.h9d} PH/s
  </div>
</section>`;
}
