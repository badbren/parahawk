# 06 — Badges: per-wallet display, badge filter, and most-badges board

Status: proposed · Owner: badbren · Depends on: Supabase store, existing winners/cados services

## Goal

Give the Parasite Pool community a first-class "Badges" experience across three surfaces:

1. **Badge display** on the per-wallet page (`/address/<addr>`) — show which Parasite badges an
   address holds and how many of each.
2. **Badge filtering** — from a badge, open a list of *all* addresses that hold it (e.g. the ~40
   addresses with the `bravocado` "cado/mushroom" badge).
3. **Most-badges leaderboard** — a ranked top-N of addresses by badge count, filterable by badge
   type.

Parasite exposes badges **per-account only** (no aggregate endpoint), so surfaces 2 and 3 require
Parahawk to enumerate accounts into its own store. This spec describes that enumeration, a new
store table, a background poller, a read service, and the UI.

## Data sources & feasibility

Base: `https://parasite.space`. Verified facts this design is built around:

- **No badges endpoint.** `/api/badges` → 404. The *only* place badges appear is
  `/api/account/<full-addr>` → `account.metadata.badges.types`, a map of
  `badgeType → { total, bucket:{count}, unique:[…] }`. `total` is the count held. Verified type
  keys: `block`, `block_winner`, `bravocado`, `dispenser`, `loyalty`, `miner`, `refinery`.
  `getUserStats()` in `src/data/parasite.ts` already parses this map (see `badgeTotal(...)`), but
  currently only forwards four of the seven types (`bravocado`→`cadosWon`,
  `block_winner`→`blocksFound`, `block`→`blocksParticipated`, `refinery`→`refineryOrderCount`).
- **Per-address only.** The single way to learn an address's badges is to fetch that account. There
  is no way to ask "who holds badge X" directly.
- **Address masking.** Every leaderboard/highest-diff endpoint masks addresses as `bc1q…<last4>`.
  **Full** bc1 addresses come from exactly one place: `/api/router/orders` (~349 rental addresses).
  `src/services/winners.ts` already matches masked→full by *unique* last-4 against the order book.
- **Cado shortcut.** `/api/leaderboard?type=difficulty&limit=100` (no round) returns all-time best
  diff per address; entries ≥10T (~40) are exactly the `bravocado` holders. `getCadoWinners()`
  already derives this cheaply — so the cado badge's holder list needs no per-account enumeration.
- **General ranking proxy.** `/api/leaderboard?type=loyalty&limit=N` gives blocks-participated
  ranking; an unknown `type` falls back to a `combined_score` ranking. Useful for *seeding* the
  enumeration universe, not for badge counts.

**Enumeration requirement (the crux).** Because there is no aggregate endpoint, the filter list and
the most-badges board can only be built by iterating a **bounded address universe**, fetching each
`/api/account`, and storing the per-address badge counts. The enumerable universe is:

- all **full** addresses from `/api/router/orders` (~349), plus
- all-time **difficulty** and **loyalty** leaderboard entries **matched to full** via the order-book
  last-4 join (reusing `winners.ts`), plus
- any wallet a user has already searched (fold in `address_snapshots.address` /
  `share_hits.address`).

**Honest limits.** Only addresses in that universe can ever appear in the filter list or the board.
A miner who has never rented (so never appears in the order book) stays masked and cannot be
enumerated by full address — with the **one exception** of the cado badge, whose full holder set is
derivable from the ≥10T leaderboard directly. So: the cado filter is ~complete; every other badge's
list is "holders we can resolve," not "all holders." The UI must say so.

## Proposed UI / placement

**Decision: a NEW top-level `/badges` tab, in the "bravocados" nav group** (`src/web/layout.ts`
`NAV_GROUPS`, alongside `["/board","bravocados"]` and `["/wiki","mr.v wiki"]`). Justification: the
Bravocados board (`/board`) is already dense (cado award analytics + all-time winners + current-round
10T club + top-100 diff) and is specifically the *cado* story. Badges span seven types (miner,
loyalty, dispenser, refinery, block…), so folding a seven-type filter + a most-badges leaderboard
into `/board` would bury it and blur the page's identity. A dedicated tab also gives the badge-filter
"window" a natural home (`/badges?type=<key>`). The cado badge cross-links between the two.

Three placements:

1. **`/address` badge row** — a new "Badges" card grid under the existing "Badge progress" section
   in `src/web/pages/address.ts`. Render one chip per held badge (`total > 0`): glyph + label +
   count, e.g. `🥑 Bravocado ×2`, `⛏️ Miner`, `💠 Loyalty ×140`. Each chip links to
   `/badges?type=<key>` (the filter window). Requires exposing the full badge map (see below) rather
   than the four hand-picked fields.
2. **`/badges` landing** — a summary card per badge type (label, glyph, holder count = rows in the
   store for that type, "coverage" note), each linking to its filter view. Plus the **most-badges
   leaderboard**: top-N addresses by summed badge count, with a badge-type filter (`?type=`) that
   re-ranks by that single badge's count. Addresses render via the existing `addrCell` convention
   (full = clickable `/address/…`, masked = dim).
3. **`/badges?type=<key>` filter window** — the full list of enumerable addresses holding that badge,
   ranked by that badge's count then best diff, with the coverage caveat inline. For `type=bravocado`
   this can additionally fold in `getCadoWinners()` so the list is ~complete.

Reuse the board's `.tscroll` sticky-header table styling and the `renderPage`/nav chrome. No new
client JS beyond the existing 45s `location.reload()` if desired.

