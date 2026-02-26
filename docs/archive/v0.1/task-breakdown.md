# test-oracle v0.1 Task Breakdown

## Tasking Principles

- Each task maps to the core intent: minimal impacted-test execution, deterministic behavior, structured JSON, and agent-managed config.
- Tasks are ordered for dependency-safe execution.
- Each task includes explicit completion checks so implementation can proceed without additional decisions.

## Workstream A: CLI Core and Contracts

### A1. Bootstrap project CLI entrypoint
- Intent reference: deterministic engine and single command surface.
- Deliverable: command dispatcher for `init`, `run`, `status`, `validate`, `reset`.
- Acceptance: invoking each command path returns JSON (including placeholder/status responses).

### A2. Define shared result/error types
- Intent reference: machine-readable output for agent workflows.
- Deliverable: typed models for run/validate/status/error payloads.
- Acceptance: all handlers use shared types; no free-form stderr in normal paths.

### A3. Implement shared JSON writer and exit policy
- Intent reference: strict structured output contract.
- Deliverable: single utility for output serialization and exit code decisions.
- Acceptance: commands produce parseable JSON in success/failure cases.

## Workstream B: Config and Validation Foundation

### B1. Implement config loader for `.test-oracle.yml`
- Intent reference: CLI reads config only; does not mutate.
- Deliverable: parser + shape checks for required/optional fields.
- Acceptance: missing/invalid config returns structured `no_config` or validation-style errors.

### B2. Implement command resolvability checks
- Intent reference: deterministic preflight before execution.
- Deliverable: PATH resolution checks for `test_command`, `coverage_command`, `static_checks`.
- Acceptance: unresolved command returns structured `command_not_found`.

### B3. Implement pattern validation
- Intent reference: ensure mapped selection logic has valid inputs.
- Deliverable: match checks for `test_pattern` and `source_patterns`.
- Acceptance: zero-match patterns are reported in `validate.errors`.

### B4. Implement explicit `no_config` validate path
- Intent reference: Section 14 init-prompt trigger must be deterministic.
- Deliverable: when `.test-oracle.yml` is absent, `validate` returns `{ error: "no_config", ... }` envelope.
- Acceptance: missing config does not return generic invalid schema payload.

## Workstream C: Persistent State Layer

### C1. `.test-oracle/` filesystem manager
- Intent reference: CLI stateless between invocations; state on disk only.
- Deliverable: path helpers for map, cache, state, metadata.
- Acceptance: initialization creates expected directories/files as needed.

### C2. SQLite dependency map module
- Intent reference: dependency map is source of truth.
- Deliverable: schema creation (`file_tests`, `map_meta`), upsert/query/delete helpers.
- Acceptance: per-file query returns stable deduplicated test IDs; metadata keys persist.

### C3. Cache module
- Intent reference: skip unchanged successful runs.
- Deliverable: content hash builder, cache read/write, TTL eviction logic.
- Acceptance: pass hit short-circuits; fail hit never short-circuits.

### C4. State baseline module
- Intent reference: deterministic changed-file detection.
- Deliverable: read/write helpers for last known good state pointer.
- Acceptance: detect stage can compare current state against stored baseline.

## Workstream D: Node/TS Adapter (v0.1)

### D1. Implement adapter interface and registry
- Intent reference: ecosystem abstraction without LLM logic.
- Deliverable: `TestAdapter` contract + adapter lookup by `ecosystem`.
- Acceptance: unknown ecosystem returns `unknown_ecosystem`.

### D2. Implement full-suite coverage run (`generateMap`)
- Intent reference: bootstrapping dependency map via instrumentation.
- Deliverable: adapter command runner for coverage command and raw coverage capture.
- Acceptance: `init` can trigger coverage run and receive parseable output.

### D3. Implement coverage parser (`parseCoverage`)
- Intent reference: derive source-to-test edges from real execution.
- Deliverable: normalized dependency extraction from c8/istanbul JSON artifacts.
- Acceptance: parser outputs deterministic `FileDependency[]` records.

### D4. Implement mapped test execution (`runTests`)
- Intent reference: run only mapped tests with fail-fast.
- Deliverable: adapter test runner for selected test IDs and normalized test results.
- Acceptance: failures include failing test identifiers and actionable error text.

## Workstream E: Command Implementations

