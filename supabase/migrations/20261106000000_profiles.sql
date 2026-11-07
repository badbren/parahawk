-- Parahawk profiles, keyed by the signed-in wallet address: display name,
-- privacy, profile picture.
--
-- Written by the deployed site only (src/profile/store.ts — local runs write to
-- data/profiles.json, never here). A row exists once an address has set a name,
-- a picture or its privacy; clearing the name keeps the row (and its rename
-- counter) with nulls.
--
-- "That name is taken" is this table's answer: name_key is the name with case,
-- spaces and _ - . removed (src/profile/rules.ts nameKey), and it is unique, so
-- "Bad.Bren" can never sit beside "badbren" no matter which server instance
-- saved it.
--
-- uid is a random, permanent id: links to someone who keeps their wallet
-- private are /u/~<uid>, so they never spell out the address. The app sets it
-- for new rows; the default covers rows made any other way.
--
-- Pictures are small (the Profile window sends 128×128, the server refuses
-- anything over 48 KB or 512 px, PNG/JPEG/WebP only — src/profile/avatar.ts)
-- and stored inline as base64; avatar_ver is a hash of the picture, part of its
-- URL, so a new picture is a new URL and old ones can be cached forever.
--
-- Idempotent: safe to run twice, and safe over the first version of this file.
-- Server-only: RLS is on with no policies — the site uses the service key; the
-- anon/authenticated API roles see nothing.

create table if not exists site_profiles (
  address        text        primary key,           -- canonical: bech32 lower-cased, base58 as-is
  uid            text        not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  display_name   text        check (display_name is null or char_length(display_name) between 3 and 20),
  name_key       text,
  is_private     boolean     not null default false,
  avatar_type    text        check (avatar_type is null or avatar_type in ('image/png', 'image/jpeg', 'image/webp')),
  avatar_b64     text        check (avatar_b64 is null or char_length(avatar_b64) <= 70000),
  avatar_ver     text,
  changes_day    date,                               -- the UTC day changes_today counts
  changes_today  int         not null default 0 check (changes_today >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint site_profiles_name_and_key check ((display_name is null) = (name_key is null))
);

-- Columns added after the first version of this file (no-ops on a fresh table).
alter table site_profiles add column if not exists uid text not null default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
alter table site_profiles add column if not exists is_private boolean not null default false;
alter table site_profiles add column if not exists avatar_type text check (avatar_type is null or avatar_type in ('image/png', 'image/jpeg', 'image/webp'));
alter table site_profiles add column if not exists avatar_b64 text check (avatar_b64 is null or char_length(avatar_b64) <= 70000);
alter table site_profiles add column if not exists avatar_ver text;

-- One holder per name, ignoring case and separators.
create unique index if not exists site_profiles_name_key_idx on site_profiles (name_key) where name_key is not null;
-- Profile links by uid.
create unique index if not exists site_profiles_uid_idx on site_profiles (uid);

alter table site_profiles enable row level security;
revoke all on table site_profiles from anon, authenticated;