## Implementation sketch

### 1. Store table + migration

New table (snake_case, matching existing tables). DDL applied in Supabase (this project ships SQL
by hand; maintenance runs via the `parahawk_rollup_and_prune` RPC — add this table's DDL to the same
schema file/migration set):

```sql
create table if not exists account_badges (
  address     text        not null,
  badge_type  text        not null,   -- block | block_winner | bravocado | dispenser | loyalty | miner | refinery
  count       integer     not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (address, badge_type)
);
create index if not exists account_badges_type_count_idx
  on account_badges (badge_type, count desc);
```

### 2. Store interface + both implementations

Extend `Store` in `src/db/types.ts` and implement in **both** `src/db/supabase.ts` and
`src/db/memory.ts` (parity is required — `memory.ts` is the mock/dev store):

```ts
export interface AccountBadge { address: string; badgeType: string; count: number; updatedAt: number; }

// on Store:
upsertAccountBadges(rows: AccountBadge[]): Promise<void>;      // upsert onConflict "address,badge_type"
getBadgeHolders(badgeType: string, limit: number): Promise<AccountBadge[]>;      // order by count desc
getTopByBadgeCount(limit: number, badgeType?: string): Promise<Array<{ address: string; total: number }>>;
                                                              // sum(count) grouped by address, or filtered to one type
```

Supabase side mirrors the existing `upsert(..., { onConflict })` / `select().order().limit()`
patterns; `getTopByBadgeCount` without a type is a grouped sum (do it via an RPC/view, or read rows
and aggregate in JS given the small universe ≈ a few hundred addresses).

### 3. Background enumerator poller

New task in `src/pollers/index.ts`, wired exactly like the existing `collect`/`hits` tasks (wrapped
in `safe(...)`, primed once, then `setInterval`; and folded into `runPollOnce()` for the serverless
cron path). Sketch:

```
async function enumerateBadges() {
  const universe = dedupe([
    ...(await getRouterOrders()).map(o => o.address),
    ...(await getCadoWinnerAddresses()),           // matched full winners (winners.ts)
    // + full-matched loyalty leaderboard, + previously-seen searched addresses
  ]).filter(isBc1);
  for (const batch of chunk(universe, BATCH_SIZE)) {   // throttle: respect rate limits
    const results = await Promise.all(batch.map(a => fetchAccountBadges(a)));  // /api/account
    await store.upsertAccountBadges(results.flat());
    await sleep(THROTTLE_MS);                            // batch/throttle between chunks
  }
}
```

- **Rate limits:** small batches (~5–10) with a delay between chunks; the whole universe is only a
  few hundred accounts, so a full sweep on a slow interval (e.g. every 30–60 min via a new
  `BADGE_ENUM_INTERVAL_*` config, default long) is plenty. Never let it throw (the `safe` wrapper
  already guarantees this).
- Add a thin `fetchAccountBadges(address)` in `src/data/parasite.ts` that fetches `/api/account` and
  returns the full `badges.types` map as `{ badgeType, count }[]` (reuse the existing `badgeTotal`
  logic; currently that logic is inline in `getUserStats` — factor it out and reuse).
- Mock mode: seed a handful of deterministic rows so `/badges` renders without credentials, mirroring
  `mockWinners()` in `winners.ts`.

### 4. Read service

New `src/services/badges.ts` (cached ~5–10 min like `winners.ts`/`cados.ts`):

- `getBadgeHolders(type)` → rows from `store.getBadgeHolders`, decorated with clickable/masked status.
- `getMostBadges(limit, type?)` → `store.getTopByBadgeCount`.
- `getBadgeSummary()` → per-type holder counts + coverage note for the `/badges` landing cards.
- A shared `BADGE_META` map: `key → { label, glyph, blurb }` for the 7 known types (single source of
  truth used by both `/address` chips and `/badges`).

### 5. UI

- `src/data/parasite.ts` / `UserStats` (`src/data/types.ts`): add `badges: Record<string, number>`
  (the full map) so `/address` can render every held badge, not just the four current fields.
- `src/web/pages/address.ts`: add the "Badges" card row using `badges` + `BADGE_META`.
- New `src/web/pages/badges.ts`: landing (summary cards + most-badges table), and the
  `?type=<key>` filter view; register route in `src/web/server.ts`; add `["/badges","badges"]` to
  `NAV_GROUPS` and pass `active:"badges"` to `renderPage`.

## Caveats / limits

- **Coverage, not completeness.** Every badge list except `bravocado` shows only enumerable
  (order-book-matched or previously-searched) addresses. State this on each list; show
  `resolved / (resolved + masked-only)` where derivable (mirrors the board's "openable wallets"
  copy). The `bravocado` list is ~complete via the ≥10T leaderboard.
- **Staleness.** Counts are as fresh as the last enumeration sweep (`updated_at`); surface the
  oldest `updated_at` as a freshness hint. Between sweeps a new badge won't appear.
- **Masking is upstream.** We can't unmask an address Parasite masks unless it rented — this is a
  hard data-source limit, not a Parahawk bug.
- **No new badge types assumed.** Enumerate whatever keys `badges.types` returns (store is
  key-agnostic); `BADGE_META` supplies labels for known keys and falls back to the raw key otherwise,
  so an unforeseen type still lists, just unstyled.
- **Rate-limit discipline.** The enumerator is the only place Parahawk fans out across hundreds of
  accounts — keep batches small, the interval long, and always behind the `safe()` wrapper and the
  `config.mockData` short-circuit.
```
