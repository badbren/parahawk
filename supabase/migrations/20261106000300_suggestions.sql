-- Suggestions: a title and some notes for the owner, from the desktop's
-- Suggestions window, and the owner's read/done marks on them.
--
-- Written by the deployed site only (src/suggestions/store.ts — local runs write
-- to data/suggestions.json, never here). Who sent a suggestion comes from the
-- server session, never from the request body; guests' suggestions have no
-- address. Lengths match src/suggestions/rules.ts (title 3–120, notes 1–4000).
--
-- Idempotent: safe to run twice. Server-only: RLS is on with no policies, so
-- the anon/authenticated API roles can neither read nor write; the site uses
-- the service key.

create table if not exists suggestions (
  id         text        primary key,                  -- app-generated uuid
  created_at timestamptz not null default now(),       -- when the server accepted it
  title      text        not null check (char_length(title) between 3 and 120),
  notes      text        not null check (char_length(notes) between 1 and 4000),
  address    text,                                     -- the signed-in sender, null for a guest
  status     text        not null default 'new' check (status in ('new', 'read', 'done'))
);

-- The inbox: newest first.
create index if not exists suggestions_created_at_idx on suggestions (created_at desc);
-- The per-address daily cap.
create index if not exists suggestions_address_created_at_idx on suggestions (address, created_at desc) where address is not null;
-- The owner's "N new" badge.
create index if not exists suggestions_new_idx on suggestions (created_at desc) where status = 'new';

alter table suggestions enable row level security;
-- Server-only (service key); no public policies.
