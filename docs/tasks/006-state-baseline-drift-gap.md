# 006: Last Known Good State Baseline Drift

## Summary
Detect stage uses `.test-oracle/state`, and the baseline now advances after each successful run so the pointer stays aligned with the latest known good state.

## Spec References
- Section 4, Stage 1: detect changed files against the last known good state in `.test-oracle/state`.

## Current Implementation
- Detect uses `.test-oracle/state` baseline:
  - [`src/run.ts:328`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/run.ts:328)
- Baseline is written during init:
  - [`src/operations.ts:86-87`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/operations.ts:86-87)
- Successful execute runs now capture `HEAD` by calling `updateStateBaseline(cwd)` and overwrite `.test-oracle/state` so the detect stage always compares against the last passing run:
  - [`src/run.ts:100-120`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/run.ts:100-120)

## Gap
The state pointer can become stale relative to successful run outcomes, which weakens "last known good" semantics. The policy in this document closes the gap by moving the pointer only when a run succeeds and leaving fallbacks in place when git information is unavailable.

## Expected Fix
- Define and implement state advancement policy after successful run completion.
- Ensure fallback behavior remains safe when git baseline cannot be resolved.

## Acceptance Criteria
- After successful run, `.test-oracle/state` reflects the latest accepted baseline according to policy.
- Detect-stage file resolution aligns with documented last-known-good behavior.

## Proposed Baseline Advancement

### Update policy
- When `test-oracle run` finishes with `status: "pass"` and `stage: "execute"`, resolve the current commit via `git rev-parse HEAD` and persist it to `.test-oracle/state`. That commit becomes the new "last known good" reference for the detect stage.
- Do **not** advance the baseline when the run fails, aborts early (detect/map/static), or returns a cache hit; the previous baseline remains the most recent validated point.
- If `git rev-parse HEAD` fails (no commits, git unavailable, detached HEAD, etc.), skip the write but keep the existing baseline and rely on the fallback detection logic in `resolveChangedFiles` (`git diff HEAD` → untracked files) until the repository recovers.

### Implementation guidance
- `src/operations.ts` already exposes `resolveGitBaseline`/`writeStateBaseline` for `init`. Reuse or re-export these helpers in `run.ts` so that, immediately after a passing execute stage and cache update, `run` captures the new baseline.
- Keep the write non-blocking so a transient IO failure cannot convert a passing run into a failure. The detect stage should still function even if `.test-oracle/state` cannot be updated, because `resolveChangedFiles` already falls back to `HEAD`/untracked detection when the file is missing or unreadable.
- Document this sequencing so future contributors understand why the baseline only moves on verified runs, not on every command invocation.
- `run.ts` now wraps the update in an `updateStateBaseline(cwd)` helper that resolves `HEAD` and delegates to the exported helpers, making the intent explicit and easy to test.

### Behavioral impact
- Detect now compares new changes against the most recent run that completed without failures, so the concept of "last known good" matches the behavior described in the spec.
- When baseline writes are skipped or fail, detection still runs against `HEAD` and untracked files, avoiding blocking the developer while preserving best-effort accuracy.
