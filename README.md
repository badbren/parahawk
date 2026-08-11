# Parahawk 🦅

**A free, tip-funded stats & alerts platform for the [Parasite Pool](https://parasite.wtf) bitcoin mining community.**

One small Node.js/TypeScript service (single process, happy on a $5/mo VPS) that runs three things at once:

- **A Discord bot** — block alerts + slash commands (`/pot`, `/price`, `/odds`, `/odometer`, `/watch`).
- **A public stats website** — dark terminal aesthetic, server-rendered, with charts and a live luck audit.
- **Background pollers** — continuously collect pool + chain data into Postgres (Supabase), which is what powers the historical charts and the luck audit.

Everything is free — no paywalls, no ads, no tracking. A Lightning tip jar sits in every bot embed footer and the site footer (with a server-generated QR code).

---

## Quick start (zero credentials)

```bash
git clone https://github.com/badbren/parahawk.git
cd parahawk
npm install
npm run dev
```

Open **http://localhost:3000**. With no configuration it serves the site against the public APIs it can reach (mempool.space works out of the box) plus an in-memory store that starts empty and fills as the pollers run — no Discord token, no Supabase, no API keys required to boot. Point `PARASITE_BASE_URL` at the real endpoints and add Supabase for full pool data + persistent history (see **Going live** below).

Run the tests:

```bash
npm test        # vitest — the pure math module (odds, pot age, work, hashprice)
```

---

## The pages

| Route | What |
|-------|------|
| `/` | Live overview — pot age, pool hashrate, hashprice, difficulty, BTC price, users/workers. Auto-refreshes every 30s. |
| `/history` | Charts from Parahawk's own time series: hashrate, hashprice, every completed pot cycle, and the **10T+ hit board** (red dots — who hit it, share difficulty, order). |
| `/luck` | **The luck audit** — hits-per-PHd by hour-of-day and weekday, the myth-buster. |
| `/calc` | Interactive odds calculator (client-side, shares the bot's math). |
| `/address/<bc1q>` | Public odometer for any address: lifetime PHd, best diff, badge odds, orders. |
| `/about` | What Parahawk is, how Parasite payouts work, the tier math, and the tip jar. |

## The Discord commands

| Command | What |
|---------|------|
| `/pot` | Pot age (blocks + hours), pool hashrate, estimated PHd banked, fresh/aging/stale verdict. |
| `/price` | Refinery hashprice in sats/PHd + USD/PHd vs the ~50k fair-value baseline. |
| `/odds <phd>` | 10T / 21T / block chances for a given amount of work + expected pleb return. |
| `/odometer <bc1q>` | An address's lifetime PHd, best diff, luck vs expectation, badge odds. |
| `/watch <bc1q>` / `/unwatch` | Watch an address's Refinery orders — alerts on stuck (0% >2h) and fulfilled. |

Plus the **block alert**: when Parasite finds a block, the bot posts `🥑 FRESH POT — Parasite found block #…` to your configured channel, and its presence shows the live pot age.

---

## How Parasite payouts work (the mental model)

When the pool finds a block:

- the **finder** (whose share solved it) gets **1 BTC**;
- the remaining **~2.15 BTC** — "the pot" — splits among all miners **in proportion to the shares they submitted since the pool's previous block**.

So the pot fills as the pool goes without a block, and resets to zero the instant one lands. That's why Parahawk leads with **pot age** = `(current bitcoin height − Parasite's last-found height) × 10 min`.

The odds math is a Poisson process, `P(≥1 hit in W PHd) = 1 − e^(−W/rate)`, with these rates (all in `src/math/constants.ts`, unit-tested):

| Tier | Rate |
|------|------|
| 🥑 Bravocado (10T+ share) | ~500 PHd |
| 🏠 homeminers (21T+ share) | ~1,050 PHd |
| 🎰 Block (@127T diff) | ~6,300 PHd |

`1 PHd = 20.1G difficulty units`. Sanity checks in the test suite: 500 PHd → 63.2% for a 10T; 75 PH/s → one 10T per ~6.6 days.

---

## Going live (real data + persistence)

```bash
cp .env.example .env
```

Then fill in `.env`. See the sections below — Discord, Supabase, mempool, and the Parasite endpoints are each configured independently.

### 1. Supabase (the database) — ~2 minutes

1. Create a project at [supabase.com](https://supabase.com) (free tier is plenty).
2. Open **SQL Editor → New query**, paste the contents of [`supabase/migrations/20260722000000_init.sql`](supabase/migrations/20260722000000_init.sql), and **Run**. (Or, with the Supabase CLI linked: `supabase db push`.)
3. Go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret key → `SUPABASE_SERVICE_KEY` (server-side only — never ship it to a browser).

With those set, Parahawk writes real samples every ~45s and the charts/luck audit build from live history. Leave them blank to keep the in-memory store (fine for local dev; data is lost on restart).

### 2. Discord bot — full walkthrough

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**. Name it Parahawk.
2. **Bot** tab → **Reset Token** → copy it into `DISCORD_TOKEN`. (You do not need any privileged intents — Parahawk only uses the default `Guilds` intent.)
3. **General Information** → copy **Application ID** into `DISCORD_CLIENT_ID`.
4. Build the invite URL (OAuth2 → URL Generator):
   - **Scopes:** `bot`, `applications.commands`
   - **Bot Permissions:** `Send Messages`, `Embed Links` (that's all it needs)
   - Open the generated URL and add the bot to your server.
5. In Discord, enable Developer Mode (Settings → Advanced), right-click your alerts channel → **Copy Channel ID** → `ALERT_CHANNEL_ID`.
6. (Optional but recommended for testing) right-click your server → Copy Server ID → `DISCORD_GUILD_ID`. Guild commands register instantly; global commands can take up to ~1h.
7. Register the slash commands:
   ```bash
   npm run register-commands
   ```
8. Start Parahawk (`npm run dev` or the production/Docker options below). You'll see `🤖 bot online as …`.

### 3. Real Parasite endpoints

Parasite's API is undocumented. Open **parasite.wtf** with devtools → **Network → XHR**, watch the requests the dashboard makes, and:

1. Set `PARASITE_BASE_URL` and the `PARASITE_*_PATH` vars in `.env` to the real endpoints.
2. Map the real JSON into Parahawk's typed shapes in [`src/data/parasite.ts`](src/data/parasite.ts) — the `mapPoolStats` (and sibling) mappers use sensible field-name fallbacks to start from.
3. Restart.

If the endpoints fail at runtime, Parahawk serves the last-good cached data with a "stale since …" banner and the bot keeps running — it never crashes on upstream errors.

---

## Deploy on a ~$5/mo VPS (Hetzner class)

### Option A — Docker (simplest)

```bash
cp .env.example .env      # fill it in
docker compose up -d --build
docker compose logs -f
```

### Option B — systemd (bare metal)

```bash
sudo useradd -r -s /usr/sbin/nologin parahawk
sudo git clone https://github.com/badbren/parahawk.git /opt/parahawk
cd /opt/parahawk
sudo cp .env.example .env && sudo nano .env     # fill it in
sudo npm ci && sudo npm run build
sudo cp deploy/parahawk.service /etc/systemd/system/
sudo chown -R parahawk:parahawk /opt/parahawk
sudo systemctl daemon-reload && sudo systemctl enable --now parahawk
journalctl -u parahawk -f
```

Put nginx/Caddy in front for TLS and point `PUBLIC_BASE_URL` at your domain. A single small instance runs the web server, the Discord bot, and the pollers together.

---

## Architecture

```
src/
  math/       pure, unit-tested: odds (Poisson), work/diff, pot age, hashprice
  data/       typed Parasite adapter + mempool client + caching
  db/         Store interface → SupabaseStore | MemoryStore; migrations in supabase/
  services/   overview / pot estimate / history / luck audit (shared web+bot)
  pollers/    data collector, block watcher, order watchdog, maintenance
  web/        Express server, terminal-styled server-rendered pages, tip QR
  bot/        discord.js client, slash commands, embeds, command registration
  events.ts   process bus (blockFound / watchAlert) linking pollers → bot
  config.ts   env loading
```

**Graceful degradation** is a design goal: data-source layers cache the last-good value and surface a stale flag; the pollers and bot wrap every async task so a thrown error is logged, never fatal.

### Environment variables

See [`.env.example`](.env.example) for the full, commented list: `PORT`, `PUBLIC_BASE_URL`, `LIGHTNING_ADDRESS`, `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `ALERT_CHANNEL_ID`, `DISCORD_GUILD_ID`, `ENABLE_BOT`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `PARASITE_*`, `MEMPOOL_BASE_URL`, `POLL_INTERVAL_SECONDS`, `BLOCK_POLL_INTERVAL_SECONDS`.

---

## Tips ⚡

Parahawk is free and always will be. If it saves you sats, send some back — set `LIGHTNING_ADDRESS` and your address appears (with a QR) in every embed footer and the site footer.

*Independent community project. Not affiliated with or endorsed by Parasite Pool. Data is best-effort and may be delayed or wrong. Nothing here is financial advice.*
