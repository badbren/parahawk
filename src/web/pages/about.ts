import { renderPage } from "../layout.js";
import { tipQrDataUrl } from "../qr.js";
import { config } from "../../config.js";
import { esc } from "../format.js";
import {
  RATE_10T_PHD,
  RATE_21T_PHD,
  RATE_BLOCK_PHD,
  FINDER_REWARD_BTC,
  POT_SPLIT_BTC,
  PHD_TO_DIFF,
} from "../../math/constants.js";

export async function renderAbout(): Promise<string> {
  const qr = await tipQrDataUrl();
  const addr = config.lightningAddress;

  const tip = addr
    ? `<div class="tip" style="gap:20px;align-items:flex-start">
        ${qr ? `<img src="${qr}" width="180" height="180" alt="tip QR"/>` : ""}
        <div>
          <div style="font-size:16px;color:#fff">⚡ Tip the hawk</div>
          <p class="muted-note">Parahawk is free and always will be — no ads, no paywalls, no tracking. Tips cover the $5/mo VPS.</p>
          <div class="addr" style="font-size:15px">${esc(addr)}</div>
        </div>
      </div>`
    : `<p class="muted-note">⚡ The maintainer hasn't set a Lightning tip address yet (set <code>LIGHTNING_ADDRESS</code>).</p>`;

  const body = `
<h1>About Parahawk 🦅</h1>
<p class="lead">A free, tip-funded stats &amp; alerts platform for the <a href="https://parasite.wtf" target="_blank" rel="noopener">Parasite Pool</a> bitcoin mining community.</p>

<h2>What it does</h2>
<ul>
  <li><strong>Live overview</strong> — pot age, pool hashrate, Refinery hashprice, network difficulty, BTC price, users/workers.</li>
  <li><strong>History</strong> — charts from Parahawk's own time series: hashrate, hashprice, and every completed pot cycle.</li>
  <li><strong>Luck audit</strong> — the myth-buster: hits-per-PHd bucketed by hour and weekday, from collected data.</li>
  <li><strong>Calculator</strong> — your odds of a 10T/21T share or a block for any amount of work.</li>
  <li><strong>Discord bot</strong> — block alerts plus <code>/pot</code>, <code>/price</code>, <code>/odds</code>, <code>/odometer</code>, <code>/watch</code>.</li>
</ul>

<h2>How Parasite payouts work</h2>
<p>When the pool finds a block, the reward splits in two:</p>
<ul>
  <li>The <strong>finder</strong> — the miner whose share solved the block — gets <strong>${FINDER_REWARD_BTC} BTC</strong>.</li>
  <li>The remaining <strong>~${POT_SPLIT_BTC} BTC</strong> — "the pot" — splits among <em>all</em> miners in proportion to the shares they submitted since the pool's <em>previous</em> block.</li>
</ul>
<p>So the longer the pool goes without a block, the more shares accumulate in the pot — and the moment a block lands, the pot resets to zero and a fresh cycle begins. That's why Parahawk leads with <strong>pot age</strong>: it tells you where you are in the cycle.</p>
<p class="muted-note">Pot age = (current bitcoin height − Parasite's last-found height) × 10 min. 🟢 fresh &lt;1d · 🟡 aging 1–2d · 🔴 stale &gt;2d.</p>

<h2>The math</h2>
<p>Shares arrive as a Poisson process, so the chance of landing at least one hit of a tier in <code>W</code> PHd of work is <code>1 − e^(−W/rate)</code>:</p>
<table>
  <tr><th>Tier</th><th>Rate</th><th>Meaning</th></tr>
  <tr><td>🥑 Bravocado (10T+)</td><td>~${RATE_10T_PHD} PHd</td><td>one 10T+ difficulty share expected per ${RATE_10T_PHD} PHd</td></tr>
  <tr><td>🏠 homeminers (21T+)</td><td>~${RATE_21T_PHD} PHd</td><td>one 21T+ share expected per ${RATE_21T_PHD} PHd</td></tr>
  <tr><td>🎰 Block</td><td>~${RATE_BLOCK_PHD} PHd</td><td>one block expected per ${RATE_BLOCK_PHD} PHd at ~127T difficulty</td></tr>
</table>
<p class="muted-note">1 PHd = ${(PHD_TO_DIFF / 1e9).toFixed(1)}G difficulty units. A miner's best difficulty typically lands around 1–1.5× their total accumulated work. Try the <a href="/calc">calculator</a>.</p>

<h2>Support</h2>
${tip}

<p class="muted-note" style="margin-top:26px">Parahawk is an independent community project, not affiliated with or endorsed by Parasite Pool. Data is best-effort and may be delayed or wrong. Nothing here is financial advice.</p>
`;

  return renderPage({ title: "About", active: "about", body });
}
