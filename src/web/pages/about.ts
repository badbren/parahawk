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

/** "What is Parahawk?" feature cards (emoji, title, description). */
const FEATURES: Array<{ e: string; t: string; d: string }> = [
  { e: "🧮", t: "Pot Math, solved", d: "Round depth, rarity, share price and expected time-to-block — computed live so you don't have to." },
  { e: "📈", t: "24-hour trends", d: "Every Pot Math number shows whether it's rising or falling vs a day ago. Not on Parasite." },
  { e: "👛", t: "Click any wallet", d: "One scrollable stats page: achievements, cados won, blocks found, lifetime work, luck, live hashrate." },
  { e: "🏭", t: "Rental history & spend", d: "A wallet's Refinery orders with estimated sats/USD spend and fill rate, all in one place." },
  { e: "📉", t: "14-day hashrate timeline", d: "A per-wallet hashrate chart Parasite doesn't publish — Parahawk builds it." },
  { e: "🏅", t: "Drill into achievements", d: "Click a badge to see the exact blocks a wallet is in (mempool links) or its Refinery orders." },
  { e: "🥑", t: "Cados won + floor value", d: "How many Bravocados a wallet has earned, and what they're worth at the live ordinal floor." },
  { e: "💰", t: "Is renting worth it?", d: "Break-even hashprice vs the live Refinery price, so you know if renting is +EV before you spend." },
  { e: "🎲", t: "Odds of a block", d: "The real probability the pool finds one within the next hour, 6h, day or week." },
  { e: "🏆", t: "All-time cado winners", d: "The whole 10T+ club ranked, with winners matched to openable wallet pages." },
  { e: "🎖️", t: "Badges & most-badges", d: "Every Parasite achievement, how to earn it, who holds it, and a most-badges leaderboard." },
  { e: "📊", t: "Rental market intel", d: "How much of the pool is rented right now, the biggest active renters, and their spend." },
  { e: "🍀", t: "Pool luck & Hall of Fame", d: "Is the pool running lucky lately? Plus the longest droughts and biggest pots ever." },
  { e: "⏱️", t: "Cado velocity", d: "How the current dry spell compares to the usual pace, plus a live feed of recent big shares." },
  { e: "🔬", t: "The luck audit", d: `Hits-per-PHd by hour &amp; weekday, to test "is any time luckier?" (spoiler: it isn't).` },
  { e: "🧾", t: "Rental odds calculator", d: "Hash × hours → your real odds of a 10T / 21T / block, and steady-vs-moonshot variance." },
  { e: "📟", t: "Live overview", d: "Pot age, an auto-scaling hashrate gauge, hashprice, difficulty, BTC price, users/workers." },
  { e: "🗓️", t: "Pool history charts", d: "Hashrate, hashprice and users/workers over time (1H/4H/1D/1W), plus every completed pot cycle." },
  { e: "🧱", t: "Mempool block strip", d: "Recent blocks, each with its top Parasite miner." },
  { e: "🌐", t: "Community hub", d: "Bobby's World home-mining shop and the OMB / Bravocados wikis, all in one place." },
];

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
<p class="lead">A free stats &amp; alerts platform for the <a href="https://parasite.space" target="_blank" rel="noopener">Parasite Pool</a> bitcoin mining community.</p>

<div class="whatis">
  <h2 style="margin-top:6px">What is Parahawk?</h2>
  <p class="wi-lead">Parahawk turns Parasite Pool's raw numbers into things you can actually read and use — the math worked out for you, every wallet's stats gathered in one place, and views that simply don't exist on parasite.space or the OMB wikis. A companion, not a replacement: same data, made legible.</p>
  <div class="wi-grid">
    ${FEATURES.map(
      (f) => `<div class="wi-card"><div class="wi-t"><span class="wi-e">${f.e}</span>${f.t}</div><div class="wi-d">${f.d}</div></div>`,
    ).join("")}
  </div>
  <p class="wi-foot">Everything in plain English — clean numbers, no jargon walls. Free, no ads, no tracking, <a href="https://github.com/badbren/parahawk" target="_blank" rel="noopener">open source</a>.</p>
