-- Hand-typed venue prices (manual_prices, 20260807020000) can now also be
-- updated by visitors holding the "Trusted" badge, from the Marketplace
-- (src/web/price-routes.ts). Every change — theirs and the owner's — is logged
-- so the owner can see who changed what and put it back (/admin → Community
-- price updates), and the owner can block a wallet from editing prices.
--
-- Written by the deployed site only (src/services/manual-prices.ts — local runs
-- keep their edits, log and blocks in data/manual-prices.json, never here).
--
-- Idempotent: safe to run twice. Server-only: RLS is on with no policies; the
-- site uses the service key.

-- Who last set each price (already in the original migration; kept for safety).
alter table manual_prices add column if not exists updated_by text;

-- ── The change log ──────────────────────────────────────────────────────────
create table if not exists manual_price_history (
  id          text             primary key,                 -- app-generated uuid
  venue       text             not null,                    -- 'kissmyhash' | 'braiins' | ...
  old_sats    double precision check (old_sats is null or old_sats >= 0), -- null = no price was set
  new_sats    double precision not null check (new_sats >= 0),            -- 0 = cleared
  usd         double precision,                             -- the USD figure typed, if any
  by_address  text             not null,                    -- the signed-in wallet
  at          timestamptz      not null default now(),
  kind        text             not null default 'update' check (kind in ('update', 'revert')),
  revert_of   text                                          -- for a revert: the change it undid
);
-- The /admin list: newest first.
create index if not exists manual_price_history_at_idx on manual_price_history (at desc);
-- One wallet's recent changes (the pace limits).
create index if not exists manual_price_history_by_at_idx on manual_price_history (by_address, at desc);

alter table manual_price_history enable row level security;

-- ── Wallets blocked from editing prices ─────────────────────────────────────
create table if not exists price_editor_bans (
  address    text        primary key,  -- bech32 lower-cased (src/services/manual-prices.ts addressKey)
  banned_by  text        not null,
  banned_at  timestamptz not null default now()
);

alter table price_editor_bans enable row level security;
