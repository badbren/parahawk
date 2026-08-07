# Spec 04 — Richer Per-Wallet Address Page

## Goal
Grow `/address/<addr>` from a snapshot into a mini profile: (a) a **rental spend summary**
for that wallet's Refinery orders, (b) a **best-diff-per-block timeline** from its user-diffs,
and (c) a **forward-collected 14-day hashrate timeline** — the last one requires Parahawk to
start recording snapshots, because no per-address history endpoint exists.

## Data source(s) & feasibility
- **Rental spend** — `getRouterOrders()` filtered by `address` is already wired into
  `getUserStats()` as `u.orders`. Feasible now: sum `deliveredPhd × hashprice` (see Spec 01)
  for a spend total, active vs expired counts, total delivered PHd. Full address, so this is
  the wallet's real order book.
- **Best-diff-per-block timeline** — `/api/highest-diff?address=<full>&type=user-diffs&limit=N`
  is **already fetched** in `getUserStats()` but collapsed to a single `diffsMax`. Feasible:
  keep the array (`{block_height, difficulty, block_timestamp}`) and chart it. **Recent
  window only** — this endpoint returns the address's best share per *recent* block, not
  all-time.
- **14d hashrate timeline** — **NOT feasible from the API**: there is no historical hashrate
  series per address anywhere. `/api/user/<addr>` gives only the *current* `hashrate`.
  Requires a **new forward-collecting poller** writing `AddressSnapshot` rows. The store
  interface already has `insertAddressSnapshot()` / `getAddressSnapshots()` (`src/db/types.ts`)
  — but **nothing writes them today**. So the chart is empty until the poller runs and
  backfills going forward (it can never show history from before it started).

## Proposed UI / placement
On `/address` (`src/web/pages/address.ts`), after the existing cards:
- **Rental spend card** near the "Refinery orders" table: est. total spend (sats/USD),
  delivered PHd, active/expired.
- **Best-diff timeline** chart (Chart.js, as `/history` & `/cados` do): x = block height /
  time, y = difficulty, marking 10T/21T lines. Label "recent blocks."
- **Hashrate timeline** chart from `getAddressSnapshots(address, N)`; show an empty-state
  ("collecting — check back in a day") until enough points exist.

## Implementation sketch (files to touch)
- `src/data/parasite.ts` — expose the user-diffs array on `UserStats` (e.g.
  `bestDiffTimeline: {height, difficulty, ts}[]`) instead of discarding it; add
  `deliveredPhd` to orders (shared with Spec 01).
- `src/data/types.ts` — extend `UserStats` with the timeline + keep `orders`.
- `src/pollers/` — new `address-snapshots.ts` (or extend `pollers/index.ts`): on interval,
  for a **watched/known address set** (e.g. Discord `listWatches()` addresses + recently
  viewed), call `getUserStats()` and `store.insertAddressSnapshot({address, ts, hashrate,
  bestDifficulty, totalWork})`. Wire into `startPollers()` and `runPollOnce()`. Add
  `runMaintenance` pruning for old snapshots.
- `src/web/pages/address.ts` — render the spend card + two charts; reuse `jsonForScript()`
  and the existing chart CSS/CDN pattern.

## Caveats / limits
- **The hashrate chart is forward-only** — no backfill possible; be explicit that history
  starts when Parahawk began recording, and only for addresses in the collection set.
- Snapshotting *every* address is infeasible/abusive (each `getUserStats` fans out to 4
  upstream calls). Scope the poller to watched + on-demand addresses, respect the existing
  `USER_STATS_TTL_MS` cache and `upstreamLimiter`.
- user-diffs is a recent window, not all-time — never present it as the wallet's full career.
- Spend is an estimate at current hashprice (same caveat as Spec 01).
- In-memory store loses snapshots on restart; the persistent timeline needs Supabase
  (`hasSupabase()`), which is currently pending — note this in the empty-state copy.
