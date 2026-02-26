# 005: `status` Cache Hit Rate Missing

## Summary
The spec expects cache hit rate in `status`, but current output leaves it `null`.

## Spec References
- Section 3 (`status`): report cache state including hit rate.

## Current Implementation
- `status` returns `hit_rate: null` unconditionally:
  - [`src/operations.ts:154`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/operations.ts:154)

## Gap
Cache hit rate is not computed or persisted, so status cannot report this metric.

## Expected Fix
- Track cache lookup outcomes (hit/miss) in `.test-oracle/` state.
- Compute and return deterministic `hit_rate` in `status`.

## Acceptance Criteria
- After multiple runs with both hits and misses, `status.cache.hit_rate` is numeric and accurate.
- Behavior remains deterministic across invocations.
