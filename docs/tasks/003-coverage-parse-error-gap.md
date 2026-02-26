# 003: `coverage_parse_error` Contract Not Emitted

## Summary
The spec requires a structured `coverage_parse_error`, but current code does not emit it when coverage artifacts are missing/unparseable.

## Spec References
- Section 11 error handling table: `coverage_parse_error` scenario.

## Current Implementation
- Error constructor exists:
  - [`src/output.ts:82`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/output.ts:82)
- No call sites use the constructor.
- Coverage failures currently degrade to generic init failure or `map_updated: false` in `run`:
  - [`src/operations.ts:58`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/operations.ts:58)
  - [`src/run.ts:563`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/run.ts:563)

## Gap
Coverage parse/availability failures are not surfaced via the canonical error envelope requested by spec.

## Expected Fix
- Emit `coverage_parse_error` when coverage JSON is absent, invalid, or unusable for mapping.
- Keep error payload structured and deterministic.

## Acceptance Criteria
- Coverage parse failure scenarios return `{ kind: "error", error: "coverage_parse_error", ... }`.
- Tests cover malformed coverage JSON and missing coverage artifact paths.
