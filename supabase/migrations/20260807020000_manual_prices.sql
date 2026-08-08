-- Admin-set manual prices for venues without a public price feed (KMH, Braiins,
-- etc.). The owner reads the venue's logged-in quote and punches the number in;
-- the board shows it as "manual · updated Xm ago", never dressed up as live.

create table if not exists manual_prices (
  venue         text primary key,          -- 'kissmyhash' | 'braiins' | ...
  sats_per_phd  double precision not null,  -- the manual figure
  note          text,                       -- optional context
  updated_by    text,                       -- admin wallet address
  updated_at    timestamptz not null default now()
);

alter table manual_prices enable row level security;
-- Server-only (service key); no public policies.
