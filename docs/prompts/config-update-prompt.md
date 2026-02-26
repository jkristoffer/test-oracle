# Config Update Prompt (`.test-oracle.yml` Patch)

Use this prompt when:
- `test-oracle validate` returns `{ valid: false, errors: [...] }`, or
- `test-oracle run` returns config-related errors (for example `command_not_found`, `unknown_ecosystem`).

## Prompt

You are patching an existing `.test-oracle.yml` for this project.  
Patch only fields required to resolve reported config issues.

Inputs to inspect:
- Current `.test-oracle.yml`
- Latest `test-oracle validate` output
- Latest `test-oracle run` output (if config-related error was returned)
- Config-relevant repository changes (`git diff`)
- Manifest/framework/config files used during init

Required analysis:
1. Parse each validation/runtime issue and map it to a specific field update.
2. Re-detect ecosystem/framework if commands or manifests changed.
3. Update `test_pattern` / `source_patterns` when they match zero files.
4. Update `test_command` / `coverage_command` when tools changed.
5. Treat deleted map references as map staleness; do not over-edit config for that warning.
6. Keep unrelated fields unchanged.

Output requirements:
- Patch `.test-oracle.yml` in place.
- Keep edits minimal and deterministic.

Post-actions:
1. Run `test-oracle validate`.
2. If still invalid, patch again and repeat.
3. If map is stale/missing, run `test-oracle init`.
4. Resume normal loop with `test-oracle run --files <changed-files>`.

Boundaries:
- You own config patching decisions.
- CLI owns validation/orchestration logic.
- Do not add CLI-side config mutation behavior.
