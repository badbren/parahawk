-- Daily traffic: unique visitors (by hashed IP) + page views per UTC day.
--
-- Populated by a client beacon — the browser pings the uncached /hit endpoint
-- once per page load and the function upserts a row here (awaited) before it
-- responds. We store a salted SHA-256 prefix of the IP, never the raw address,
-- so a "visitor" is a privacy-preserving per-day fingerprint.

create table if not exists traffic_daily (
  day        date        not null,
  ip_hash    text        not null,
  hits       int         not null default 0,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (day, ip_hash)
);
create index if not exists traffic_daily_day_idx on traffic_daily (day);

alter table traffic_daily enable row level security;
-- Server-only (service key); no public policies.

-- Atomic upsert-increment for one visit. Called by the /hit beacon route.
create or replace function parahawk_track_hit(p_day date, p_ip_hash text)
returns void
language plpgsql
as $$
begin
  insert into traffic_daily (day, ip_hash, hits, first_seen, last_seen)
  values (p_day, p_ip_hash, 1, now(), now())
  on conflict (day, ip_hash) do update
    set hits = traffic_daily.hits + 1,
        last_seen = now();
end;
$$;

-- Per-day totals: distinct visitors (rows) and total views (sum of hits).
create or replace view traffic_daily_totals as
select
  day,
  count(*)::int     as visitors,
  sum(hits)::bigint as views
from traffic_daily
group by day;

-- True distinct visitors + total views over the trailing 7- and 30-day windows,
-- as a single row. Distinct-over-a-window can't be recovered by summing daily
-- visitor counts, so it's computed here directly.
create or replace function parahawk_traffic_windows()
returns table (
  visitors_7d  bigint,
  views_7d     bigint,
  visitors_30d bigint,
  views_30d    bigint
)
language sql
stable
as $$
  select
    count(distinct ip_hash) filter (where day >= current_date - 6)        as visitors_7d,
    coalesce(sum(hits)      filter (where day >= current_date - 6),  0)    as views_7d,
    count(distinct ip_hash) filter (where day >= current_date - 29)       as visitors_30d,
    coalesce(sum(hits)      filter (where day >= current_date - 29), 0)    as views_30d
  from traffic_daily;
$$;
