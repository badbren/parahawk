-- Block Hunt leaderboard + stats (PRACTICE), and one-time run tickets.
--
-- Written by the deployed site only (src/game/store.ts — local runs write to
-- data/game-runs.json, never here). Every run's numbers are the server's own:
-- it replays the submitted steer log on the seed inside a ticket it signed
-- (src/game/replay.ts, src/game/ticket.ts). Nothing here is a payout.
--
-- Idempotent: safe to run twice. Server-only: RLS is on with no policies, and
-- the functions are not callable by the anon/authenticated API roles — the site
-- uses the service key.

-- ── Runs ────────────────────────────────────────────────────────────────────
create table if not exists game_runs (
  id             text        primary key,           -- app-generated uuid
  address        text        not null,              -- the signed-in wallet
  played_at      timestamptz not null default now(),-- when the server accepted it
  seed           bigint      not null check (seed between 1 and 4294967295),
  score          int         not null check (score >= 0),
  won            boolean     not null,
  nonces         int         not null default 0 check (nonces >= 0),
  stale          int         not null default 0 check (stale >= 0),
  scrapes        int         not null default 0 check (scrapes >= 0),
  duration_ms    int         not null default 0 check (duration_ms >= 0),
  whites_awarded int         not null check (whites_awarded between 0 and 2)
);
-- Windows (today / week): newest first.
create index if not exists game_runs_played_at_idx on game_runs (played_at desc);
-- A player's record, and their last run (the per-wallet cooldown).
create index if not exists game_runs_address_played_at_idx on game_runs (address, played_at desc);
-- A player's best, and when they first hit it (the leaderboard's tie-break).
create index if not exists game_runs_address_score_idx on game_runs (address, score desc, played_at asc);

-- ── Burns (stats only) ──────────────────────────────────────────────────────
create table if not exists game_burns (
  id        text        primary key,
  address   text        not null,
  burned_at timestamptz not null default now(),
  from_tier text        not null check (from_tier in ('white', 'orange', 'green', 'blue', 'red')),
  to_tier   text        not null check (to_tier in ('orange', 'green', 'blue', 'red', 'prismatic'))
);
create index if not exists game_burns_address_idx on game_burns (address, burned_at desc);

-- ── Spent tickets ───────────────────────────────────────────────────────────
-- A ticket is good once. Its nonce is the primary key, and it is inserted in
-- the same transaction as its run (parahawk_game_record_run), so a second
-- submission of the same ticket — from any instance, at any moment — fails on
-- the key instead of racing a read. Rows only matter until the ticket would
-- have expired (15 min); the record function sweeps old ones now and then.
create table if not exists game_tickets (
  nonce       text        primary key,
  address     text        not null,
  consumed_at timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists game_tickets_expires_at_idx on game_tickets (expires_at);

alter table game_runs enable row level security;
alter table game_burns enable row level security;
alter table game_tickets enable row level security;
-- Server-only (service key); no public policies.

-- ── Record a run: spend its ticket and insert it, both or neither ──────────
-- Returns false (and records nothing) when the ticket was already spent. Any
-- other failure raises, rolling both inserts back, so a run is never lost after
-- its ticket is spent and a ticket is never spent without its run.
create or replace function parahawk_game_record_run(
  p_nonce text, p_expires_at timestamptz,
  p_id text, p_address text, p_played_at timestamptz, p_seed bigint, p_score int, p_won boolean,
  p_nonces int, p_stale int, p_scrapes int, p_duration_ms int, p_whites_awarded int
)
returns boolean
language plpgsql
as $$
declare
  v_constraint text;
begin
  insert into game_tickets (nonce, address, expires_at) values (p_nonce, p_address, p_expires_at);
  insert into game_runs (id, address, played_at, seed, score, won, nonces, stale, scrapes, duration_ms, whites_awarded)
  values (p_id, p_address, p_played_at, p_seed, p_score, p_won, p_nonces, p_stale, p_scrapes, p_duration_ms, p_whites_awarded);
  -- Spent nonces are only needed until their ticket expires; keep an hour of slack.
  if random() < 0.02 then
    delete from game_tickets where expires_at < now() - interval '1 hour';
  end if;
  return true;
exception when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'game_tickets_pkey' then
    return false;
  end if;
  raise;
end;
$$;

-- ── The board: best per address in a window ────────────────────────────────
-- Mirrors aggregateBoard() in src/game/board.ts exactly: best score; ties to
-- whoever hit it first, then fewer runs, then address (byte order). Every row
-- carries the window's totals (players, total_runs).
create or replace function parahawk_game_leaderboard(p_since timestamptz, p_limit int)
returns table (
  address text, best int, best_at timestamptz, runs bigint, wins bigint, whites_won bigint,
  players bigint, total_runs bigint
)
language sql
stable
as $$
  with w as (
    select r.address, r.score, r.won, r.whites_awarded, r.played_at
    from game_runs r
    where p_since is null or r.played_at >= p_since
  ),
  per as (
    select w.address,
           max(w.score)                      as best,
           count(*)                          as runs,
           count(*) filter (where w.won)     as wins,
           coalesce(sum(w.whites_awarded), 0) as whites_won
    from w
    group by w.address
  ),
  firsts as (
    select distinct on (w.address) w.address, w.played_at as best_at
    from w
    join per on per.address = w.address and per.best = w.score
    order by w.address, w.played_at asc
  ),
  totals as (
    select count(*) as total_runs, count(distinct w.address) as players from w
  )
  select per.address, per.best, firsts.best_at, per.runs, per.wins, per.whites_won,
         totals.players, totals.total_runs
  from per
  join firsts on firsts.address = per.address
  cross join totals
  order by per.best desc, firsts.best_at asc, per.runs asc, per.address collate "C" asc
  limit greatest(1, least(p_limit, 100));
$$;

-- ── One player's totals, and their burns by step ───────────────────────────
create or replace function parahawk_game_player_stats(p_address text)
returns table (runs bigint, wins bigint, best int, whites_won bigint, first_at timestamptz, last_at timestamptz)
language sql
stable
as $$
  select count(*), count(*) filter (where r.won), coalesce(max(r.score), 0),
         coalesce(sum(r.whites_awarded), 0), min(r.played_at), max(r.played_at)
  from game_runs r
  where r.address = p_address;
$$;

create or replace function parahawk_game_player_burns(p_address text)
returns table (from_tier text, to_tier text, burns bigint)
language sql
stable
as $$
  select b.from_tier, b.to_tier, count(*)
  from game_burns b
  where b.address = p_address
  group by b.from_tier, b.to_tier;
$$;

-- Functions in the public schema are callable through the API by default. These
-- run as the caller (RLS would stop the anon role anyway), but they are the
-- server's alone: take them away from every API role except the service role.
revoke all on function parahawk_game_record_run(text, timestamptz, text, text, timestamptz, bigint, int, boolean, int, int, int, int, int) from public, anon, authenticated;
revoke all on function parahawk_game_leaderboard(timestamptz, int) from public, anon, authenticated;
revoke all on function parahawk_game_player_stats(text) from public, anon, authenticated;
revoke all on function parahawk_game_player_burns(text) from public, anon, authenticated;
grant execute on function parahawk_game_record_run(text, timestamptz, text, text, timestamptz, bigint, int, boolean, int, int, int, int, int) to service_role;
grant execute on function parahawk_game_leaderboard(timestamptz, int) to service_role;
grant execute on function parahawk_game_player_stats(text) to service_role;
grant execute on function parahawk_game_player_burns(text) to service_role;
