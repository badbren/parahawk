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

<div class="whatis">
  <h2 style="margin-top:6px">What is Parahawk?</h2>
  <p>Parahawk turns Parasite Pool's raw numbers into things you can actually read and use — the math worked out for you, every wallet's stats gathered in one place, and views that simply don't exist on parasite.space or the OMB wikis. It's a companion, not a replacement: same data, made legible.</p>
  <div class="whatis-cols">
    <ul>
      <li><strong>Pot Math, solved for you</strong> — round depth, rarity, share price and expected time-to-block, computed live from the pool so you don't have to.</li>
      <li><strong>24-hour trends</strong> — every Pot Math number shows whether it's rising or falling vs a day ago. Not on Parasite.</li>
      <li><strong>Click any wallet → full stats page</strong> — one scrollable template: achievements, cados won, blocks found, lifetime work, luck, live hashrate.</li>
      <li><strong>Rental history &amp; spend</strong> — a wallet's Refinery orders with an estimated sats/USD spend and fill rate, pulled together in one place.</li>
      <li><strong>Per-wallet hashrate timeline</strong> — a 14-day chart Parasite doesn't publish; Parahawk builds it.</li>
      <li><strong>Best-share-per-block chart</strong> — see a miner's recent big shares against the 10T Bravocado line.</li>
      <li><strong>Cados won, per wallet</strong> — how many Bravocados a miner has earned, read straight from their achievements.</li>
    </ul>
    <ul>
      <li><strong>All-time cado winners board</strong> — the whole 10T+ club ranked, with winners matched to openable wallets.</li>
      <li><strong>Badges tab</strong> — every Parasite achievement, how to earn it, who holds it, and a "most badges" leaderboard.</li>
      <li><strong>The luck audit</strong> — hits-per-PHd by hour &amp; weekday, to test "is any time luckier?" (spoiler: it isn't).</li>
      <li><strong>Rental odds calculator</strong> — hash × hours → your real odds of a 10T / 21T / block, and steady-vs-moonshot variance.</li>
      <li><strong>Live overview at a glance</strong> — pot age, an auto-scaling hashrate gauge, hashprice, difficulty, BTC price, users/workers.</li>
      <li><strong>Pool history charts</strong> — hashrate, hashprice, users/workers and every completed pot cycle (1H/4H/1D/1W).</li>
      <li><strong>Mempool block strip</strong> — recent blocks with each one's top Parasite miner.</li>
      <li><strong>Everything in plain English</strong> — clean numbers, captions, no jargon walls. Free, no ads, no tracking, <a href="https://github.com/badbren/parahawk" target="_blank" rel="noopener">open source</a>.</li>
    </ul>
  </div>
</div>

<h2>What it does</h2>
<ul>
  <li><strong>Live overview</strong> — pot age, pool hashrate, Refinery hashprice, network difficulty, BTC price, users/workers.</li>
  <li><strong>Pool history</strong> — charts with 1H/4H/1D/1W timeframes: hashrate, hashprice, users/workers, and every completed pot cycle.</li>
  <li><strong>Calculator</strong> — round depth, rarity, share price and expected wait (with 24h trends), the luck audit, and a what-if / rental-odds calculator.</li>
  <li><strong>Wallet stats</strong> — click any address for its achievements, cados won, rental history &amp; spend, and hashrate timeline.</li>
  <li><strong>Bravocados &amp; Badges</strong> — the all-time cado winners board plus every Parasite achievement and who holds it.</li>
  <li><strong>Order Books</strong> — the live Refinery rental order book.</li>
</ul>

<style>
.whatis{border:1px solid var(--line);background:#0a0a0a;padding:6px 22px 18px;margin:6px 0 30px}
.whatis-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 28px}
@media(max-width:760px){.whatis-cols{grid-template-columns:1fr}}
.whatis-cols ul{margin:6px 0;padding-left:22px}
.whatis-cols li{margin:0 0 10px;line-height:1.5}
</style>

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
