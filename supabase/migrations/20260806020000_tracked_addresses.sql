-- Registry of wallets Parahawk indexes: every address searched in the site,
-- plus the pool's contributors we enumerate ourselves (order-book full
-- addresses + matched leaderboard/winners). A background poller round-robins
-- through these (least-recently-snapshotted first) to refresh badges + build
-- per-wallet hashrate timelines, so data fills in without waiting for searches.

create table if not exists tracked_addresses (
  address          text primary key,
  first_seen       timestamptz not null default now(),
  last_snapshot_at timestamptz
);
create index if not exists tracked_addresses_stale_idx
  on tracked_addresses (last_snapshot_at asc nulls first);
