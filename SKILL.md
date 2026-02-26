# test-oracle Skill

Use this skill whenever you need to run tests during coding work in a repository that uses `test-oracle`.

## Hard Rules

1. Never call framework test commands directly (`vitest`, `jest`, `pytest`, `npm test`, etc.) during normal coding loops.
2. Use `test-oracle run` as the default execution path for changed files.
3. If setup state is unknown, run `test-oracle validate` first.
4. The CLI never writes `.test-oracle.yml`; config creation and patching must be agent-driven via prompt assets.

## Command Policy

1. Setup unknown or new project:
   - Run `test-oracle validate`.
   - If config is missing, execute the init prompt asset and write `.test-oracle.yml`.
   - Re-run `test-oracle validate`.
   - Run `test-oracle init` to build `map.db`.
2. Normal coding loop:
   - Run `test-oracle run --files <changed-files>`.
3. Recovery:
   - Re-run `test-oracle validate` when `run` returns config-related errors.
   - Run `test-oracle init` when map is missing or stale.

## Deterministic Decision Tree

| CLI Output Shape | Next Action |
|---|---|
| `{ error: "no_config" }` | Use init prompt asset, then run `test-oracle validate`, then `test-oracle init`. |
| `{ command: "validate", valid: false, ... }` | Use update prompt asset, patch `.test-oracle.yml`, then rerun `test-oracle validate`. |
| `{ error: "no_map" }` | Run `test-oracle init`, then retry `test-oracle run`. |
| `{ command: "run", status: "fail", stage: "static", ... }` | Fix static issue first (`check`/`error` fields), then retry `test-oracle run`. |
| `{ command: "run", status: "fail", stage: "execute", ... }` | Fix test/runtime issue using `failed_test`/`error`, then retry `test-oracle run`. |
| `{ command: "validate", valid: true, warnings:[{ field:"map", ...deleted files...}] }` | Treat map as stale and run `test-oracle init`. |

## Prompt Assets

- Init prompt: [`docs/prompts/config-init-prompt.md`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/docs/prompts/config-init-prompt.md)
- Update prompt: [`docs/prompts/config-update-prompt.md`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/docs/prompts/config-update-prompt.md)

## Usage Recipes

See [`docs/playbooks/agent-workflows.md`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/docs/playbooks/agent-workflows.md) for concrete command sequences:

1. New project bootstrap
2. Iterative coding loop
3. Stale or broken config recovery
