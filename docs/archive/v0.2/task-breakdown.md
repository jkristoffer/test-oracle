# test-oracle v0.2 Task Breakdown

## Workstream 1: Config and Error Foundations

### 1.1 Implement config reader and schema checks
- Intent: power deterministic validation and preflight behavior.
- Deliverable: parser + typed config model + required/optional field checks.
- Done when: invalid schema yields structured validation issues.

### 1.2 Implement canonical error envelope module
- Intent: make agent automation reliable.
- Deliverable: unified constructors for `no_config`, `command_not_found`, `unknown_ecosystem`, `coverage_parse_error`, `no_map`.
- Done when: all command handlers return standardized error payloads.

### 1.3 Implement command resolvability probes
- Intent: catch broken toolchain config early.
- Deliverable: PATH checks for `test_command`, `coverage_command`, `static_checks`.
- Done when: unresolved command is returned as `command_not_found`.

## Workstream 2: `validate` Command (Core v0.2)

### 2.1 Dual-mode validate entry
- Intent: support Section 14 init/update triggers.
- Deliverable:
  1) missing config -> `{ error: "no_config", message: ... }`
  2) config present -> `{ valid, errors, warnings }`
- Done when: both modes are covered by tests.

### 2.2 Pattern and file-match validation
- Intent: prevent unusable configuration.
- Deliverable: checks for `test_pattern` and `source_patterns` matching at least one file.
- Done when: zero-match patterns are reported in `errors`.

### 2.3 Ecosystem and command validation
- Intent: confirm adapter and commands are executable.
- Deliverable: adapter existence + command checks.
- Done when: unknown ecosystem and unresolved commands are returned deterministically.

### 2.4 Map-reference staleness checks
- Intent: support self-healing recommendations.
- Deliverable: detect `map.db` entries that reference deleted files.
- Done when: stale references appear in `warnings` with counts/details.

## Workstream 3: `run` Integration for Self-Healing

### 3.1 Add config preflight to `run`
- Intent: ensure agents get actionable errors before pipeline execution.
- Deliverable: early config checks in `run`.
- Done when: missing/invalid config returns canonical structured outputs.

### 3.2 Canonical config-related run failures
- Intent: update prompt trigger compatibility.
- Deliverable: standardized `run` errors for command/config failures.
- Done when: skill layer can branch on error code without parsing free text.

## Workstream 4: Tests and Contract Lock

### 4.1 Unit tests
- Intent: deterministic behavior at module level.
- Deliverable: tests for config parsing, command probing, issue aggregation, and error constructors.
- Done when: core modules are branch-covered for expected failures.

### 4.2 Validate integration tests
- Intent: verify end-to-end validate behavior.
- Deliverable: fixture tests for missing config, invalid config, valid config, stale map references.
- Done when: output schemas and key fields match spec.

### 4.3 Prompt-trigger contract tests (Section 14)
- Intent: prevent regressions in skill integration.
- Deliverable: tests asserting:
  1) `validate` missing config -> `error=no_config`
  2) `validate` invalid config -> `valid=false`
  3) `run` config failures -> canonical error codes
- Done when: trigger outputs remain machine-detectable.

## Execution Order

1. Workstream 1
2. Workstream 2
3. Workstream 3
4. Workstream 4

## Definition of Done (v0.2)

- `validate` implements all specified checks and response modes.
- Self-healing trigger outputs are stable and tested.
- Stale map detection is surfaced via warnings.
- CLI remains read-only for `.test-oracle.yml`.
