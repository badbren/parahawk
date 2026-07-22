/**
 * Parasite Pool math constants.
 *
 * All "rate" constants are in PHd (petahash-days) of work expected to produce
 * ONE hit of the given tier. A PHd is one petahash-per-second sustained for one
 * day of work — i.e. hashrate(PH/s) × time(days) = work(PHd).
 *
 * Hit model is a Poisson process: P(≥1 hit in W PHd) = 1 − e^(−W / rate).
 *
 * These are empirical/design constants for the pool. If Parasite publishes
 * updated figures, change them here — nothing else should hard-code them.
 */

/** One 10T+ difficulty share ("Bravocado" tier) expected per ~500 PHd. */
export const RATE_10T_PHD = 500;

/** One 21T+ difficulty share ("homeminers" tier) expected per ~1,050 PHd. */
export const RATE_21T_PHD = 1050;

/** One block expected per ~6,300 PHd at network difficulty ~127T. */
export const RATE_BLOCK_PHD = 6300;

/** Network difficulty the block rate is calibrated against (~127 trillion). */
export const CALIBRATION_NETWORK_DIFF = 127e12;

/** Difficulty units represented by one PHd of work: 1 PHd = 20.1G diff units. */
export const PHD_TO_DIFF = 20.1e9;

/**
 * A miner's observed best difficulty typically lands between 1× and 1.5× their
 * total accumulated work (in difficulty units) — the expected maximum of an
 * exponential sequence of share difficulties.
 */
export const BEST_DIFF_WORK_MULTIPLIER_MIN = 1.0;
export const BEST_DIFF_WORK_MULTIPLIER_MAX = 1.5;

/**
 * Empirical expected "pleb share" return for a typical Refinery renter:
 * the pot payout mechanics (1 BTC to finder, ~2.15 BTC split by shares) tend to
 * return roughly 65% of rental cost in expectation over many cycles.
 * Used as the headline figure in /odds. Not a guarantee — it is a long-run mean.
 */
export const PLEB_SHARE_EXPECTED_RETURN = 0.65;

/** Refinery hashprice fair-value baseline, in sats per PHd. */
export const HASHPRICE_FAIR_VALUE_SATS = 50_000;

/** Minutes per bitcoin block on average — used for pot-age time math. */
export const MINUTES_PER_BLOCK = 10;

/** Pool block payout split. */
export const FINDER_REWARD_BTC = 1.0;
export const POT_SPLIT_BTC = 2.15;
