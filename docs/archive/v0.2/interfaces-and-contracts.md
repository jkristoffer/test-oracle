# test-oracle v0.2 Interfaces and Contracts

## Scope

v0.2 contract scope is validation and self-healing integration:

- `validate` command behavior and payloads.
- Config-related error contracts for `run`.
- Section 14 trigger compatibility.

## `validate` Contract

### Mode A: Missing config

When `.test-oracle.yml` does not exist:

```json
{
  "error": "no_config",
  "message": "Run test-oracle validate to check setup"
}
```

### Mode B: Config present

Always returns structured validation result:

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

## Validation Rules (v0.2)

1. `ecosystem` maps to a known adapter.
2. `test_command` is resolvable.
3. `coverage_command` is resolvable.
4. `test_pattern` matches at least one file.
5. `source_patterns` match at least one file.
6. `static_checks` commands are resolvable.
7. Dependency map entries referencing deleted files are surfaced as warnings.

## `run` Config-Related Error Contract

`run` must fail fast with canonical structured errors for config/tooling problems before normal pipeline execution.

Examples:

```json
{
  "error": "no_config",
  "message": "Run test-oracle validate to check setup"
}
```

```json
{
  "error": "command_not_found",
  "message": "vitest not resolvable"
}
```

```json
{
  "error": "unknown_ecosystem",
  "message": "No adapter for: ruby"
}
```

## Canonical Error Codes

- `no_config`
- `no_map`
- `unknown_ecosystem`
- `command_not_found`
- `coverage_parse_error`

## Section 14 Trigger Compatibility

### Init prompt trigger
- `validate` returns `error=no_config`, or config file is absent.

### Update prompt trigger
- `validate` returns `valid=false`.
- `run` returns config-related canonical errors (e.g., `command_not_found`).

### CLI boundary
- CLI does not generate/update `.test-oracle.yml`.
- CLI emits deterministic machine-readable outputs only.

## Acceptance Scenarios

1. No config file -> `validate` returns `error=no_config`.
2. Invalid config values -> `validate.valid=false` with concrete `errors`.
3. Map contains deleted file references -> `warnings` include map staleness.
4. Broken command in config -> `command_not_found` appears in validation and/or run preflight.
5. Unknown ecosystem -> `unknown_ecosystem` is returned deterministically.
