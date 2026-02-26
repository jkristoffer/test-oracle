# test-oracle v0.2 Implementation Plan

## Summary

v0.2 focuses on the validation and self-healing loop defined in Section 13 of the spec:

- Implement `test-oracle validate` as a deterministic health check.
- Emit stable structured config-related errors for agent remediation.
- Detect stale dependency map conditions and surface them clearly.
- Preserve strict boundary: CLI validates; agent/skill updates `.test-oracle.yml`.

## Deliverables

1. Production `validate` command with spec-complete checks.
2. Structured error model for config and command resolution failures.
3. Stale-map and deleted-file reference detection in validation output.
4. `run` integration with canonical config-related error paths.
5. Contract tests for Section 14 init/update prompt triggers.

## Scope

### In Scope
- Config loader and schema validation for `.test-oracle.yml`.
- Validation rules from Section 7 + map-reference checks from Section 5/7.
- Command resolvability checks (`test_command`, `coverage_command`, `static_checks`).
- Pattern checks (`test_pattern`, `source_patterns`).
- Canonical errors and dual-mode validate output:
  1) `{ error: "no_config", ... }` when config is missing.
  2) `{ valid, errors, warnings }` when config exists.
- `run` preflight behavior for config-related failures.

### Out of Scope
- Additional ecosystems beyond Node/TS.
- Monorepo and distributed cache support.
- Config generation/updating logic (agent/skill responsibility).
- Full optimization pipeline changes already targeted by v0.1 unless required for validation coupling.

## Milestones

1. **M1: Config + Error Contracts**
- Complete config parsing/validation and canonical error envelopes.

2. **M2: `validate` Command**
- Implement full validation checks and structured issue reporting.

3. **M3: `run` Self-Healing Hooks**
- Ensure `run` returns machine-detectable config-related errors.

4. **M4: Verification**
- Add command-level and contract tests for Section 14 triggers.

## Acceptance Criteria

- Missing config returns `error=no_config` deterministically.
- Invalid config returns `valid=false` with actionable `errors[]`.
- Deleted file references in map are surfaced as warnings.
- `run` config issues return canonical codes (e.g., `command_not_found`).
- Outputs are stable for skill-layer prompt triggers in Section 14.
