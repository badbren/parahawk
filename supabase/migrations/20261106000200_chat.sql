-- Chat: one shared room on the desktop (src/web/chat-routes.ts).
--
-- Written by the deployed site only (src/chat/store.ts — local runs write to
-- data/chat.json, never here). Every row comes from a signed-in wallet: the
-- server only accepts posts from an address that proved itself with a BIP-322
-- signature. Display names are NOT stored here; they are looked up at read
-- time, so a rename shows on old messages too.
--
-- Idempotent: safe to run twice. Server-only: RLS is on with no policies, so
-- the anon/authenticated API roles can neither read nor write; the site uses
-- the service key.

create table if not exists chat_messages (
  id          bigint      generated always as identity primary key,
  address     text        not null,                -- the signed-in wallet
  body        text        not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now(),  -- when the server accepted it
  deleted     boolean     not null default false,  -- deletes only mark; open windows are told
  deleted_at  timestamptz,
  deleted_by  text                                 -- the author, or the owner
);

-- The per-wallet limits: one address's recent posts, newest first.
create index if not exists chat_messages_address_created_idx on chat_messages (address, created_at desc);
-- "Drop these" for open windows: recent deletions by id.
create index if not exists chat_messages_deleted_id_idx on chat_messages (id) where deleted;

alter table chat_messages enable row level security;
-- Server-only (service key); no public policies.
