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

/**
 * "What is Parahawk?" — every module, grouped. Each card is an emoji, a title
 * and one or two plain sentences. `tag: "new"` marks what landed in 2.0;
 * `tag: "soon"` is built but not open to everyone yet — say so, never imply
 * it's live. Titles and descriptions are trusted HTML (write &amp; for &).
 */
type FeatureTag = "new" | "soon";
interface Feature { e: string; t: string; d: string; tag?: FeatureTag }
interface FeatureGroup { id: string; title: string; blurb: string; items: Feature[] }

const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "desktop",
    title: "🖥️ The Desktop",
    blurb: "Parahawk opens like a little computer — and everything on it is live.",
    items: [
      { e: "🖥️", t: "A desktop in your browser", d: "Icons down the left, windows you can drag, resize, maximise and minimise, a taskbar along the bottom. Open two tools side by side — nothing to install." },
      { e: "🌐", t: "The Hash Globe", d: "The wallpaper is live data: a globe of glowing hash glyphs reading out the pool's hashrate right now, with a heartbeat that quickens when the pool runs hot.", tag: "new" },
      { e: "🎬", t: "The intro", d: "GMB → BLOCK N IMMINENT → PARAHAWK. A cinematic that counts every block Parasite has found and calls the next one. Plays once per visit.", tag: "new" },
      { e: "📟", t: "Live taskbar", d: "Network difficulty, a LIVE light and the clock, always on screen. If the data ever goes stale, the light says so." },
      { e: "❗", t: "Never miss an update", d: "When the Changelog or this page changes, its icon flashes a ! until you've had a look.", tag: "new" },
      { e: "🪟", t: "Windows that fit", d: "Every window opens big, right beside the icons, and remembers where you left it next time.", tag: "new" },
      { e: "⚡", t: "Smooth on any machine", d: "The wallpaper watches its own frame rate and trims detail on slower computers, so it stays smooth even without a graphics card. Motion can be switched off from the right-click menu.", tag: "new" },
      { e: "📱", t: "Phone-friendly", d: "On a phone the desktop becomes an app grid and every window goes full-screen." },
    ],
  },
  {
    id: "pool",
    title: "📡 Pool stats",
    blurb: "Parasite's numbers, worked out and made readable.",
    items: [
      { e: "📟", t: "Live overview", d: "Pot age, an auto-scaling hashrate gauge, hashprice, difficulty, BTC price, users/workers." },
      { e: "🗓️", t: "Pool history charts", d: "Hashrate, hashprice and users/workers over time (1H/4H/1D/1W), plus every completed pot cycle." },
      { e: "🧮", t: "Pot Math, solved", d: "Round depth, rarity, share price and expected time-to-block — computed live so you don't have to." },
      { e: "📈", t: "24-hour trends", d: "Every Pot Math number shows whether it's rising or falling vs a day ago. Not on Parasite." },
      { e: "🎲", t: "Odds of a block", d: "The real probability the pool finds one within the next hour, 6h, day or week." },
      { e: "🍀", t: "Pool luck &amp; Hall of Fame", d: "Is the pool running lucky lately? Plus the longest droughts and biggest pots ever." },
      { e: "🔬", t: "The luck audit", d: `Hits-per-PHd by hour &amp; weekday, to test "is any time luckier?" (spoiler: it isn't).` },
      { e: "⏱️", t: "Cado velocity", d: "How the current dry spell compares to the usual pace, plus a live feed of recent big shares." },
      { e: "🧱", t: "Mempool block strip", d: "Recent blocks, each with its top Parasite miner." },
    ],
  },
  {
    id: "wallets",
    title: "👛 Wallets &amp; achievements",
    blurb: "Every wallet on the pool, one click away.",
    items: [
      { e: "👛", t: "Click any wallet", d: "One scrollable stats page: achievements, cados won, blocks found, lifetime work, luck, live hashrate." },
      { e: "🏷️", t: "Names on wallets", d: "Members who sign in show up by name — bc1q… (badbren) — on every board, list and wallet page. Click the name for their profile.", tag: "new" },
      { e: "📉", t: "14-day hashrate timeline", d: "A per-wallet hashrate chart Parasite doesn't publish — Parahawk builds it." },
      { e: "🏭", t: "Rental history &amp; spend", d: "A wallet's Refinery orders with estimated sats/USD spend and fill rate, all in one place." },
      { e: "🏅", t: "Drill into achievements", d: "Click a badge to see the exact blocks a wallet is in (mempool links) or its Refinery orders." },
      { e: "🥑", t: "Cados won + floor value", d: "How many Bravocados a wallet has earned, and what they're worth at the live ordinal floor." },
      { e: "🏆", t: "All-time cado winners", d: "The whole 10T+ club ranked, with winners matched to openable wallet pages." },
      { e: "🎖️", t: "Badges &amp; most-badges", d: "Every Parasite achievement, how to earn it, who holds it, and a most-badges leaderboard." },
      { e: "📊", t: "Rental market intel", d: "How much of the pool is rented right now, the biggest active renters, and their spend." },
    ],
  },
  {
    id: "tools",
    title: "🛒 Tools &amp; Marketplace",
    blurb: "Rent hash smarter — without ever handing anyone your money.",
    items: [
      { e: "🛒", t: "Hashrate marketplace", d: "Every rental venue's price in one place — normalized to sats/PHd, cheapest flagged, and how much you'd save vs Refinery." },
      { e: "🧭", t: "Order wizard", d: "Pick a size → see the odds and each venue's cost → aim it straight at Parasite. Order from your own account or deep-link out." },
      { e: "🔑", t: "Your own venue keys", d: "Link your NiceHash or MRR key — order-only, never withdraw — and place orders aimed at Parasite in one click. Encrypted at rest, only ever yours." },
      { e: "🤝", t: "Community-kept prices", d: "Hand-typed venue prices like Kiss My Hash can be refreshed by Trusted members the moment they go stale. Every change shows who made it, and the owner can undo any edit.", tag: "new" },
      { e: "🔍", t: "Delivery auditor", d: "Promised vs delivered PHd — an honest check on whether a rental actually showed up pool-side." },
      { e: "💰", t: "Is renting worth it?", d: "Break-even hashprice vs the live Refinery price, so you know if renting is +EV before you spend." },
      { e: "🧾", t: "Rental odds calculator", d: "Hash × hours → your real odds of a 10T / 21T / block, and steady-vs-moonshot variance." },
    ],
  },
  {
    id: "profile",
    title: "🙋 Your Profile",
    blurb: "Sign in once and Parahawk knows you — no account, no password.",
    items: [
      { e: "🔌", t: "Sign in with Xverse", d: "One free signature proves the wallet is yours — nothing is spent and nothing ever moves. It unlocks your Profile, Chat and badges. No login wall: guests still see everything." },
      { e: "🪪", t: "Display name", d: "Pick a name (3–20 characters) and it follows you everywhere: the taskbar, Chat, the leaderboards and wallet pages.", tag: "new" },
      { e: "🖼️", t: "Profile picture", d: "Upload a picture — it's cropped to a neat square and shows next to your name in Chat and on your profile.", tag: "new" },
      { e: "🕶️", t: "Privacy switch", d: "One switch keeps your name and your wallet apart. Flip it and nobody sees the two together — not in Chat, not on a profile, not on any list.", tag: "new" },
      { e: "👤", t: "Public profiles", d: "Click anyone's name to see their picture, badges and time on Parahawk — plus their pool numbers and wallet page, unless they keep them private.", tag: "new" },
      { e: "📊", t: "Your numbers, one click", d: "Profile → Parahawk shows your cut if the pot cracked right now, your hashrate, best share and rentals — with a jump to your full wallet page.", tag: "new" },
      { e: "⛏️", t: "Your mining address", d: "Mine to a different address than you sign in with? Set it once in your profile and your numbers follow it.", tag: "new" },
    ],
  },
  {
    id: "community",
    title: "💬 Community",
    blurb: "Talk to the people who mine here.",
    items: [
      { e: "💬", t: "Chat", d: "One room for everyone on Parahawk. Anyone can read; sign in to talk. Links work, and the Chat icon counts the messages you've missed.", tag: "new" },
      { e: "🏅", t: "Badges next to names", d: "In Chat every name wears its badges — Parasite Pool's first, then Parahawk's. Two at a glance, the rest on hover.", tag: "new" },
      { e: "📮", t: "Suggestions", d: "Got an idea or found a bug? A title, a few notes, send — it lands straight in the owner's inbox. No sign-in needed.", tag: "new" },
      { e: "🔔", t: "Discord alerts", d: "Join the Discord for block-found alerts. The bot answers /pot, /odds, /strategy and /odometer — or /watch an address to get pinged when a Refinery order stalls or fills." },
      { e: "🌐", t: "Community hub", d: "Bobby's World home-mining shop and the OMB / Bravocados wikis, all in one place — with its own icon on the desktop." },
    ],
  },
  {
    id: "badges",
    title: "🎖️ Parahawk badges",
    blurb: "Fourteen badges of our own, earned just by using the site. Parasite Pool's badges always come first — ours are for fun.",
    items: [
      { e: "🎖️", t: "14 badges to earn", d: "Look yourself up, say something in Chat, send a suggestion, place a real rental, keep coming back… Profile → Parahawk shows your progress on every one.", tag: "new" },
      { e: "⏱️", t: "Time that's honest", d: "Time counts only while Parahawk is open and in front of you, and the server does the counting. Lurker, Regular and Hawk Eye at 1, 10 and 50 hours.", tag: "new" },
      { e: "📅", t: "Keep coming back", d: "Back Again, Week In and Local for visiting on 3, 7 and 30 different days.", tag: "new" },
      { e: "🛡️", t: "Trusted — with a perk", d: "10 hours over 14 different days earns Trusted, and with it the right to update stale hand-typed prices on the Marketplace.", tag: "new" },
      { e: "🐣", t: "Early Hawk", d: "Sign in before the cutoff and you're an Early Hawk for good. Once it closes, it's gone.", tag: "new" },
    ],
  },
  {
    id: "soon",
    title: "🔜 Coming soon",
    blurb: "Built and nearly ready — these open to everyone soon.",
    items: [
      { e: "✍️", t: "Inscribe", d: "Inscribe an Ordinal straight from Xverse: drop in text or a file, see the cost, and Xverse builds, pays and sends it — Parahawk adds no fee. Opens to everyone after the admin's test inscriptions.", tag: "soon" },
      { e: "🕹️", t: "Block Hunt", d: "Steer a mite down a winding mine shaft to find the block. Every score is the server's own replay of your run, not your word for it.", tag: "soon" },
      { e: "🏆", t: "Leaderboard", d: "The Leaderboard tab ranks the best Block Hunt run per wallet — today, this week and all time — names and all.", tag: "soon" },
      { e: "🧩", t: "BTC Hunters", d: "Parahawk's own Bitcoin collection is in the works. Its apps sit greyed out on the desktop until launch.", tag: "soon" },
    ],
  },
];

