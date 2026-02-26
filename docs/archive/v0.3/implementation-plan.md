# test-oracle v0.3 Implementation Plan

## Scope Decision

This v0.3 plan is intentionally narrow and step-by-step:

- Complete `test-oracle run` Stage 4 (static checks) and Stage 5 (execute).
- Keep scope to Node/TS adapter path already in progress.
- Do not start broader future work in this cycle.

## Goal

Move `run` from preflight/mapping behavior to actual execution behavior:

1. run configured static checks and fail early when they fail.
2. execute mapped tests with fail-fast semantics.
3. return structured Stage 4/5 result payloads.
4. update dependency map incrementally after execution.

## Deliverables

1. Stage 4 implementation
- `static_checks` command runner with structured failure output.
- Early return contract: `{ status: "fail", stage: "static", ... }`.

2. Stage 5 implementation
- Node adapter-backed test execution for mapped tests only.
- Fail-fast behavior from config/default.
- Structured per-run failure details in result payload.

3. Stage 5 map refresh
- Coverage parse on execution run.
- Incremental update of `file_tests` entries for covered files.

4. Result contract completion
- Replace current execute-stage `not_implemented` path.
- Ensure final response includes `status`, `stage`, `tests_run`, `failed_test`, `error`, `duration_ms`, `map_updated`, `static_checks_passed`.

5. Test coverage for Stage 4/5
- Integration tests for static-check failure short-circuit.
- Integration tests for execute pass/fail.
- Regression tests for existing v0.2 trigger contracts.

## Step-by-Step Execution Plan

### Step 1: Stage 4 runner
- Build a small command-runner utility for static checks.
- Parse first token for display (`check` field).
- Stop immediately on first failing check.
- Return structured failure payload and skip test execution.

### Step 2: Node execute runner
- Implement Node execution function for mapped test files.
- Use `test_command` with mapped targets appended.
- Apply fail-fast flag from config (`fail_fast`, default `true`).
- Capture exit status, stderr/stdout summary, and duration.

### Step 3: Execution result shaping
- Convert runner output into canonical `run` result format.
- Set `stage: "execute"` on execute outcomes.
- Populate `failed_test` best-effort from framework output.

### Step 4: Incremental map update
- Parse coverage output produced during mapped execution.
- Upsert only covered source->test edges touched by current run.
- Set `map_updated` accurately (`true` only on successful refresh).

### Step 5: End-to-end tests
- Add fixtures for:
  - static check fails -> stage static fail
  - execute fail-fast fail -> stage execute fail
  - execute pass -> stage execute pass
- Keep existing v0.2 tests green.

## Acceptance Criteria

- `run` no longer returns `not_implemented` when tests are mapped.
- Static check failure prevents Stage 5 execution.
- Mapped tests run with fail-fast semantics.
- Structured outputs match spec fields for Stage 4/5 outcomes.
- Dependency map gets incrementally updated after execution runs.

## Out of Scope (for this v0.3 cycle)

- New ecosystem adapters (Python/Rust/Go).
- Monorepo support.
- Shared/remote cache.
- Skill/prompt changes beyond consuming existing CLI outputs.