### E1. Implement `init`
- Intent reference: first full run to build map.
- Deliverable: command flow for config check -> coverage run -> map rebuild -> metadata update.
- Acceptance: `.test-oracle/map.db` populated; `last_full_run` updated.

### E2. Implement `run` Stage 1 (Detect)
- Intent reference: only act on changed source files.
- Deliverable: `--files` override + git-diff baseline detection + source pattern filter.
- Acceptance: no changed sources returns `skip/no_changes`.

### E3. Implement `run` Stage 2 (Map)
- Intent reference: minimal mapped set with fallback safety net.
- Deliverable: map query union/dedupe + convention fallback for unmapped files.
- Acceptance: empty mapped set returns `skip/no_tests_mapped`.

### E4. Implement `run` Stage 3 (Cache)
- Intent reference: avoid redundant execution.
- Deliverable: hash over changed sources + mapped tests + config; cache lookup rules.
- Acceptance: pass hit returns `source=cache`; fail hit proceeds to next stage.

### E5. Implement `run` Stage 4 (Static checks)
- Intent reference: fail early before expensive test execution.
- Deliverable: sequential check runner with scoped args where possible.
- Acceptance: first failure returns `stage=static` and halts execution.

### E6. Implement `run` Stage 5 (Execute + map update)
- Intent reference: targeted run and continuous map freshness.
- Deliverable: adapter run for mapped tests and incremental map refresh for covered files.
- Acceptance: execution updates only touched map entries; captures duration and test outcomes.

### E7. Implement `run` Stage 6 (Result + pass cache write)
- Intent reference: deterministic structured output and cache persistence.
- Deliverable: final run payload builder and pass-result cache write.
- Acceptance: success writes pass cache entry; response includes required fields.

### E8. Implement `validate`
- Intent reference: enable agent self-healing loop.
- Deliverable: dual-mode response:
  1) error envelope for missing config, 2) structured `valid/errors/warnings` for present config.
- Acceptance: detects pattern issues, command issues, stale/deleted map references, and emits stable trigger outputs for Section 14 prompts.

### E9. Implement `status`
- Intent reference: operational observability for humans and agents.
- Deliverable: map freshness stats, cache stats/hit-rate, config validation summary.
- Acceptance: stable structured status payload across clean and populated states.

### E10. Implement `reset`
- Intent reference: explicit recovery path for stale/broken state.
- Deliverable: clear map/cache/state and return reset result.
- Acceptance: post-reset `run` behaves as no-map/no-init state.

## Workstream F: Testing and Verification

### F1. Unit tests for modules
- Intent reference: deterministic behavior guarantees.
- Deliverable: tests for config, map, cache, hash, pattern matching, and result builders.
- Acceptance: module-level edge cases covered (missing files, invalid config, TTL expiry).

### F2. Pipeline behavior tests
- Intent reference: exact stage semantics in `run`.
- Deliverable: tests for each short-circuit branch and execution branch.
- Acceptance: all stage outcomes match spec-defined statuses and reasons.

### F2a. Prompt-trigger contract tests
- Intent reference: Section 14 depends on stable CLI trigger outputs.
- Deliverable: tests asserting:
  1) `validate` without config returns `error=no_config`,
  2) `validate` invalid config returns `valid=false`,
  3) config-related `run` failures emit canonical error codes.
- Acceptance: Section 14 triggers are machine-detectable without heuristics.

### F3. Integration tests by command
- Intent reference: end-to-end agent usability.
- Deliverable: fixture project tests for `init/run/status/validate/reset`.
- Acceptance: command outputs remain parseable and schema-conformant.

### F4. Golden contract tests
- Intent reference: preserve output compatibility.
- Deliverable: JSON snapshots/contracts for representative outputs and errors.
- Acceptance: contract diffs fail CI unless intentionally updated.

## Suggested Execution Order

1. A1-A3
2. B1-B3
3. C1-C4
4. D1-D4
5. E1-E10
6. F1-F4 (including F2a)

## Definition of Done (v0.1)

- Node/TS adapter supports Vitest/Jest workflows.
- `run` enforces six-stage pipeline with proper early exits.
- Config stays read-only from CLI perspective.
- Dependency map and cache behavior match spec rules.
- All command outputs are structured JSON and covered by tests.
