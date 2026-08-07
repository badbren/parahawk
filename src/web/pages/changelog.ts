import { renderPage } from "../layout.js";

/**
 * Changelog — a hand-maintained, human-readable release history. Newest first.
 * `current: true` marks the version the site is running right now (badge in the
 * header). Keep entries short and user-facing; the git log has the fine detail.
 */
interface Release {
  version: string;
  name: string;
  date: string; // ISO date, displayed as-is
  current?: boolean;
  summary: string;
  changes: Array<{ tag: string; text: string }>;
}

const RELEASES: Release[] = [
  {
    version: "1.1",
    name: "Beta 1.1",
    date: "2026-08-06",
    current: true,
    summary: "Trends on the Calculator, clickable wallet stat pages, achievements, and an all-time cado-winners board.",
    changes: [
      {
        tag: "New",
        text: "Click any wallet — on the Bravocados board, the leaderboards, or via the header search — to open a full stats page for it: achievements, cados won, blocks found, lifetime work, live hashrate, rental history & spend, a 14-day hashrate chart and a best-share-per-block chart. It's all Parasite mining stats (not BTC balance), reached the same way from anywhere.",
      },
      {
        tag: "New",
        text: "All-time cado winners board on Bravocados — every miner with a best-ever 10T+ share (they each earned a Bravocado), ranked by best difficulty. Winners who've rented are matched to their full wallet and are clickable through to their stats page.",
      },
      {
        tag: "New",
        text: "Achievements on wallet pages — the Parasite badges (Bravocado, Block Finder, Block Contributor, Refinery, Loyalty, and more) with counts and how to earn each one.",
      },
      {
        tag: "New",
        text: "A Badges tab — every Parasite achievement with how to earn it, click a badge to see who holds it (the Bravocado list is complete), plus a 'most badges' leaderboard. It indexes wallets as winners are snapshotted and wallets are searched.",
      },
      {
        tag: "New",
        text: "Community tab (replaces Mr.V wiki) — Bobby's World home-mining shop alongside the OMB and Bravocados wikis, side by side.",
      },
      {
        tag: "New",
        text: "Calculator now answers 'is renting worth it right now?' (break-even hashprice vs the live Refinery price), shows the odds of a block within 1h/6h/24h/3d/7d, and a cado/block pace calculator for any hashrate.",
      },
      {
        tag: "New",
        text: "Order Books tab gained rental analytics — how much of the pool is rented right now, the biggest active renters (clickable) with estimated spend, and fill/flow stats.",
      },
      {
        tag: "New",
        text: "Pool tab gained a pool luck index (are we running lucky?), a pot-length distribution, and a Hall of Fame (longest droughts, biggest pots).",
      },
      {
        tag: "New",
        text: "Bravocados shows cado velocity (how the current dry spell compares to the usual pace) and a live feed of recent big shares.",
      },
      {
        tag: "Fixed",
        text: "The wallet 'stake in this pot' now measures your actual work this round from tracked hashrate (instead of a wildly-high live-hashrate × pot-age guess), with honest coverage — Parasite doesn't publish per-wallet round work, so Parahawk measures it itself.",
      },
      {
        tag: "Improved",
        text: "Wallet addresses across the site are now real links (hand cursor) wherever we can resolve them to a full address, so you can tell what's clickable.",
      },
      {
        tag: "New",
        text: "24-hour trend indicators on the Calculator's Pot Math — round depth, rarity, share price, expected wait and the raw W / D / H inputs each show a green ▲ / red ▼ pill with the change vs ~24h ago, so you can tell at a glance if a number is trending up or down.",
      },
      {
        tag: "Improved",
        text: "Round rarity and luck now display a decimal place, so small day-to-day moves (e.g. 22.4% → 23.1%) are actually visible.",
      },
      {
        tag: "Smart",
        text: "When the pool finds a block inside the 24h window the pot resets, so the work-based figures show a “↻ new pot” note instead of a misleading swing.",
      },
      { tag: "New", text: "This Changelog tab, so you can see exactly what shipped and when." },
      {
        tag: "Open source",
        text: "Made it obvious Parahawk is open source — prominent links to the GitHub repo on the About page and in the site footer.",
      },
      {
        tag: "Fixed",
        text: "The “Where this pot sits” percentile bar on the Calculator — the 50 / 23 / 10 / 5% labels no longer overlap the text and the live marker.",
      },
      {
        tag: "Fixed",
        text: "The Bravocados “all-time 10T+ hits” figure now reads the authoritative on-chain cado total instead of only the handful Parahawk had polled directly, so it matches the number of Bravocados actually awarded.",
      },
      {
        tag: "Fixed",
        text: "The Calculator no longer reloads the whole page every 30s — it now refreshes just the live Pot Math numbers in the background, so the what-if calculator stays open and the page never flashes.",
      },
    ],
  },
  {
    version: "1.0",
    name: "Beta 1.0 — public launch",
    date: "2026-08-05",
    summary: "Parahawk goes live on the open web, wired to real Parasite Pool data.",
    changes: [
      { tag: "Launch", text: "First public release, deployed live and connected to real Parasite Pool + mempool.space data." },
      {
        tag: "New",
        text: "Reworked the tabs: the old Pot Math page became the Calculator (now also home to the luck audit and the what-if / rental-odds tools), and a dedicated Order Books tab shows the live Refinery rental book.",
      },
      { tag: "New", text: "Bravocados tab absorbed the awards — the 10T+ club and the top-100 all-time difficulties side by side." },
      {
        tag: "New",
        text: "Homepage mempool block strip showing recent blocks with the top-difficulty Parasite miner in each, plus a pool-hashrate gauge that auto-scales.",
      },
      { tag: "New", text: "Wallet address lookup — search any bc1… address for its stats and orders." },
      { tag: "New", text: "Pool history charts with 1H / 4H / 1D / 1W timeframe toggles." },
      { tag: "New", text: "Mr.V wiki with real artwork." },
      { tag: "Changed", text: "Tip jar switched to on-chain BTC with a scheme-aware QR code. All money and difficulty values rounded to 2 decimals." },
      { tag: "Security", text: "Pre-launch hardening — XSS fix, Helmet + CSP, rate limiting and an address-lookup cache." },
      { tag: "Note", text: "The Discord bot is built but disabled for launch." },
    ],
  },
];

