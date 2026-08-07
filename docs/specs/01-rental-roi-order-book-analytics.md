# Spec 01 — Rental ROI / Order-Book Analytics

## Goal
Turn the flat `/order-books` table into an analytics view: what miners are actually
*spending* to rent hashrate into Parasite via the Refinery, how well those rentals
fill, and who the biggest renters and providers are. Give a renter a rough "did this
pay off?" read (cost vs. the big share it landed).

## Data source(s) & feasibility
- **`/api/router/orders`** (via `getRouterOrders()` in `src/data/parasite.ts`) — ~2100
  rows, ~349 distinct **full** `bc1q` addresses (`username = "<addr>.refinery"`). This is
  the **only** public place full mining addresses appear. Fields we get per order:
  `status` (active/expired/fulfilled/pending/in_mempool → currently collapsed to
  active/expired/fulfilled), `requested_hash_days`, `hashrate` (H/s), `delivered_hash_days`,
  `best_share`.
- **Cost basis is derivable, not given.** There is no per-order price field. Estimate
  `cost_sats ≈ delivered_hash_days(PHd) × hashprice(sats/PHd)` using
  `hashpriceSatsPerPhd(difficulty, height)` (`src/math/hashprice.ts`) — the same fair-value
  rate the Refinery rents at (~50k sats/PHd). USD via `satsPerPhdToUsd()` and
  `overview.pool.btcPriceUsd`. Label this an **estimate at current hashprice**, since we
  don't have historical per-order fill price.
- **Fill rate** = `delivered_hash_days / requested_hash_days` — already computed as
  `progressPercent`, but `mapRouterOrder()` currently drops the raw `delivered_hash_days`.
  Feasible: expose it.
- **Feasible aggregates:** total delivered PHd, total est. spend, fill-rate distribution,
  active vs expired counts, top-N renters by delivered PHd / spend, per-provider split
  (only `Refinery` vs `UNKNOWN` are distinguishable — keep the existing honesty caveat).

## Proposed UI / placement
Extend `/order-books` (don't add a route). Above the existing table add a stat-card row:
**Total delivered**, **Est. total spend (sats / USD)**, **Active / Expired**, **Median
fill %**, **Distinct renters**. Then a **Top renters** table (address → orders, delivered
PHd, est. spend, best share landed, avg fill %) with addresses linking to `/address/<addr>`.
Keep the raw order table below, paginated/capped as today. Optional "ROI" column on the
renter table: best-share-diff vs est. spend (framed as luck, not a promise).

## Implementation sketch (files to touch)
- `src/data/types.ts` — add `deliveredPhd: number` to `RefineryOrder`.
- `src/data/parasite.ts` — in `mapRouterOrder()`, set `deliveredPhd = delivered / H_PER_PH`
  (already have `delivered`). Keep `address` on the returned rows (already there).
- `src/services/` — new `orderbook.ts`: `getOrderBookAnalytics()` that pulls
  `getRouterOrders()` + `getOverview()` (for hashprice + btcPrice), groups by `address`,
  and returns `{ totals, byProvider, topRenters[], statusCounts }`. Cost per order via
  `hashpriceSatsPerPhd`.
- `src/web/pages/order-books.ts` — render the new cards + top-renters table from the
  service; leave the raw table intact.
- `src/math/hashprice.ts` — reuse as-is (no change).

## Caveats / limits
- **Spend is an estimate.** Hashprice is current-difficulty fair value, not the actual
  price each order filled at; historical fill prices aren't public. State this on the page.
- Provider is only `Refinery` vs `UNKNOWN` — KMH/direct/other proxies are indistinguishable
  (login-gated, route as ordinary workers). Do not invent a KMH book.
- `best_share` is per-order and can be null; a big share is not caused by a rental in a
  provable way — present ROI as "what this address landed while renting," not attribution.
- ~2100 rows is fine to aggregate in-process; cache via the existing `refineryCache` TTL.
