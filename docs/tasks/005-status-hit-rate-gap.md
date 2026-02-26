# 005: `status` Cache Hit Rate Missing

`status` must report the cache hit rate, but today `hit_rate` stays `null`.

## Spec References
- Section 3 (`status`): report cache state including hit rate.

## Current Implementation
- `status` always returns `hit_rate: null`; cache bookkeeping is limited to counting `.json` files. [`src/operations.ts:154`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/operations.ts:154)
- `run` only writes a cache entry on success and never records that the entry was read.

## Gap
No counters exist to tell `status` how many cache lookups were hits vs. misses, so the hit rate cannot be derived.

## Expected Fix
- Introduce a `.test-oracle/cache-metrics.json` object that records `hits`, `misses`, and a last-updated timestamp whenever the cache is read (see `src/cacheMetrics.ts` for helpers).
- In `run`, read the metrics before touching the cache; after a cache lookup, increment either `hits` (pass entry returned) or `misses` (no pass entry) and persist the file. The file should live alongside `map.db`/`cache/` and stay deterministic (increments only on cache checks).
- In `status`, read the same metrics file and compute `hit_rate = hits / (hits + misses)` with a 0 fallback when the denominator is zero, then return that number inside `cache.hit_rate`.
- In `reset`, delete the metrics file so future `status` calls start the counters over again.

## Tests
- Extend `test/operations-and-cache.test.js` to assert that, after one run (miss) followed by a cache hit, `status.cache.hit_rate` equals `0.5`.
- Add a test that proves invoking `reset` clears the `hit_rate` back to `0`.

## Acceptance Criteria
- After runs that produce both hits and misses, `status.cache.hit_rate` is a finite number equal to `hits / (hits + misses)`.
- Resetting the workspace deletes the metrics file so the next `status` reports `hit_rate: 0`.
