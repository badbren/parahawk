/**
 * Changelog — a hand-maintained, human-readable release history. Newest first.
 * `current: true` marks the version the site is running right now (badge in the
 * header). Keep entries short and user-facing; the git log has the fine detail.
 *
 * Pure data with no imports, so two places can share it: the /changelog page
 * (pages/changelog.ts) and the desktop shell bundle, which flashes a "!" on the
 * Changelog icon until a browser has opened the Changelog since LATEST_RELEASE
 * (shell/apps/changelog-badge.ts). Releasing = add the new entry at the top and
 * move `current: true` onto it; every visitor's "!" comes back on its own.
 */
export interface ReleaseChange {
  /** New · Improved · Changed · Fixed · Faster · Security · Soon … (pages/changelog.ts colours them). */
  tag: string;
  text: string;
}

/** A headline card at the top of a big release. */
export interface ReleaseHighlight {
  emoji: string;
  title: string;
  text: string;
}

/** A group of changes under one heading, for releases too big for one list. */
export interface ReleaseSection {
  title: string;
  emoji?: string;
  changes: ReleaseChange[];
}

export interface Release {
  version: string;
  name: string;
  date: string; // ISO date, displayed as-is
  current?: boolean;
  summary: string;
  /** Every change, flat. A release with `sections` sets this to the sections joined in order. */
  changes: ReleaseChange[];
  /** Big releases: headline cards shown first. */
  highlights?: ReleaseHighlight[];
  /** Big releases: the changes grouped under headings; the page shows these instead of the flat list. */
  sections?: ReleaseSection[];
}

// ── 2.0 (2026-11-06) ───────────────────────────────────────────────────────────────────────────────────────────────────
// Everything since 1.3: the desktop OS (live since Aug 29, never logged) and the
// whole of the Nov 6 push. Text is plain HTML-safe copy (no < or >).

const V2_HIGHLIGHTS: ReleaseHighlight[] = [
  { emoji: "🖥️", title: "A desktop in your browser", text: "Parahawk is now its own little OS — windows, icons, a taskbar and a start menu. Open to everyone, no login wall, ever." },
  { emoji: "🌐", title: "The Hash Globe", text: "A beating planet of hashes with the live pool hashrate at its heart. It pulses faster when the pool runs hot." },
  { emoji: "🎬", title: "A brand-new intro", text: "Hex rain, a hyperspace flight, GMB, BLOCK # IMMINENT — then PARAHAWK, on fire." },
  { emoji: "👤", title: "Profiles", text: "Sign in with Xverse, pick a name and a picture. It follows you everywhere on Parahawk." },
  { emoji: "💬", title: "Chat", text: "One room for the whole flock, with pictures and badges next to every name." },
  { emoji: "🏅", title: "14 Parahawk badges", text: "Earned just by using the site. The 🛡️ Trusted badge even lets you fix stale prices." },
  { emoji: "✍️", title: "Inscribe, for real", text: "Text or a file, straight from Xverse, with no Parahawk fee. Opens to everyone after the admin's test runs." },
  { emoji: "⚡", title: "Fast on anything", text: "60 fps even with hardware acceleration off — 144 fps on a real graphics card." },
  { emoji: "📮", title: "Suggestions", text: "Tell us what to build next, straight to the owner. No sign-in needed." },
];

