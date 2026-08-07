# Parahawk → Parasite Pool: API wishlist

Things that, if the Parasite team were open to adding them, would meaningfully
improve what [Parahawk](https://brenbot.io) can show the community. Each is
grounded in a real limitation we hit building the site. Ordered by impact.
Several are just "fix a mislabeled field" or "raise a limit" — cheap wins.

---

## Tier 1 — the big unlocks

**1. Per-wallet work in the current round (shares/work since the last block).**
This is the #1 ask. There's no way to get a miner's *round* contribution — the
`round=current` difficulty leaderboard returns their best-ever share, not their
cumulative round work (we verified: the round diffs sum to ~500T while
`workSinceLastBlock` is ~188T, and a miner's "round" diff equals their all-time
diff). Without it we can only *estimate* "your cut if the pot cracks now."
→ *Unlocks:* an exact, honest per-wallet projected payout for everyone.
*Ideal:* a `round_work` (difficulty units) field on `/api/user/<addr>` and/or
`/api/account/<addr>`, and on the `round=current` leaderboard rows.

**2. Full (or opt-in unmasked) miner addresses — or a badges endpoint.**
Addresses are masked (`bc1q…last4`) everywhere except the current Refinery order
book (~349 addresses), so we can only look up badges/stats for a small slice of
the ~3k miners. To fetch any wallet's badges we need its *full* address, which
isn't exposed.
→ *Unlocks:* complete badge/achievement counts, a real "most badges"
leaderboard, and per-wallet pages for everyone — not just current renters.
*Ideal (any one of these):* a `GET /api/badges/<type>` returning holders; an
aggregate `GET /api/badges` with per-type totals; or an opt-in "show my full
address publicly" flag miners can toggle.

**3. A public badges/achievements definition endpoint.**
There's no `/api/badges` (404). We had to reverse-engineer badge type keys
(`bravocado`, `block_winner`, `block`, `refinery`, `loyalty`, `dispenser`,
`miner`) from account metadata and name/describe them ourselves.
→ *Unlocks:* accurate names, icons, tiers, and "how to earn it" text that stays
in sync with whatever Parasite ships.
*Ideal:* `GET /api/badges` → `[{key, name, description, how_to_earn, tiers}]`.

---

## Tier 2 — fills real gaps

**4. Deeper round history.** `/api/rounds` only returns ~6 completed rounds.
→ *Unlocks:* a full pool-luck index, pot-length distribution, and Hall of Fame
(longest droughts / biggest pots) instead of just the last few.
*Ideal:* `?limit=` (and ideally `?offset=`) honored on `/api/rounds`, with a
`found_at` timestamp per round.

**5. Per-address historical hashrate.** Only a live snapshot exists per wallet.
We build 14-day per-wallet hashrate charts by polling and storing it ourselves,
so they only fill in going forward.
→ *Unlocks:* instant per-wallet hashrate history.
*Ideal:* `/api/user/<addr>/historical?period=&interval=` mirroring the existing
pool `/api/pool-stats/historical`.

**6. Deeper big-share history.** `/api/highest-diff` caps at 500 blocks (~3.5
days) and returns one top diff per block.
→ *Unlocks:* an all-time 10T+ hit feed / per-miner hit history, rather than only
the recent window.
*Ideal:* a higher/paginated limit, and ideally *all* ≥10T shares per block, not
only the single top one.

**7. Order book: history, price, and timestamps.** `/api/router/orders` is
current-only (~349 addresses, ~2,100 orders), with no order placed/filled
timestamps and no price-paid per order.
→ *Unlocks:* accurate rental spend/ROI (right now cost is *estimated* at the
live hashprice), all-time renter stats, and rental-vs-hit correlation.
*Ideal:* `created_at`/`filled_at`, `price_sats_per_phd` (what the order paid),
and a paginated historical orders endpoint.

---

## Tier 3 — small fixes / nice-to-haves

**8. Fix the `lastBlockTime` field.** On `/api/pool-stats` it holds a block
*height* (a string), not a time — mislabeled. We fetch the real block time from
mempool.space to get accurate pot age.
→ *Ideal:* a real `last_block_time` (unix seconds) alongside the height.

**9. Link Bravocado ordinals to mining addresses.** Cado recipients are `bc1p`
ordinal wallets with no public link to the `bc1q` mining address that earned
them, so we can't show "cados held" per miner (only "cados won" from badges).
→ *Ideal:* an optional mapping, or expose the earning `bc1q` address on the
dispensary transfer.

**10. A user/miner list endpoint.** `/api/users`, `/api/miners`, `/api/accounts`
all 404, and leaderboards cap at ~999 masked rows.
→ *Ideal:* a paginated list (even masked) with the fields above would help a lot.

**11. Historical `total_diff` (or a round-start snapshot).** `total_diff` is a
great monotonic lifetime-work counter, but only the current value is available —
so we can't reconstruct a wallet's work as of the last block for a round already
in progress.
→ *Ideal:* `total_diff_at_last_block` on the account, or any historical read.

---

*Framing for the ask:* most of these are additive and cheap (a field here, a
`limit` param there, one new read-only endpoint). #1 (round work) and #2 (badge
holders / full addresses) are the two that would unlock the most, and #8 is
basically a one-line label fix. Parahawk is open source
(github.com/badbren/parahawk) and happy to consume whatever shape is easiest for
them to expose.
