# 001: Dependency Map Precision Gap

## Summary
The current dependency map build/update logic over-associates tests to sources, which violates the spec expectation that mappings reflect actual execution dependencies.

## Spec References
- Section 4, Stage 2 mapping semantics: source-to-dependent-tests lookup and deduplicated union.
- Section 5, dependency map structure and incremental refresh behavior.

## Current Implementation
- `init` can assign all available tests to a covered source when convention fallback does not resolve a direct test:
  - [`src/operations.ts:257`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/operations.ts:257)
- Incremental map refresh can assign all mapped tests to each covered source:
  - [`src/run.ts:641`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/run.ts:641)
  - [`src/run.ts:643`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/run.ts:643)

## Gap
Mappings are broader than observed source-test execution relationships. This can inflate selected test sets and reduce optimization quality.

## Expected Fix
- Use coverage-derived source-test relationships instead of assigning all candidate tests.
- Preserve incremental behavior: only refresh edges observed in the current execution.

## Acceptance Criteria
- For a run with multiple mapped tests, only tests that actually cover a source remain linked to that source.
- `init` and incremental refresh both produce deterministic, minimal source->test mappings.

## Plan
1. Audit the coverage artifacts produced by `coverage_command` (e.g., `coverage-final.json`) to determine whether per-test coverage metadata is already available or if the adapter must run tests individually with instrumentation so that each `test_id` can be paired with the exact source files it exercises. Reference Section 4 Stage 2 semantics while clarifying how the `source → tests` union should be assembled.
2. Rework `init`'s map build (`buildInitEdges`) and the incremental refresh (`upsertCoverageMappings`) so that they rely on coverage-derived edges: for each `test_id` executed, persist only the sources reported as covered by that test and avoid assigning other mapped tests to sources they did not touch. Ensure deduplicated, deterministic storage in `file_tests`, and retain convention fallbacks only when coverage data lacks an entry for a source.
3. Extend regression tests to simulate coverage data with precise source-test pairs, verifying that initial map creation and incremental refresh only keep tests that touched each source, keeping the map deterministic even when multiple tests cover overlapping but not identical files. Add failure cases where convention fallback should be used when coverage is missing.

## Follow-up
- Coordinate the implementation once we can run the adapter against real coverage output, preferably using a dedicated git worktree to avoid conflicts while iterating on the map logic.
- After the code changes land, rerun the spec compliance tests (`test/validate-and-run-contracts.test.js`) with new fixtures that assert the map stays minimal and incremental updates only touch the intended sources.
