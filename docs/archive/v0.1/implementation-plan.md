# test-oracle v0.1 Implementation Plan

## Intent Alignment

This implementation targets the product intent in `test-oracle-spec.md`:

- Never run the full test suite during normal development loops.
- Select and run only impacted tests using a deterministic dependency map.
- Keep orchestration deterministic and LLM-agnostic.
- Keep `.test-oracle.yml` agent-managed and read-only from the CLI.
- Return structured JSON for all normal outcomes and failures.

## Deliverables

1. CLI foundation with commands: `init`, `run`, `status`, `validate`, `reset`.
2. Deterministic `run` orchestrator with six pipeline stages from the spec.
3. Node/TS adapter (Vitest/Jest + coverage parsing via c8/Istanbul JSON).
4. Persistent state: dependency map (`.test-oracle/map.db`), cache, state file.
5. Validation/status/reset commands with structured output contracts.
6. Automated tests covering stage behavior, error contracts, and cache/map logic.
7. Trigger-compatible CLI responses for Section 14 prompts (`no_config`, validation errors, config-related run errors).

## Phase Plan

## Phase 1: Contracts and Command Skeleton

### Goal
Create a stable CLI surface and response model before wiring behavior.

### Scope
- Command router and handlers.
- Shared JSON result writer and error envelope.
- Type definitions for `RunResult`, `ValidationResult`, `StatusResult`.

### Exit Criteria
- Every command responds with structured JSON.
- Unknown command or invalid args returns structured error output.

## Phase 2: Config and State Subsystems

### Goal
Implement deterministic config loading and persisted state access.

### Scope
- `.test-oracle.yml` parser and validator.
- `.test-oracle/` layout helper.
- SQLite map schema creation and CRUD helpers.
- Cache hash/read/write/eviction and `state` file helpers.

### Exit Criteria
- Config checks match validation expectations in the spec.
- Map and cache persistence can be exercised in isolation tests.

## Phase 3: Node/TS Adapter

### Goal
Deliver P0 adapter support for targeted test execution and map updates.

### Scope
- Full-suite coverage run for `init`.
- Coverage parser to normalize `source_path -> test_id` dependencies.
- Mapped test execution with fail-fast.
- Adapter capability checks for command resolution.

### Exit Criteria
- `init` can produce initial map entries from coverage.
- `run` can execute only selected test targets.

## Phase 4: `run` Pipeline Orchestrator

### Goal
Implement all six stages with early-return semantics.

### Scope
- Stage 1 Detect: changed files from `--files` or git baseline.
- Stage 2 Map: lookup + convention fallback.
- Stage 3 Cache: pass hit short-circuit, fail hit re-run.
- Stage 4 Static checks: stop on first failure.
- Stage 5 Execute: run mapped tests, parse result, refresh map entries.
- Stage 6 Result: emit final payload and store pass cache entries.

### Exit Criteria
- All stage outcomes return expected structured result shape.
- Pipeline behavior matches skip/fail/pass branches in the spec.

## Phase 5: Operational Commands

### Goal
Provide operational visibility and repair paths.

### Scope
- `validate` against project and map conditions, including explicit missing-config error contract.
- `status` for map freshness/cache state/config validity.
- `reset` to clear map/cache and force re-init workflow.

### Exit Criteria
- Commands provide machine-readable outputs suitable for agent handling.

## Phase 6: Test Coverage and Hardening

### Goal
Lock deterministic behavior and prevent contract regressions.

### Scope
- Unit tests for config/map/cache/orchestrator helpers.
- Integration tests for all commands.
- Golden JSON contract tests for key success/failure paths.

### Exit Criteria
- Test suite validates stage-by-stage behavior and error contracts.
- JSON output contracts are stable and documented.

## Phase 7: Skill-Prompt Compatibility (v0.4 Tracking)

### Goal
Ensure CLI outputs are stable inputs for Section 14 init/update prompts used by the skill layer.

### Scope
- Verify `validate` missing-config response shape for init-prompt triggering.
- Verify `validate` invalid-config response shape for update-prompt triggering.
- Verify config-related `run` errors remain canonical and machine-parseable.

### Exit Criteria
- Prompt trigger conditions in Section 14 map directly to observed CLI outputs.

## Out of Scope for v0.1

- Python/Rust/Go adapters.
- Monorepo multi-ecosystem support.
- Remote/distributed cache.
- CI platform-specific orchestration.
- Config generation or mutation by CLI.
- Authoring the Section 14 prompts in skill files (tracked for v0.4 skill work).

## Acceptance Criteria (v0.1)

- `test-oracle run` does not run full suite in normal dev loops.
- Changed source files map to a minimal deduplicated test set.
- Pass cache hits skip execution; fail cache hits re-run execution.
- All normal and error paths return structured JSON.
- `.test-oracle.yml` is never written by CLI code.
