-- Hourly-ish snapshots of per-badge totals so the /badges page can show a 24h
-- growth % (e.g. Refinery +2.1% as more orders land). account_badges only holds
-- current state; this is the time series to diff against.

create table if not exists badge_totals (
  id       bigserial primary key,
  ts       timestamptz not null default now(),
  totals   jsonb not null default '{}',   -- {badge_key: summed_count}
  holders  jsonb not null default '{}'    -- {badge_key: holder_count}
);
create index if not exists badge_totals_ts_idx on badge_totals (ts desc);

alter table badge_totals enable row level security;
-- Server-only (service key); no public policies.
