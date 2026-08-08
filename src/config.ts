import "dotenv/config";

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}

function int(v: string | undefined, dflt: number): number {
  const n = v ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : dflt;
}

/**
 * Central config. MOCK_DATA defaults to true so the entire system runs with
 * zero credentials — `npm run dev` serves the site in mock mode out of the box.
 */
export const config = {
  mockData: bool(process.env.MOCK_DATA, true),
  port: int(process.env.PORT, 3000),
  /** Public base URL of the site, used for links in Discord embeds. */
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "",

  lightningAddress: process.env.LIGHTNING_ADDRESS ?? "",

  /** Secret that encrypts users' linked venue API keys at rest (AES-256-GCM).
   * Min 16 chars to enable the vault; unset ⇒ linking disabled (non-custodial
   * ordering stays dark rather than storing keys in the clear). */
  keysSecret: process.env.KEYS_SECRET ?? "",

  /** Venue referral codes — baked into deep-links / signup paths. Venue pays us,
   * never the user; disclosed on every ref link. */
  venueRefs: {
    nicehash: process.env.NICEHASH_REF ?? "",
    miningrigrentals: process.env.MRR_REF ?? "",
  },

  /** Master safety switch for placing REAL money orders via linked keys. Off by
   * default: the order flow runs as a dry-run (touches no venue API) until this
   * is explicitly set true. Real orders should only ever go live deliberately. */
  orderingLive: bool(process.env.ORDERING_LIVE, false),

  /** Owner wallet address allowed into /admin (manual venue prices, etc.). Access
   * still requires a wallet signature, so publishing the address is harmless.
   * Defaults to badbren's owner wallet; override with ADMIN_ADDRESS. */
  adminAddress: (process.env.ADMIN_ADDRESS ?? "bc1q7a5e65ge8gsln973mzr990245fjhava0tcc4mn")
    .trim()
    .toLowerCase(),

  discord: {
    enabled: bool(process.env.ENABLE_BOT, true),
    token: process.env.DISCORD_TOKEN ?? "",
    clientId: process.env.DISCORD_CLIENT_ID ?? "",
    alertChannelId: process.env.ALERT_CHANNEL_ID ?? "",
    guildId: process.env.DISCORD_GUILD_ID ?? "",
  },

  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    serviceKey: process.env.SUPABASE_SERVICE_KEY ?? "",
  },

  parasite: {
    baseUrl: process.env.PARASITE_BASE_URL ?? "",
    poolStatsPath: process.env.PARASITE_POOL_STATS_PATH ?? "/api/pool",
    userStatsPath: process.env.PARASITE_USER_STATS_PATH ?? "/api/user",
    refineryPath: process.env.PARASITE_REFINERY_PATH ?? "/api/refinery",
  },

  mempool: {
    baseUrl: process.env.MEMPOOL_BASE_URL ?? "https://mempool.space/api",
  },

  pollIntervalSeconds: int(process.env.POLL_INTERVAL_SECONDS, 45),
  blockPollIntervalSeconds: int(process.env.BLOCK_POLL_INTERVAL_SECONDS, 30),
} as const;

/** True when we have real Supabase credentials to persist to. */
export function hasSupabase(): boolean {
  return Boolean(config.supabase.url && config.supabase.serviceKey);
}

/** True when the Discord bot has enough config to start. */
export function canStartBot(): boolean {
  return config.discord.enabled && Boolean(config.discord.token);
}