const V2_SECTIONS: ReleaseSection[] = [
  {
    title: "The Desktop",
    emoji: "🖥️",
    changes: [
      { tag: "New", text: "Parahawk is now a desktop in your browser: drag, resize and maximize windows, launch apps from icons, and switch between them on a Win98-style taskbar with a start menu." },
      { tag: "New", text: "No login wall, ever. The whole desktop is open to guests — the stats stay free and need no wallet." },
      { tag: "New", text: "The taskbar tray shows the live network difficulty, a LIVE / STALE light for the pool feed, your wallet and a clock." },
      { tag: "New", text: "Every page keeps its own link: open any parahawk.space link and the right window opens, and the address bar follows whatever you're looking at." },
      { tag: "New", text: "Windows open big, right beside the desktop icons — and remember where you put them." },
      { tag: "Changed", text: "A tidier desktop: Parahawk, About, Changelog, Chat, Inscribe, Community and Suggestions up front, with the BTC Hunters apps waiting at the bottom." },
      { tag: "Changed", text: "All the pool tools — pool history, calculator, marketplace, Bravocados, badges, leaderboard and account — now live as tabs inside one Parahawk window." },
      { tag: "New", text: "About, Changelog, Community and Inscribe got desktop icons of their own." },
      { tag: "New", text: "A flashing ! on Changelog and About whenever they've changed since your last visit — it clears the moment you open them." },
      { tag: "New", text: "Phones get a touch-friendly icon grid and full-screen windows." },
      { tag: "New", text: "Right-click the desktop for quick options, including turning the wallpaper motion on or off." },
    ],
  },
  {
    title: "Look & Feel",
    emoji: "🎨",
    changes: [
      { tag: "New", text: "The Hash Globe wallpaper: a planet of glowing hex characters spinning on a tilted axis, ringed by orbiting hash motes, with the live pool hashrate at its heart." },
      { tag: "New", text: "It has a heartbeat — the globe ripples with every beat, from a calm 48 bpm up to 72 when the pool runs hot." },
      { tag: "New", text: "A brand-new intro: hex rain, a hyperspace flight through a hash starfield, GMB, BLOCK # IMMINENT — always counting to the pool's next block — and then PARAHAWK, on fire, with smoke swirling inside the letters." },
      { tag: "Improved", text: "The intro plays once per visit (phones get a 3-second cut), and parahawk.space/?boot=1 replays it any time." },
      { tag: "New", text: "The fiery PARAHAWK logo now glows in the top-right corner of the desktop." },
      { tag: "New", text: "Shooting-star glints flare across the sky every couple of seconds." },
      { tag: "Changed", text: "Bitcoin orange everywhere — every page and every app swapped its white text for orange." },
      { tag: "Improved", text: "Desktop icon labels got a cleaner, easier-to-read font and stay on one line." },
      { tag: "Improved", text: "The PARAHAWK wordmark's W no longer crowds the K." },
      { tag: "Changed", text: "A calmer wallpaper: just the globe and the live hashrate — no stats box, no counters." },
    ],
  },
  {
    title: "Performance",
    emoji: "⚡",
    changes: [
      { tag: "Faster", text: "Smooth on almost anything: 60 fps even with your browser's hardware acceleration switched off, and 144 fps on a real graphics card." },
      { tag: "Faster", text: "Adaptive quality — the wallpaper watches its own frame times and dials detail up or down on the fly." },
      { tag: "Faster", text: "It spots software rendering (no graphics card in use) and lowers the render scale on its own, before you notice any lag." },
      { tag: "Faster", text: "The sky and glow are pre-baked, and the logo's smoke is built once per visit, so each frame only draws what actually moves." },
      { tag: "Fixed", text: "A tab left in the background no longer drags the wallpaper's quality down when you come back to it." },
      { tag: "Faster", text: "Every open tab shares one tiny, cached pool-data request every 15 seconds." },
      { tag: "Faster", text: "Names, pictures and badges are looked up in batches and cached, so Chat stays light even when it's busy." },
    ],
  },
  {
    title: "Your Profile",
    emoji: "👤",
    changes: [
      { tag: "New", text: "Sign in with Xverse: one signed message proves your wallet. It never moves funds and never asks you to sign a transaction." },
      { tag: "New", text: "Display names: pick one (3–20 characters) and it shows on your taskbar button, in Chat, on the leaderboards and next to your wallet across Parahawk." },
      { tag: "New", text: "Profile pictures: upload one, crop it to a neat circle, and it shows next to your name." },
      { tag: "New", text: "A privacy switch: turn it on and your name is never shown next to your wallet — and your wallet never next to your name." },
      { tag: "New", text: "Your Parahawk dashboard: one tap to your wallet page, what you'd get if the pot cracked right now, your hashrate, best share, rentals placed, and every badge with a progress bar." },
      { tag: "New", text: "Mine to a different address than the one you sign in with? Set it once and your numbers follow it." },
      { tag: "New", text: "Public profiles: click anyone's name to see their picture, badges and pool stats — unless they keep their wallet private." },
    ],
  },
  {
    title: "Community",
    emoji: "💬",
    changes: [
      { tag: "New", text: "Chat: one room for everyone on Parahawk. Anyone can read; sign in with Xverse to talk." },
      { tag: "New", text: "Profile pictures and badges sit right next to names in Chat — Parasite Pool badges first." },
      { tag: "New", text: "Click any name in Chat to open their profile." },
      { tag: "New", text: "An unread counter on the Chat icon, so you never miss a message." },
      { tag: "New", text: "Links in Chat are clickable, and you can delete your own messages." },
      { tag: "New", text: "Suggestions: leave a title and a note and it goes straight to the Parahawk owner. No sign-in needed." },
      { tag: "New", text: "Names next to wallets everywhere in Parahawk — “bc1q…c4mn (badbren)” on Overview, Pool, Bravocados, Badges, Order Books and the Leaderboard. Click the name to open their profile." },
      { tag: "New", text: "Wallet pages show the owner's name and a View profile button." },
    ],
  },
  {
    title: "Parahawk Badges",
    emoji: "🏅",
    changes: [
      { tag: "New", text: "14 Parahawk badges, earned just by using the site. They show on your profile and next to your name in Chat." },
      { tag: "New", text: "Time on Parahawk: ⏱️ Lurker (1 hour), 🕰️ Regular (10 hours) and 🦅 Hawk Eye (50 hours)." },
      { tag: "New", text: "Keep coming back: 📅 Back Again (3 days), 🗓️ Week In (7 days) and 🏠 Local (30 days)." },
      { tag: "New", text: "Talk it up: 💬 First Words and 🗣️ Chatterbox (100 messages)." },
      { tag: "New", text: "🔍 Looked Yourself Up, 👀 Wallet Watcher (look up 10 wallets), 📮 Suggestion Box, 🏭 Renter (a real rental through the Marketplace) and 🐣 Early Hawk (sign in before the cutoff)." },
      { tag: "New", text: "🛡️ Trusted — 10 hours across 14 different days — comes with a perk: you can update Kiss My Hash's price on the Marketplace when it goes stale, so prices stay fresh for everyone. Every change is logged and can be undone." },
      { tag: "Changed", text: "Parasite Pool's own badges always come first. Ours are just for fun." },
      { tag: "Security", text: "Time on site is counted by the server, and only while Parahawk is open in front of you — a hidden tab earns nothing." },
    ],
  },
  {
    title: "Inside Parahawk",
    emoji: "🦅",
    changes: [
      { tag: "New", text: "A Leaderboard tab: the Block Hunt board — today, this week and all time — right inside Parahawk, ready for when the game opens." },
      { tag: "New", text: "Hand-typed Marketplace prices now say who updated them and when — “updated 5m ago by badbren”." },
      { tag: "Changed", text: "About, Changelog, Community and Inscribe moved out of the Parahawk tabs and onto the desktop." },
    ],
  },
  {
    title: "Inscribe",
    emoji: "✍️",
    changes: [
      { tag: "New", text: "Inscribe really inscribes now: text or any file, straight from your Xverse wallet. Xverse builds, signs and pays — Parahawk adds no fee and never touches your keys." },
      { tag: "New", text: "It runs right on the desktop, so Xverse can reach it without opening a separate tab." },
      { tag: "New", text: "Live fee rates from mempool.space, a clear cost estimate before you start, and the inscription lands on your Ordinals (bc1p) address." },
      { tag: "New", text: "A “Sent from this browser” list with mempool.space links — and the button locks after a send, so you can never pay twice by accident." },
      { tag: "Soon", text: "Opens to everyone right after the admin's test inscriptions. Until then you can try every step up to the Xverse payment." },
    ],
  },
  {
    title: "Fixes & Housekeeping",
    emoji: "🔧",
    changes: [
      { tag: "Fixed", text: "The Badges page's week-over-week trends had been quietly failing to save since August. They're back." },
      { tag: "Fixed", text: "If your browser got stuck on the old “classic” site, it now comes back to the desktop on its own." },
      { tag: "Changed", text: "MetaMask is gone — Parahawk is Bitcoin-first. Sign in with Xverse; WalletConnect is on the way." },
      { tag: "Changed", text: "The Recycle Bin is gone. Hid an app before? Right-click the desktop → Show hidden apps brings it back." },
      { tag: "Security", text: "Privacy fails safe: if the database ever hiccups, Chat shows everyone anonymously rather than risk revealing a private person's wallet." },
      { tag: "Security", text: "Profile pictures are checked byte by byte (PNG, JPEG or WebP only) and size-capped." },
      { tag: "Security", text: "Chat and Suggestions have spam guards: rate limits and a bot trap." },
      { tag: "Fixed", text: "Visits from development copies of the site no longer count toward the live visitor numbers." },
    ],
  },
  {
    title: "Coming Soon",
    emoji: "🔜",
    changes: [
      { tag: "Soon", text: "BTC Hunters — the Collection, Burn and Block Hunt apps wait greyed out at the bottom of the desktop until the collection is ready. Nothing NFT is live yet." },
      { tag: "Soon", text: "The Whitepaper is greyed out too; it comes back with BTC Hunters." },
      { tag: "Soon", text: "WalletConnect sign-in." },
    ],
  },
];

