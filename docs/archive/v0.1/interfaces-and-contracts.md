# test-oracle v0.1 Interfaces and Contracts

## Scope

This document defines implementation contracts for v0.1 (single-ecosystem Node/TS support), aligned with `test-oracle-spec.md`.

## CLI Command Contracts

## `test-oracle init`

### Preconditions
- `.test-oracle.yml` exists and validates.
- Adapter exists for configured ecosystem.

### Behavior
- Runs full test suite with coverage instrumentation.
- Parses coverage into dependency edges.
- Rebuilds `.test-oracle/map.db`.
- Updates `map_meta.last_full_run`.

### Output
- Success: structured JSON summary of map build.
- Failure: structured error envelope.

## `test-oracle run [--files ...]`

### Pipeline Stages
1. `detect`
2. `map`
3. `cache`
4. `static`
5. `execute`
6. `result`

### Early-return rules
- No relevant changed source files: `skip/no_changes`.
- No mapped tests after fallback: `skip/no_tests_mapped`.
- Cache hit on `pass`: return cached pass.
- Cache hit on `fail`: do not short-circuit.
- Static check failure: return failure before test execution.

## `test-oracle validate`

### Behavior
- Validates config schema, command resolvability, pattern matches.
- Detects map entries pointing to missing files.
- If `.test-oracle.yml` is missing, returns `no_config` error envelope.
- Otherwise returns structured `valid/errors/warnings`.

## `test-oracle status`

### Behavior
- Reports map freshness and size.
- Reports cache count and hit-rate.
- Reports config validation summary.

## `test-oracle reset`

### Behavior
- Clears map/cache/state.
- Returns structured confirmation response.

## Core JSON Contracts

## Run result

```json
{
  "status": "pass",
  "stage": "execute",
  "source": "run",
  "hash": "sha256:...",
  "tests_run": ["src/auth/auth.test.ts:login"],
  "tests_skipped": 38,
  "failed_test": null,
  "error": null,
  "duration_ms": 1200,
  "map_updated": true,
  "static_checks_passed": true
}
```

## Validation result

```json
{
  "valid": false,
  "errors": [
    { "field": "test_pattern", "message": "Pattern matches 0 files" }
  ],
  "warnings": [
    { "field": "map", "message": "12 entries reference deleted files" }
  ]
}
```

## Error envelope

```json
{
  "error": "no_map",
  "message": "Run test-oracle init to build dependency map"
}
```

Missing config variant:

```json
{
  "error": "no_config",
  "message": "Run test-oracle validate to check setup"
}
```

## Canonical error codes

- `no_config`
- `no_map`
- `unknown_ecosystem`
- `command_not_found`
- `coverage_parse_error`

## Section 14 Prompt Trigger Contracts

### Init prompt trigger inputs (agent-side)
- `validate` returns `{ error: "no_config", ... }`, or
- `.test-oracle.yml` is absent in project root.

### Update prompt trigger inputs (agent-side)
- `validate` returns `{ valid: false, ... }`, or
- `run` returns config-related errors such as `command_not_found`.

### CLI responsibility
- Emit stable, machine-parseable responses for these trigger states.
- Do not generate or patch `.test-oracle.yml`.

## Adapter Interface Contract

```ts
interface TestAdapter {
  generateMap(config: Config): Promise<CoverageData>;
  queryMap(db: MapDB, changedFiles: string[]): Promise<string[]>;
  runTests(testIds: string[], config: Config): Promise<TestResult[]>;
  parseCoverage(raw: CoverageData): Promise<FileDependency[]>;
}
```

## Contract requirements

- `generateMap` must run coverage command for full suite.
- `queryMap` must return deduplicated deterministic test IDs.
- `runTests` must support fail-fast and normalized result output.
- `parseCoverage` must produce source-to-test dependency edges.

## Persistence Contracts

## Dependency map database

Path: `.test-oracle/map.db`

```sql
CREATE TABLE file_tests (
  source_path TEXT NOT NULL,
  test_id TEXT NOT NULL,
  last_updated INTEGER NOT NULL,
  PRIMARY KEY (source_path, test_id)
);

CREATE TABLE map_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### `map_meta` required keys
- `last_full_run`
- `adapter`
- `schema_version`

## Cache entries

Path: `.test-oracle/cache/<hash>.json`

```json
{
  "status": "pass",
  "timestamp": 1700000000
}
```

### Hash input contract

`sha256(sorted(changed source file contents) + sorted(mapped test file contents) + config file contents)`

### Eviction rule

- Remove entries older than `cache_ttl_days` (default 7) each run.

## Config Contract (`.test-oracle.yml`)

## Required fields
- `ecosystem`
- `test_command`
- `coverage_command`
- `test_pattern`
- `source_patterns`

## Optional fields
- `static_checks`
- `fail_fast` (default `true`)
- `cache_ttl_days` (default `7`)
- `coverage_format`
- `convention_map`
- `notes`
- `module_boundaries`

## Invariants and Compatibility Rules

- Output must be structured JSON in normal operation and all handled errors.
- CLI must never write or auto-correct `.test-oracle.yml`.
- Dependency map is primary selection source; convention fallback is secondary.
- Cache can skip only known-pass runs, never known-fail runs.
- v0.1 supports one ecosystem per project.

## Acceptance Scenarios (Contract-level)

1. No changed source files returns `status=skip` and `reason=no_changes`.
2. Unmapped changed file attempts convention fallback before skip.
3. Pass cache hit returns `source=cache` without executing tests.
4. Fail cache hit still executes static checks and tests.
5. Static check failure halts before adapter test execution.
6. Execute failure includes `failed_test` and `error`.
7. Validate returns `valid/errors/warnings` even when invalid.
8. Validate without config returns `error=no_config`.
