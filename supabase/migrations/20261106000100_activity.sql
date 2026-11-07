-- Site activity per signed-in wallet — time on Parahawk, days active, searches,
-- chat messages, suggestions — for the Parahawk badges and their perks
-- (src/activity/**). One row per wallet.
--
-- Written by the deployed site only (src/activity/store.ts — local runs write
-- to data/site-activity.json, never here). Time on site is the server's own
-- measurement: each heartbeat credits the time since the previous one, capped
-- (src/activity/rules.ts holds the rules; parahawk_activity_ping mirrors them).
--
-- Idempotent: safe to run twice. Server-only: RLS is on with no policies, and
-- the functions are not callable by the anon/authenticated API roles — the site
-- uses the service key.

create table if not exists site_activity (
  address          text        primary key,          -- the signed-in wallet
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now(),
  last_ping        timestamptz,                       -- last accepted heartbeat
  seconds_on_site  bigint      not null default 0 check (seconds_on_site >= 0),
  active_days      int         not null default 0 check (active_days >= 0),
  last_day         date,                              -- latest UTC day with activity
  self_searches    int         not null default 0 check (self_searches >= 0),
  wallet_searches  int         not null default 0 check (wallet_searches >= 0),
  chat_messages    int         not null default 0 check (chat_messages >= 0),
  suggestions      int         not null default 0 check (suggestions >= 0),
  pool_address     text        check (pool_address is null or pool_address ~ '^bc1[0-9a-z]{6,87}$'),
  -- When each Parahawk badge was first earned: { "<badge id>": <ms> }, 0 = earned
  -- before tracking began (src/activity/earned.ts). New rows start tracked ({}).
  earned_at        jsonb       default '{}'::jsonb
);
-- For a table created by an earlier run of this file.
alter table site_activity add column if not exists earned_at jsonb default '{}'::jsonb;

alter table site_activity enable row level security;
-- Server-only (service key); no public policies.

-- ── Heartbeat: credit time on site ─────────────────────────────────────────
-- Mirrors applyPing() in src/activity/rules.ts: the credit is the whole seconds
-- since the last ping, at most p_max_credit_s, and nothing when the last ping is
-- more than p_max_gap_s ago (a new streak) or not earlier than this one. The row
-- is locked first, so pings for one wallet from many instances queue rather
-- than both crediting the same minute. Returns the row plus `credited`.
create or replace function parahawk_activity_ping(
  p_address text, p_now timestamptz, p_max_credit_s int, p_max_gap_s int
)
returns json
language plpgsql
as $$
declare
  v_day    date := (p_now at time zone 'utc')::date;
  v_prev   site_activity%rowtype;
  v_gap    double precision;
  v_credit int := 0;
begin
  insert into site_activity (address, first_seen, last_seen) values (p_address, p_now, p_now)
  on conflict (address) do nothing;
  select * into v_prev from site_activity s where s.address = p_address for update;

  if v_prev.last_ping is not null and p_now > v_prev.last_ping then
    v_gap := extract(epoch from (p_now - v_prev.last_ping));
    if v_gap <= p_max_gap_s then
      v_credit := least(floor(v_gap)::int, p_max_credit_s);
    end if;
  end if;

  update site_activity s set
    seconds_on_site = s.seconds_on_site + v_credit,
    last_ping       = greatest(coalesce(s.last_ping, p_now), p_now),
    last_seen       = greatest(s.last_seen, p_now),
    active_days     = s.active_days + case when s.last_day is null or v_day > s.last_day then 1 else 0 end,
    last_day        = greatest(coalesce(s.last_day, v_day), v_day)
  where s.address = p_address;

  return (
    select row_to_json(x) from (
      select s.*, v_credit as credited from site_activity s where s.address = p_address
    ) x
  );
end;
$$;

-- ── One event: a search, a chat message, a suggestion ──────────────────────
-- Mirrors applyEvent(): the matching counter +1, last_seen, and a new active
-- day when the UTC day has moved on. Returns the row.
create or replace function parahawk_activity_bump(p_address text, p_kind text, p_now timestamptz)
returns json
language plpgsql
as $$
declare
  v_day date := (p_now at time zone 'utc')::date;
begin
  if p_kind not in ('self_search', 'wallet_search', 'chat_message', 'suggestion') then
    raise exception 'unknown activity kind: %', p_kind;
  end if;

  insert into site_activity as s (
    address, first_seen, last_seen, active_days, last_day,
    self_searches, wallet_searches, chat_messages, suggestions
  ) values (
    p_address, p_now, p_now, 1, v_day,
    (p_kind = 'self_search')::int, (p_kind = 'wallet_search')::int,
    (p_kind = 'chat_message')::int, (p_kind = 'suggestion')::int
  )
  on conflict (address) do update set
    last_seen       = greatest(s.last_seen, p_now),
    active_days     = s.active_days + case when s.last_day is null or v_day > s.last_day then 1 else 0 end,
    last_day        = greatest(coalesce(s.last_day, v_day), v_day),
    self_searches   = s.self_searches   + (p_kind = 'self_search')::int,
    wallet_searches = s.wallet_searches + (p_kind = 'wallet_search')::int,
    chat_messages   = s.chat_messages   + (p_kind = 'chat_message')::int,
    suggestions     = s.suggestions     + (p_kind = 'suggestion')::int;

  return (select row_to_json(s) from site_activity s where s.address = p_address);
end;
$$;

-- ── The address they mine to (null forgets it) ─────────────────────────────
-- Not activity: no day is counted. Returns the row.
create or replace function parahawk_activity_set_pool(p_address text, p_pool text, p_now timestamptz)
returns json
language plpgsql
as $$
begin
  insert into site_activity as s (address, first_seen, last_seen, pool_address)
  values (p_address, p_now, p_now, p_pool)
  on conflict (address) do update set pool_address = excluded.pool_address;

  return (select row_to_json(s) from site_activity s where s.address = p_address);
end;
$$;

-- ── Badge-earned times ─────────────────────────────────────────────────────
-- Merges { badge id: ms } into earned_at; a time already there wins (the first
-- stamp is the real one). A row from before tracking (null) takes the stamps
-- as they are. Returns the row, or null when the wallet has none.
create or replace function parahawk_activity_stamp(p_address text, p_stamps jsonb)
returns json
language plpgsql
as $$
begin
  update site_activity s set earned_at = coalesce(p_stamps, '{}'::jsonb) || coalesce(s.earned_at, '{}'::jsonb)
  where s.address = p_address;
  return (select row_to_json(s) from site_activity s where s.address = p_address);
end;
$$;

-- Functions in the public schema are callable through the API by default. They
-- are the server's alone: take them away from every API role except the service role.
revoke all on function parahawk_activity_ping(text, timestamptz, int, int) from public, anon, authenticated;
revoke all on function parahawk_activity_bump(text, text, timestamptz) from public, anon, authenticated;
revoke all on function parahawk_activity_set_pool(text, text, timestamptz) from public, anon, authenticated;
revoke all on function parahawk_activity_stamp(text, jsonb) from public, anon, authenticated;
grant execute on function parahawk_activity_ping(text, timestamptz, int, int) to service_role;
grant execute on function parahawk_activity_bump(text, text, timestamptz) to service_role;
grant execute on function parahawk_activity_set_pool(text, text, timestamptz) to service_role;
grant execute on function parahawk_activity_stamp(text, jsonb) to service_role;
