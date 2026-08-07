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
          <p class="muted-note">Parahawk is free and always will be — no ads, no paywalls, no tracking. Tips keep it running.</p>
          <div class="addr" style="font-size:15px">${esc(addr)}</div>
        </div>
      </div>`
    : `<p class="muted-note">⚡ The maintainer hasn't set a Lightning tip address yet (set <code>LIGHTNING_ADDRESS</code>).</p>`;

  const body = `
<h1>About Parahawk</h1>
<p class="lead">A free, tip-funded stats &amp; alerts platform for the <a href="https://parasite.space" target="_blank" rel="noopener">Parasite Pool</a> bitcoin mining community.</p>

<h2>What it does</h2>
<ul>
  <li><strong>Live overview</strong> — pot age, pool hashrate, Refinery hashprice, network difficulty, BTC price, users/workers.</li>
  <li><strong>Pool history</strong> — charts with 1H/4H/1D/1W timeframes: hashrate, hashprice, users/workers, and every completed pot cycle.</li>
  <li><strong>Pot Math</strong> — round depth, rarity, share price and expected wait, the luck audit (hits-per-PHd by hour &amp; weekday), and a what-if / rental-odds calculator.</li>
  <li><strong>Order Books</strong> — the live Refinery rental order book.</li>
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
<p class="muted-note">1 PHd = ${(PHD_TO_DIFF / 1e9).toFixed(1)}G difficulty units. A miner's best difficulty typically lands around 1–1.5× their total accumulated work. Try the <a href="/potmath">Pot Math calculator</a>.</p>

<h2>Open source</h2>
<p>Parahawk is <strong>100% open source</strong>. Every formula on this site, the pollers, the Discord bot — all of it is on GitHub for anyone to read, audit, fork, or run themselves. No hidden math, no black box.</p>
<ul>
  <li>📦 <strong>Repo:</strong> <a href="https://github.com/badbren/parahawk" target="_blank" rel="noopener">github.com/badbren/parahawk</a> — clone it, open an issue, or send a pull request.</li>
  <li>🧮 The Pot Math lives in <code>src/math/</code> and is covered by the test suite, so the numbers you see are the numbers the code proves.</li>
  <li>🖥️ Run your own copy with <code>npm run dev</code> — it boots in mock mode with zero credentials.</li>
</ul>
<p class="muted-note">Found a bug or want a feature? <a href="https://github.com/badbren/parahawk/issues" target="_blank" rel="noopener">Open an issue on GitHub</a> — see the <a href="/changelog">changelog</a> for what's shipped.</p>

<h2>Support</h2>
${tip}

<p class="muted-note" style="margin-top:26px">Parahawk is an independent community project, not affiliated with or endorsed by Parasite Pool. Data is best-effort and may be delayed or wrong. Nothing here is financial advice.</p>
`;

  return renderPage({ title: "About", active: "about", body });
}
