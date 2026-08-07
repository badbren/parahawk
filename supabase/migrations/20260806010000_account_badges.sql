-- Parasite achievement/badge counts per wallet, indexed by Parahawk from
-- /api/account lookups (there is no badges endpoint, so we accumulate them as
-- winners are snapshotted and wallets are searched). Powers the /badges tab:
-- per-badge holder lists and the most-badges leaderboard.

create table if not exists account_badges (
  address     text primary key,
  badges      jsonb not null default '{}',   -- {badge_type: count}
  updated_at  timestamptz not null default now()
);
create index if not exists account_badges_updated_idx on account_badges (updated_at desc);
