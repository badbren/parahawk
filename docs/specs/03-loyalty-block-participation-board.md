# Spec 03 — Loyalty / Block-Participation Board

## Goal
Surface who shows up: a leaderboard of miners ranked by **blocks participated** (loyalty),
not just by best difficulty. Recognises consistent small miners who never land a 10T share
but grind every round. The data is already being fetched and mostly thrown away.

## Data source(s) & feasibility
- **`/api/leaderboard?type=loyalty&limit=N`** — blocks-participated per (masked) address.
  Already fetched in `getLeaderboard()` (`src/data/parasite.ts`) and mapped into
  `Leaderboard.loyalty[]` (`LeaderboardEntry.blocks`), but currently pulled with
  `limit=25&round=current` and **never rendered** — the board page only uses `.difficulty`.
- **Feasible today, minor change.** For an all-time loyalty board, drop `round=current` and
  raise the limit (e.g. `limit=100`). `mapLbEntry` already reads `total_blocks`/`blocks`.
- **`/api/account/<addr>`** → `metadata.badges` / `block_count` corroborates a single
  address's participation (already used on `/address`), but the board comes from the
  leaderboard call.

## Proposed UI / placement
**Pool tab — `/history`** (`src/web/pages/history.ts`). Blocks-participated is a pool-wide
participation metric (who mines every round), so it sits with the pool analytics, not on the
Bravocados difficulty board — and it avoids duplicating `/board`, which is specifically about
10T+ *difficulty* winners. Add a **"Loyalty — most blocks participated"** table section to
`/history`: `#`, `Address` (masked, no link), `Blocks participated`, optional bar relative to
the leader. Reuse the `addrCell()`/`.tscroll` styling from the board. Nothing on `/board`
changes, so there's no double content.

(If `/history` becomes crowded, a dedicated **"Miners"/"Leaderboards"** tab would be the only
justified new tab — but only if difficulty and loyalty boards are consolidated there together;
default is to keep it on the Pool tab.)

## Implementation sketch (files to touch)
- `src/data/parasite.ts` — in `getLeaderboard()`, change the loyalty fetch to
  `type=loyalty&limit=100` (all-time; drop `round=current`), or fetch **both** and expose
  `loyaltyAllTime` + `loyaltyRound` on `Leaderboard`. Keep the `Promise.all` shape.
- `src/data/types.ts` — extend `Leaderboard` if adding an all-time field.
- `src/web/pages/history.ts` — render `lb.loyalty` (sorted desc by `blocks`) into a new
  table section; handle the empty/`blocks === undefined` case with a "no data" row. Import
  `getLeaderboard()` here (the board already imports it separately — no shared state issue).
- `src/web/pages/board.ts` — no change (stays difficulty-only; avoids duplication).
- No new route or store change required.

## Caveats / limits
- **Addresses are masked** (`bc1q…<last4>`) on the leaderboard, so rows are **not**
  linkable to `/address` (unlike the full-address Refinery table). Render masked, dim, no link.
- "Blocks participated" counts rounds the address submitted any share in — it rewards
  presence, not hashrate; a big renter and a tiny home miner both count once per block.
- Loyalty and difficulty boards can't be joined per-miner (masking); don't cross-reference.
- Confirm the loyalty field name upstream (`total_blocks` vs `blocks`) — the mapper already
  tolerates both, but verify against a live response before shipping.
