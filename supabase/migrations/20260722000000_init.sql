-- Parahawk initial schema
-- Time-series pool/chain samples + block cycles + watch subs + address snapshots.
-- Apply via `supabase db push` (linked project) or paste into the SQL editor.

-- ── Raw poll samples (every 30–60s) ─────────────────────────────────────────
create table if not exists poll_samples (
  id                    bigint generated always as identity primary key,
  ts                    timestamptz not null default now(),
  pool_hashrate         double precision,   -- PH/s
  hashprice             double precision,   -- sats per PHd
  users                 integer,
  workers               integer,
  chain_height          integer,
  last_found_height     integer,
  best_diff_since_block double precision,
  btc_price             double precision    -- USD
);
create index if not exists poll_samples_ts_idx on poll_samples (ts desc);

-- ── Hourly rollups (raw pruned after 7 days; rollups kept long-term) ─────────
create table if not exists poll_rollups_hourly (
  bucket                timestamptz primary key,   -- truncated to the hour
  pool_hashrate_avg     double precision,
  pool_hashrate_max     double precision,
  hashprice_avg         double precision,
  users_avg             double precision,
  workers_avg           double precision,
  best_diff_since_block_max double precision,
  btc_price_avg         double precision,
  sample_count          integer
);

-- ── Completed pot cycles (one row per block Parasite finds) ──────────────────
create table if not exists blocks_found (
  height                integer primary key,       -- bitcoin height of the found block
  found_at              timestamptz not null default now(),
  cycle_duration_blocks integer,                   -- blocks since previous found block
  est_cycle_phd         double precision           -- integrated pool PHd banked in that pot
);
create index if not exists blocks_found_found_at_idx on blocks_found (found_at desc);

-- ── Discord watch subscriptions (/watch <bc1q>) ─────────────────────────────
create table if not exists watch_subscriptions (
  id            bigint generated always as identity primary key,
  discord_user_id text not null,
  channel_id    text not null,
  address       text not null,
  created_at    timestamptz not null default now(),
  -- watchdog bookkeeping so we don't spam:
  last_zero_alert_at timestamptz,
  last_progress double precision,
  last_order_state jsonb,
  unique (discord_user_id, address)
);
create index if not exists watch_subscriptions_address_idx on watch_subscriptions (address);

-- ── Address odometer snapshots (for /address history + luck audit joins) ─────
create table if not exists address_snapshots (
  id             bigint generated always as identity primary key,
  address        text not null,
  ts             timestamptz not null default now(),
  hashrate       double precision,   -- PH/s
  best_difficulty double precision,
  total_work     double precision    -- difficulty units
);
create index if not exists address_snapshots_addr_ts_idx on address_snapshots (address, ts desc);

-- ── 10T+ share hits ("Bravocado" board) ─────────────────────────────────────
-- Individual big shares seen by the pool: who hit it, how big, which order.
create table if not exists share_hits (
  id         text primary key,          -- stable id for dedupe across polls
  ts         timestamptz not null,
  address    text not null,
  difficulty double precision not null, -- share difficulty (e.g. 1.2e13 = 12T)
  tier       text not null,             -- '10T' | '21T' | 'block'
  order_id   text,
  worker     text
);
create index if not exists share_hits_ts_idx on share_hits (ts desc);
create index if not exists share_hits_address_idx on share_hits (address);

-- ── Luck-audit bucket helper view ───────────────────────────────────────────
-- Aggregates best-diff observations by hour-of-day and day-of-week so the
-- /luck page can compare hits-per-PHd across buckets. Uses UTC.
create or replace view luck_buckets as
select
  extract(dow  from ts)::int as day_of_week,   -- 0=Sun .. 6=Sat
  extract(hour from ts)::int as hour_of_day,
  count(*)                    as samples,
  avg(pool_hashrate)          as avg_hashrate,
  max(best_diff_since_block)  as max_best_diff,
  avg(best_diff_since_block)  as avg_best_diff
from poll_samples
group by 1, 2;

-- ── Rollup + prune: aggregate raw samples >7 days old into hourly rollups,
-- then delete them. Call periodically (Parahawk calls it hourly via RPC). ─────
create or replace function parahawk_rollup_and_prune()
returns void
language plpgsql
as $$
begin
  insert into poll_rollups_hourly as r (
    bucket, pool_hashrate_avg, pool_hashrate_max, hashprice_avg,
    users_avg, workers_avg, best_diff_since_block_max, btc_price_avg, sample_count
  )
  select
    date_trunc('hour', ts) as bucket,
    avg(pool_hashrate), max(pool_hashrate), avg(hashprice),
    avg(users), avg(workers), max(best_diff_since_block), avg(btc_price), count(*)
  from poll_samples
  where ts < now() - interval '7 days'
  group by 1
  on conflict (bucket) do update set
    pool_hashrate_avg = excluded.pool_hashrate_avg,
    pool_hashrate_max = excluded.pool_hashrate_max,
    hashprice_avg = excluded.hashprice_avg,
    users_avg = excluded.users_avg,
    workers_avg = excluded.workers_avg,
    best_diff_since_block_max = excluded.best_diff_since_block_max,
    btc_price_avg = excluded.btc_price_avg,
    sample_count = excluded.sample_count;

  delete from poll_samples where ts < now() - interval '7 days';
end;
$$;