export const RELEASES: Release[] = [
  {
    version: "2.0",
    name: "Parahawk 2.0",
    date: "2026-11-06",
    current: true,
    summary:
      "The biggest update Parahawk has ever had. The site is now a whole desktop in your browser — with profiles, a live chat, 14 badges of our own, an Inscribe tool that really inscribes, a beating Hash Globe wallpaper, Bitcoin orange everywhere, and a mountain of speed work. Still free, still no login wall: sign in with Xverse only when you want a profile.",
    highlights: V2_HIGHLIGHTS,
    sections: V2_SECTIONS,
    changes: V2_SECTIONS.flatMap((s) => s.changes),
  },
  {
    version: "1.3",
    name: "Beta 1.3 — Inscribe & badge accuracy",
    date: "2026-08-10",
    summary:
      "A new Inscribe tab — mint Ordinals straight from Xverse for just the network fee — plus a big accuracy pass on the badges: Bravocados and Block Finders now reflect what actually happened on-chain.",
    changes: [
      {
        tag: "New",
        text: "Inscribe tab — inscribe an Ordinal on Bitcoin straight from your Xverse wallet paying only the network fee, no marketplace markup. Connect, drop in text or a file, pick a fee rate, and see the exact commit + reveal cost before anything is signed. Experimental: the live fee estimate and wallet connect are real; the broadcast step is gated off while it's tested on signet.",
      },
      {
        tag: "Fixed",
        text: "Bravocado holder count now reflects the real number of cados actually dispensed on-chain by the OMB dispensary — the reward for landing a 10T+ share — instead of an inflated figure that mixed in the wider 10T+ leaderboard and the indexed-badge table.",
      },
      {
        tag: "Fixed",
        text: "Block Finder now lists only the real block finders — the wallets whose own share actually solved a Parasite block (one of them a double-winner) — sourced from each block's on-chain trophy, instead of the couple dozen that Parasite's looser badge counter had tagged.",
      },
      {
        tag: "Improved",
        text: "The Badges board now surfaces every Parasite achievement automatically — including ones we hadn't hand-labelled yet (like “collected 3 asset types”) — so nothing stays invisible.",
      },
      {
        tag: "New",
        text: "A Discord link in the header — join the Parahawk Discord for block alerts and future updates.",
      },
    ],
  },
  {
    version: "1.2",
    name: "Beta 1.2 — The Marketplace",
    date: "2026-08-07",
    summary: "A non-custodial hashrate marketplace: compare every rental venue's price, connect your wallet, and order from your own account — Parahawk never holds your funds.",
    changes: [
      {
        tag: "New",
        text: "Marketplace tab — every hashrate rental venue's price in one place, normalized to sats/PHd. Live prices from NiceHash (order-book average) and MiningRigRentals, plus Refinery, with verdict chips vs the ~50k fair value, a BEST PRICE badge, and how-much-you'd-save-vs-Refinery. Replaces the old Order Books tab (still linked from the top of the board).",
      },
      {
        tag: "New",
        text: "Order wizard — pick a size (1–50 PH) and duration, see your real odds (10T / 21T / block) and the cost at every venue side by side, and it auto-picks the right Parasite port (high-diff for big rentals). For deep-link venues it hands you a copy-paste config card with the ghost-order fee warning; for NiceHash it can place the order from your own account.",
      },
      {
        tag: "New",
        text: "Connect your Bitcoin wallet (Xverse) — sign a one-time message (BIP-322) to prove an address is yours. No passwords, nothing spent. Your wallet becomes your Parahawk identity so your linked venue keys belong only to you.",
      },
      {
        tag: "New",
        text: "Linked Accounts — bring your own NiceHash/MRR API key (scoped to placing orders, never withdrawal). Keys are encrypted at rest (AES-256-GCM), masked, and never shown again. Parahawk places orders from your balance; it can't touch your funds and wouldn't.",
      },
      {
        tag: "New",
        text: "Delivery auditor — 'did you get what you paid for?' Compares the PHd a rental promised vs the work actually delivered pool-side, with an honest caveat when the sample is coarse.",
      },
      {
        tag: "New",
        text: "Tip the hawk after an order — a Lightning prompt framed around the sats you saved. Parahawk earns only from optional tips and venue referral codes, never from your order — see About.",
      },
      {
        tag: "Changed",
        text: "About now explains the non-custodial model in plain English: a price router + your-own-account automation, contrasted with a reseller that marks up the hash.",
      },
    ],
  },
  {
    version: "1.1",
    name: "Beta 1.1",
    date: "2026-08-06",
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
        tag: "New",
        text: "Bravocado floor value — the live floor price (from Satflow) on the Bravocados board, and on wallet pages your cados are valued at floor in BTC & USD.",
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
        tag: "Improved",
        text: "Header tidy-up — the wallet search moved up next to the logo, giving the tabs their own row with room to breathe.",
      },
      {
        tag: "New",
        text: "Parahawk now indexes every wallet you search — plus the pool's known contributors it finds itself — so their achievements, stats and hashrate timelines build up automatically over time.",
      },
      {
        tag: "Improved",
        text: "Homepage Pool Hashrate gauge is bigger and refreshes on its own every 10s (no full-page reload), and the Parasite Power bar has a subtle left-to-right 'charging' shimmer.",
      },
      {
        tag: "Improved",
        text: "Browser tab now shows the Parahawk hawk icon next to the name.",
      },
      {
        tag: "New",
        text: "Achievement badges on wallet pages are clickable — open a badge to see the exact blocks that wallet is in (with mempool links) or its Refinery orders.",
      },
      {
        tag: "New",
        text: "Renters get a live current-round stake estimate on their wallet, from the delivered work on their active Refinery orders — a real figure even before a round baseline exists.",
      },
      {
        tag: "Improved",
        text: "Pot age is now pinned to the exact last-block time from mempool (it used to assume 10 minutes per block).",
      },
      {
        tag: "Improved",
        text: "The Parasite Power bar's glow now sweeps only across the filled power, and the tabs are centered with more breathing room.",
      },
      {
        tag: "Improved",
        text: "The About page's “What is Parahawk?” is now a clean card grid (matching this Changelog's look) instead of a wall of bullets.",
      },
      {
        tag: "Improved",
        text: "The Pool page charts are redesigned — compact and side by side in tidy cards instead of giant stacked blocks.",
      },
      {
        tag: "Fixed",
        text: "Your stake in this pot now counts your total work as this round's when there's no round-start baseline — accurate if you started mining at/after the last block (most renters & new miners), instead of reading far too low.",
      },
      {
        tag: "New",
        text: "The Pool page's luck index, pot-length distribution and Hall of Fame now backfill real completed cycles from Parasite instead of starting empty.",
      },
      {
        tag: "Improved",
        text: "Mobile makeover — a proper hamburger menu and a responsive layout so the whole site reads cleanly on a phone.",
      },
      {
        tag: "Improved",
        text: "Snappier navigation — pages are briefly edge-cached, so moving between them is much faster.",
      },
      {
        tag: "Improved",
        text: "Badges page is clearer that non-Bravocado holder counts are “indexed” (wallets we can currently look up), not all-time totals.",
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

/** The version the site is running now: the `current: true` entry, else the newest. */
export const LATEST_RELEASE: Release = RELEASES.find((r) => r.current) ?? RELEASES[0]!;
