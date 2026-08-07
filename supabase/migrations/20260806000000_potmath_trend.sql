-- Pot Math 24h-trend support.
-- Store the two Pot Math inputs (W and D, in T) on every poll sample so the
-- Calculator card can compare today's figures against ~24h ago and show the
-- direction each equation-derived number is trending. Older rows keep NULL and
-- are simply skipped when picking the 24h baseline.

alter table poll_samples
  add column if not exists work_since_block_t double precision,  -- W, in T
  add column if not exists min_needed_diff_t  double precision;  -- D, in T
