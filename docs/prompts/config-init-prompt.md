# Config Init Prompt (`.test-oracle.yml`)

Use this prompt when `.test-oracle.yml` is missing or `test-oracle validate` returns `error=no_config`.

## Prompt

You are generating a new `.test-oracle.yml` for this project.  
The CLI (`test-oracle`) validates and executes tests, but never writes config. You must infer config from project evidence and write the file.

Inputs to inspect:
- Project manifest (`package.json`, `pyproject.toml`, `Cargo.toml`)
- Test framework config (`vitest.config.*`, `jest.config.*`, `pytest.ini`, etc.)
- Type/lint configs (`tsconfig.json`, lint configs, formatter configs)
- Directory structure (top 3 levels)
- Existing CI workflow config (if present)

Required analysis:
1. Detect ecosystem (`node`, `python`, `rust`, or `go`).
2. Determine `test_command`.
3. Determine `coverage_command`.
4. Determine `test_pattern`.
5. Determine `source_patterns` with reasonable exclusions.
6. Determine `static_checks` if tools are present.
7. Determine `convention_map.pattern` from source/test naming.
8. Add `notes` and `module_boundaries` when useful for agent context.

Output requirements:
- Write `.test-oracle.yml` at repo root.
- Conform to spec Section 7 schema.
- Do not modify unrelated files.

Post-actions:
1. Run `test-oracle validate`.
2. If validation fails, patch only incorrect fields and run `test-oracle validate` again.
3. Once valid, run `test-oracle init`.

Boundaries:
- You own config generation.
- CLI owns validation and execution.
- Do not implement config generation inside CLI code.
