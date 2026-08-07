-- Orders the Marketplace wizard knows about — placed via a linked API venue, or
-- marked done by the user for a deep-link venue. Powers the Delivery Auditor and
-- a user's order history. No funds ever flow through Parahawk; this is a record
-- of orders the user made from their own venue account.

create table if not exists wizard_orders (
  id            text primary key,          -- app-generated id (or venue order id)
  address       text not null,             -- owner / payout address
  venue         text not null,             -- nicehash | miningrigrentals | refinery | kissmyhash
  phd           double precision not null, -- total petahash-days ordered
  ph_rate       double precision,          -- PH/s speed
  duration_hrs  double precision,          -- rental length
  pool_target   text,                      -- stratum host:port aimed at
  sats_paid     bigint,                    -- what the user paid, if known
  status        text not null default 'placed', -- placed | dryrun | done | expired | cancelled
  placed_at     timestamptz not null default now()
);
create index if not exists wizard_orders_address_idx on wizard_orders (address, placed_at desc);

alter table wizard_orders enable row level security;
-- Server-only (service key); no public policies.
