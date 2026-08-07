-- Non-custodial linked venue accounts: a user's OWN NiceHash/MRR API key,
-- scoped to placing orders (never withdrawal), used to fire hashpower orders
-- from their own balance. Keys are encrypted at rest by the app (AES-256-GCM
-- under KEYS_SECRET) BEFORE they reach here — this table only ever holds
-- ciphertext + a masked last-4 for display. RLS on; the app uses the service
-- key. Never expose key_cipher/secret_cipher to any client.

create table if not exists linked_accounts (
  address       text not null,                 -- owner (their bitcoin address)
  venue         text not null,                 -- 'nicehash' | 'miningrigrentals'
  org_id        text,                          -- NiceHash organization id (not secret)
  key_masked    text not null,                 -- '…a1b2' for display only
  key_cipher    text not null,                 -- AES-256-GCM blob of the API key
  secret_cipher text not null,                 -- AES-256-GCM blob of the API secret
  created_at    timestamptz not null default now(),
  primary key (address, venue)
);

alter table linked_accounts enable row level security;
-- No anon/public policies: only the server's service key may read/write.
