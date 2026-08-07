# Spec 02 — Pool Momentum / Hashrate Volatility

## Goal
A single at-a-glance read on where pool hashrate is headed: short-vs-long moving-average
crossover ("heating up / cooling down"), a volatility band, and a plain-language momentum
label. Answers "is the pool growing, shrinking, or just noisy right now?"

## Data source(s) & feasibility
- **`/api/pool-stats/historical?period=<>&interval=<>`** — the bucketed hashrate history
  already used by `/history` and by `getHistorical()` / `getPoolStatsSeries()` in
  `src/data/parasite.ts`. Rows carry `timestamp` (seconds) + `hashrate15m` (H/s), plus
  `users`/`workers`. `avgOverDays(rows, days)` already computes trailing means; `PoolStats`
  already exposes `avg1dPhs`, `avg6dPhs`, `avg9dPhs`.
- **Fully feasible from existing data.** Momentum = short MA vs long MA
  (e.g. 1d vs 6d, both already computed). Volatility = stdev of `hashrate15m` over a window
  ÷ mean (coefficient of variation), a band of ±1σ around the mean. No new endpoint needed.
- Network difficulty is **not** in `/api/pool-stats` (comes from mempool via
  `src/data/mempool.ts`) — not needed here; this is pool hashrate only.

## Proposed UI / placement
**Pool tab — `/history`** (`src/web/pages/history.ts`). This is pool-hashrate analytics, so
it belongs with the existing hashrate chart, not on a new tab or the homepage. Add a compact
**"Pool momentum"** header card above the hashrate chart:
- Big label: **Heating up ▲ / Cooling down ▼ / Steady →**, driven by `(avg1d − avg6d) / avg6d`.
- Sub-line: `+X% vs 6d avg`, and a **volatility** chip (Calm / Choppy / Wild from the CoV).
- Then overlay the short/long **MA lines + shaded ±1σ band** directly on the *existing*
  `/history` hashrate chart rather than drawing a second chart — this augments, does not
  duplicate, what's already there.

A tiny homepage echo (one-line "🔥 pool heating up +6% vs 6d, links to /history") is optional
and secondary; the feature's home is the Pool tab.

## Implementation sketch (files to touch)
- `src/services/` — new `momentum.ts`: `getMomentum()` reads the historical rows
  (reuse `getHistorical()` or a small fetch of `period=7d&interval=1h`), computes
  `shortMaPhs`, `longMaPhs`, `changePct`, `stdevPhs`, `covPct`, and a `label`
  (`heating`/`cooling`/`steady`) + `volatility` (`calm`/`choppy`/`wild`) via fixed
  thresholds. Pure, unit-testable.
- `src/web/pages/history.ts` — add the momentum header card and overlay the MA lines + ±1σ
  band onto the existing hashrate chart (reuse its Chart.js setup; no second chart).
- `src/data/parasite.ts` (`getPoolStatsSeries`) — optionally return the MA/band series
  alongside the raw hashrate points; no new endpoint.
- `src/web/pages/overview.ts` — optional one-line homepage echo linking to `/history`.
- `src/math/` — optional `stats.ts` for `mean`/`stdev` if not already present.

## Caveats / limits
- Buckets are coarse (`hashrate15m`, 30m–1h intervals) — momentum reflects hours, not
  seconds; label thresholds must have a dead-band so it doesn't flip on noise.
- Pool hashrate is inherently spiky (rentals switch on/off), so **volatility is expected to
  be high** — calibrate "Wild" against real observed CoV, not an equity-market intuition.
- No difficulty-retarget context here; a "cooling" pool during a network-wide dip is normal.
- Historical endpoint occasionally returns fewer rows than requested; guard against
  short windows (already the pattern — fall back to whatever rows exist).