const FEATURE_COUNT = FEATURE_GROUPS.reduce((n, g) => n + g.items.length, 0);
const TAG_LABEL: Record<FeatureTag, string> = { new: "NEW", soon: "SOON" };

function featureCard(f: Feature): string {
  const tag = f.tag ? `<span class="wi-tag wi-${f.tag}">${TAG_LABEL[f.tag]}</span>` : "";
  return `<div class="wi-card${f.tag === "soon" ? " is-soon" : ""}"><div class="wi-t"><span class="wi-e">${f.e}</span><span>${f.t}</span>${tag}</div><div class="wi-d">${f.d}</div></div>`;
}

/** The jump chips and every group, ready to drop into the page. */
function featureModules(): { jump: string; groups: string } {
  const jump = FEATURE_GROUPS.map((g) => `<a href="#wi-${g.id}">${g.title}</a>`).join("");
  const groups = FEATURE_GROUPS.map(
    (g) => `<h3 class="wi-h" id="wi-${g.id}">${g.title}<span class="wi-n">${g.items.length}</span></h3>
  <p class="wi-sub">${g.blurb}</p>
  <div class="wi-grid">${g.items.map(featureCard).join("")}</div>`,
  ).join("\n  ");
  return { jump, groups };
}

export async function renderAbout(): Promise<string> {
  const qr = await tipQrDataUrl();
  const addr = config.lightningAddress;

  const tip = addr
    ? `<div class="tip" style="gap:20px;align-items:flex-start">
        ${qr ? `<img src="${qr}" width="180" height="180" alt="tip QR"/>` : ""}
        <div>
          <div style="font-size:16px;color:var(--hi)">⚡ Tip the hawk</div>
          <p class="muted-note">Parahawk is free and always will be — no ads, no paywalls, no third-party trackers. Tips keep it running.</p>
          <div class="addr" style="font-size:15px">${esc(addr)}</div>
        </div>
      </div>`
    : `<p class="muted-note">⚡ The maintainer hasn't set a Lightning tip address yet (set <code>LIGHTNING_ADDRESS</code>).</p>`;

  const modules = featureModules();
  const body = `
<h1>About Parahawk</h1>
<p class="lead">A free stats, alerts &amp; community desktop for the <a href="https://parasite.space" target="_blank" rel="noopener">Parasite Pool</a> bitcoin mining community.</p>

<div class="whatis">
  <h2 style="margin-top:6px">What is Parahawk?</h2>
  <p class="wi-lead">Parahawk turns Parasite Pool's raw numbers into things you can actually read and use — the math worked out for you, every wallet's stats in one place, and views that simply don't exist on parasite.space or the OMB wikis. It has grown into a whole desktop for the people who mine here: profiles, chat, badges and tools, all free. A companion, not a replacement.</p>
  <div class="wi-jump" role="navigation" aria-label="Feature groups">${modules.jump}</div>
  ${modules.groups}
  <p class="wi-foot">That's ${FEATURE_COUNT} features and counting. Everything in plain English — clean numbers, no jargon walls. Free, no ads, no third-party trackers, <a href="https://github.com/badbren/parahawk" target="_blank" rel="noopener">open source</a>.</p>
</div>

<h2>What's where</h2>
<p>The <strong>Parahawk</strong> window holds the pool, one tab each:</p>
<ul>
  <li><strong>Overview</strong> — pot age, pool hashrate, Refinery hashprice, network difficulty, BTC price, users/workers.</li>
  <li><strong>Pool</strong> — history charts with 1H/4H/1D/1W timeframes: hashrate, hashprice, users/workers, and every completed pot cycle.</li>
  <li><strong>Calculator</strong> — round depth, rarity, share price and expected wait (with 24h trends), the luck audit, and a what-if / rental-odds calculator.</li>
  <li><strong>Marketplace</strong> — every hashrate rental venue's price in one place, and a non-custodial order wizard that aims rented hash at Parasite.</li>
  <li><strong>Bravocados</strong> — the all-time cado winners board, the 10T+ club and a live feed of big shares.</li>
  <li><strong>Badges</strong> — every Parasite achievement, who holds it, and the most-badges leaderboard.</li>
  <li><strong>Leaderboard</strong> — the Block Hunt board: best run per wallet, today / this week / all time. <em>(Block Hunt opens soon.)</em></li>
  <li><strong>Account</strong> — sign in and link your own venue keys for one-click orders.</li>
</ul>
<p>Their own icons on the desktop: <strong>About</strong> (you're here), <strong>Changelog</strong>, <strong>Chat</strong>, <strong>Community</strong>, <strong>Suggestions</strong> and <strong>Inscribe</strong> <em>(opens soon)</em> — plus <strong>Profile</strong> once you sign in. Click any wallet, anywhere, for its full stats page.</p>

<h2>The Marketplace — a price router, not a custodian</h2>
<p>The Marketplace tab compares what every rental venue — NiceHash, MiningRigRentals, Refinery and more — charges, all normalized to the one unit that matters: <strong>sats per PHd</strong>. It finds you the cheapest hash, then helps you point it straight at the Parasite pool.</p>
<p><strong>Parahawk never holds your funds.</strong> This is the important part, and it's different from a reseller:</p>
<ul>
  <li><strong>You order from your own account.</strong> For venues with an API (NiceHash, MRR) you link your <em>own</em> key — scoped so it can place orders but <em>never</em> withdraw — and Parahawk places the order from your balance, pre-aimed at Parasite. For venues without one, it deep-links you in with a copy-paste config. The money only ever moves inside venues you already trust.</li>
  <li><strong>We can't take a cut of your order, and wouldn't.</strong> Because the funds never touch Parahawk, there's no hook in that pipe. A reseller marks up the hash and pockets the spread; Parahawk just shows you the real prices and presses the buttons you authorized.</li>
  <li><strong>How Parahawk earns instead:</strong> optional Lightning tips (framed around the sats you saved) and venue referral codes — where the <em>venue</em> pays us for the signup, never you. That's disclosed wherever a referral link appears. <strong>Never from your order.</strong></li>
  <li><strong>Prices stay fresh.</strong> Live venues update themselves; hand-typed ones (like Kiss My Hash) can be refreshed by Trusted members, and every change is logged with who made it.</li>
</ul>
<p class="muted-note">Your linked keys are encrypted at rest (AES-256-GCM), never shown again after entry, and never sent back to your browser. Revoke them at the venue any time.</p>

<style>
.whatis{margin:6px 0 34px}
.whatis h2{border:0;margin:0 0 6px;padding:0}
.wi-lead{color:var(--dim);font-size:18px;line-height:1.5;max-width:80ch;margin:0 0 20px}
.wi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.wi-card{border:1px solid var(--line);background:#0a0a0a;border-left:3px solid #33501f;padding:16px 18px;transition:border-color .12s,transform .12s}
.wi-card:hover{border-color:var(--green);border-left-color:var(--green);transform:translateY(-2px)}
.wi-t{color:var(--hi);font-size:17px;font-weight:600;display:flex;align-items:center;gap:10px}
.wi-e{font-size:22px;line-height:1}
.wi-d{color:#b7c9a6;font-size:14.5px;line-height:1.5;margin-top:8px}
.wi-foot{color:var(--dim);font-size:15px;margin:18px 0 0}
.wi-jump{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 4px}
.wi-jump a{border:1px solid var(--line);padding:4px 10px;font-size:14px;color:var(--fg);text-decoration:none;white-space:nowrap}
.wi-jump a:hover{border-color:var(--green);color:var(--hi)}
.wi-h{display:flex;align-items:baseline;gap:10px;font-size:16px;letter-spacing:1.5px;text-transform:uppercase;color:var(--hi);margin:30px 0 4px;padding:0;border:0;scroll-margin-top:12px}
.wi-n{font-size:13px;letter-spacing:0;text-transform:none;color:var(--dim);font-weight:400}
.wi-sub{color:var(--dim);font-size:15px;margin:0 0 14px;max-width:80ch}
.wi-tag{margin-left:auto;flex:none;font-size:11px;letter-spacing:1px;line-height:1.5;padding:1px 6px;border:1px solid currentColor;font-weight:700}
.wi-new{color:var(--green)}
.wi-soon{color:var(--amber)}
.wi-card.is-soon{border-left-color:#5a4a1a}
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
  <li>🖥️ Run your own copy with <code>npm run dev</code> — it boots with zero credentials against the public APIs it can reach.</li>
</ul>
<p class="muted-note">Found a bug or want a feature? <a href="https://discord.com/users/1097991369986932828" target="_blank" rel="noopener">Message me on Discord</a> — see the <a href="/changelog">changelog</a> for what's shipped.</p>

<h2>Support</h2>
${tip}

<p class="muted-note" style="margin-top:26px">Parahawk is an independent community project, not affiliated with or endorsed by Parasite Pool. Data is best-effort and may be delayed or wrong. Nothing here is financial advice.</p>
`;

  return renderPage({ title: "About", active: "about", body });
}