function tagClass(tag: string): string {
  const t = tag.toLowerCase();
  if (t === "launch" || t === "open source") return "green";
  if (t === "new") return "green";
  if (t === "improved" || t === "smart" || t === "changed" || t === "fixed") return "amber";
  if (t === "security") return "red";
  return "dim";
}

export async function renderChangelog(): Promise<string> {
  const current = RELEASES.find((r) => r.current) ?? RELEASES[0]!;

  const entries = RELEASES.map((r) => {
    const items = r.changes
      .map(
        (c) =>
          `<li><span class="cl-tag ${tagClass(c.tag)}">${c.tag}</span> ${c.text}</li>`,
      )
      .join("");
    return `
<section class="cl-rel${r.current ? " cur" : ""}">
  <div class="cl-head">
    <span class="cl-ver">v${r.version}</span>
    <span class="cl-name">${r.name}</span>
    ${r.current ? `<span class="cl-badge">running now</span>` : ""}
    <span class="cl-date">${r.date}</span>
  </div>
  <p class="cl-sum">${r.summary}</p>
  <ul class="cl-list">${items}</ul>
</section>`;
  }).join("");

  const body = `
<h1>Changelog</h1>
<p class="lead">What's new in Parahawk. We're in <strong>Beta ${current.version}</strong> — the site works and runs on live data, but things are still moving fast. Newest changes first.</p>

<div class="cl-now">
  <div>
    <div class="cl-now-k">Current version</div>
    <div class="cl-now-v">Beta ${current.version}</div>
  </div>
  <div class="cl-now-note">
    Parahawk is open source — read every change in full on
    <a href="https://github.com/badbren/parahawk" target="_blank" rel="noopener">GitHub</a>,
    or <a href="https://github.com/badbren/parahawk/issues" target="_blank" rel="noopener">suggest the next one</a>.
  </div>
</div>

${entries}

<p class="muted-note" style="margin-top:30px">Versions are informal during beta. Spotted something broken or missing? <a href="https://github.com/badbren/parahawk/issues" target="_blank" rel="noopener">Open an issue</a> — it might be in the next release.</p>

<style>
.cl-now{display:flex;gap:28px;align-items:center;flex-wrap:wrap;border:2px solid var(--green);background:#0b1206;padding:20px 24px;margin:0 0 30px}
.cl-now-k{color:var(--dim);font-size:14px;text-transform:uppercase;letter-spacing:1.5px}
.cl-now-v{color:#fff;font-size:34px;line-height:1.1;margin-top:4px}
.cl-now-note{color:#b7c9a6;font-size:16px;max-width:52ch;line-height:1.5}
.cl-rel{border-left:2px solid var(--line);padding:2px 0 8px 22px;margin:0 0 28px;position:relative}
.cl-rel.cur{border-left-color:var(--green)}
.cl-rel::before{content:"";position:absolute;left:-7px;top:8px;width:12px;height:12px;border-radius:50%;background:#0a0a0a;border:2px solid var(--line)}
.cl-rel.cur::before{background:var(--green);border-color:var(--green)}
.cl-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.cl-ver{color:var(--green);font-weight:700;font-size:22px}
.cl-name{color:#fff;font-size:20px}
.cl-badge{color:#04120a;background:var(--green);font-size:12px;text-transform:uppercase;letter-spacing:1px;padding:2px 8px;font-weight:700}
.cl-date{color:var(--dim);font-size:15px;margin-left:auto}
.cl-sum{color:#b7c9a6;font-size:17px;margin:8px 0 14px}
.cl-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.cl-list li{color:var(--fg);font-size:17px;line-height:1.5}
.cl-tag{display:inline-block;font-size:12px;text-transform:uppercase;letter-spacing:1px;padding:1px 8px;margin-right:8px;border:1px solid currentColor;border-radius:3px;vertical-align:1px}
.cl-tag.green{color:var(--green)} .cl-tag.amber{color:var(--amber)} .cl-tag.red{color:var(--red)} .cl-tag.dim{color:var(--dim)}
</style>
`;

  return renderPage({ title: "Changelog", active: "changelog", body });
}