</div>

<h2>What it does</h2>
<ul>
  <li><strong>Live overview</strong> — pot age, pool hashrate, Refinery hashprice, network difficulty, BTC price, users/workers.</li>
  <li><strong>Pool history</strong> — charts with 1H/4H/1D/1W timeframes: hashrate, hashprice, users/workers, and every completed pot cycle.</li>
  <li><strong>Calculator</strong> — round depth, rarity, share price and expected wait (with 24h trends), the luck audit, and a what-if / rental-odds calculator.</li>
  <li><strong>Wallet stats</strong> — click any address for its achievements, cados won, rental history &amp; spend, and hashrate timeline.</li>
  <li><strong>Bravocados &amp; Badges</strong> — the all-time cado winners board plus every Parasite achievement and who holds it.</li>
  <li><strong>Marketplace</strong> — every hashrate rental venue's price in one place, and a non-custodial order wizard that aims rented hash at Parasite.</li>
</ul>

<h2>The Marketplace — a price router, not a custodian</h2>
<p>The Marketplace tab compares what every rental venue — NiceHash, MiningRigRentals, Refinery and more — charges, all normalized to the one unit that matters: <strong>sats per PHd</strong>. It finds you the cheapest hash, then helps you point it straight at the Parasite pool.</p>
<p><strong>Parahawk never holds your funds.</strong> This is the important part, and it's different from a reseller:</p>
<ul>
  <li><strong>You order from your own account.</strong> For venues with an API (NiceHash, MRR) you link your <em>own</em> key — scoped so it can place orders but <em>never</em> withdraw — and Parahawk places the order from your balance, pre-aimed at Parasite. For venues without one, it deep-links you in with a copy-paste config. The money only ever moves inside venues you already trust.</li>
  <li><strong>We can't take a cut of your order, and wouldn't.</strong> Because the funds never touch Parahawk, there's no hook in that pipe. A reseller marks up the hash and pockets the spread; Parahawk just shows you the real prices and presses the buttons you authorized.</li>
  <li><strong>How Parahawk earns instead:</strong> optional Lightning tips (framed around the sats you saved) and venue referral codes — where the <em>venue</em> pays us for the signup, never you. That's disclosed wherever a referral link appears. <strong>Never from your order.</strong></li>
</ul>
<p class="muted-note">Your linked keys are encrypted at rest (AES-256-GCM), never shown again after entry, and never sent back to your browser. Revoke them at the venue any time.</p>

<style>
.whatis{margin:6px 0 34px}
.whatis h2{border:0;margin:0 0 6px;padding:0}
.wi-lead{color:var(--dim);font-size:18px;line-height:1.5;max-width:80ch;margin:0 0 20px}
.wi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.wi-card{border:1px solid var(--line);background:#0a0a0a;border-left:3px solid #33501f;padding:16px 18px;transition:border-color .12s,transform .12s}
.wi-card:hover{border-color:var(--green);border-left-color:var(--green);transform:translateY(-2px)}
.wi-t{color:#fff;font-size:17px;font-weight:600;display:flex;align-items:center;gap:10px}
.wi-e{font-size:22px;line-height:1}
.wi-d{color:#b7c9a6;font-size:14.5px;line-height:1.5;margin-top:8px}
.wi-foot{color:var(--dim);font-size:15px;margin:18px 0 0}
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
<p class="muted-note">Found a bug or want a feature? <a href="https://discord.com/users/1097991369986932828" target="_blank" rel="noopener">Message me on Discord</a> — see the <a href="/changelog">changelog</a> for what's shipped.</p>

<h2>Support</h2>
${tip}

<p class="muted-note" style="margin-top:26px">Parahawk is an independent community project, not affiliated with or endorsed by Parasite Pool. Data is best-effort and may be delayed or wrong. Nothing here is financial advice.</p>
`;

  return renderPage({ title: "About", active: "about", body });
}
