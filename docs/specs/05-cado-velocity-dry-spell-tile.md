# Spec 05 — Cado Velocity / Dry-Spell Tile

## Goal
A small "when did the last Bravocado drop, and are we overdue?" tile: **days/hours since the
last cado**, the **current dry spell vs. the median gap**, and a simple overdue/on-pace read.
Gives the community a live pulse on Bravocado cadence.

## Data source(s) & feasibility
- **`getCadoData()`** (`src/services/cados.ts`) already computes everything needed on-chain
  from the OMB dispensary wallet's transfers (via mempool.space, cached ~30 min). It returns
  `lastTs`, `firstTs`, `count`, `medianGapHours`, and the full sorted `awards[]`.
- **Fully feasible, no new fetch.** Derive:
  - `sinceLastHours = (now − lastTs) / 3.6e6`
  - `dryVsMedian = sinceLastHours / medianGapHours` → **Overdue** (>1.5×), **On pace**
    (~1×), **Fresh** (recent drop).
  - Optional: longest historical dry spell = max gap across `awards[]` (currently only the
    *median* is computed — add a `maxGapHours` if we want "record dry spell").

## Proposed UI / placement
**Bravocados tab — `/board`** (`src/web/pages/board.ts` → `renderCadosBody()` in
`src/web/pages/cados.ts`). This is Bravocado cadence, so it belongs on the Bravocados tab.
Add **"Days since last cado"** and **"Current dry spell"** cards to the *existing* cado
stat-card grid, which already shows Cados awarded, Span, Busiest day/hour, and **Median gap**
— extend that same `<div class="grid">` rather than adding a new section, so it reads as one
block and doesn't duplicate the median-gap card already there.

A compact homepage echo (`/`, `src/web/pages/overview.ts`) — "🥑 Last Bravocado 3d ago ·
1.8× median · overdue", linking to `/board` — is optional and secondary; the feature's home
is the Bravocados tab.

## Implementation sketch (files to touch)
- `src/services/cados.ts` — extend `CadoData` with `maxGapHours` (compute alongside
  `medianGapHours` from the same `gaps` array) if we want the record dry spell; `lastTs` and
  `medianGapHours` already exist for the core tile, so this is optional.
- `src/web/pages/cados.ts` — add the "days since last" + "dry spell vs median" cards to the
  existing grid; compute `sinceLastHours` and the `overdue/on-pace/fresh` label inline from
  `c.lastTs` / `c.medianGapHours`. Reuse `fmtDuration`/`fmtInt`.
- `src/web/pages/overview.ts` — optional homepage tile calling `getCadoData()` (already
  cached) and rendering the one-liner.
- No store, poller, or new-endpoint changes.

## Caveats / limits
- **Award time is the transfer time**, when the dispensary *sent* the cado — it tracks but
  isn't identical to the qualifying-share moment (already documented in `cados.ts`).
- **Small sample** (`count` is modest) → the median gap is noisy; present the dry-spell read
  as a vibe, not a prediction. Keep the existing "read the trend, not any single bar" tone.
- Recipients are `bc1p` **ordinal** wallets, not `bc1q` mining addresses — the tile is about
  *cadence*, and can't be joined to any miner's stats.
- The first ~100 cados went one-at-a-time to hitters in order (see board copy); early gaps
  reflect distribution policy, not miner luck — consider computing velocity over recent
  awards only if early history skews the median.
- Data is cached ~30 min, so "since last cado" is accurate to within the cache TTL.
