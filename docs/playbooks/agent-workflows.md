# test-oracle Agent Workflows

## 1) New Project Bootstrap

1. Run `test-oracle validate`.
2. If output is `{ error: "no_config" }`, execute init prompt asset to generate `.test-oracle.yml`.
3. Run `test-oracle validate` again.
4. When valid, run `test-oracle init`.
5. Start coding loop with `test-oracle run --files <changed-files>`.

## 2) Iterative Coding Loop

1. After each code edit set, run `test-oracle run --files <changed-files>`.
2. If `{ status: "fail", stage: "static" }`, fix static issues first and rerun `test-oracle run`.
3. If `{ status: "fail", stage: "execute" }`, fix test/runtime issue and rerun `test-oracle run`.
4. If `{ status: "pass" }` or `{ status: "skip" }`, continue to next change set.

## 3) Stale/Broken Config Recovery

1. Run `test-oracle validate`.
2. If `{ valid: false }`, execute update prompt asset and patch `.test-oracle.yml`.
3. Run `test-oracle validate` again.
4. If warnings indicate deleted file references in map, run `test-oracle init`.
5. Resume with `test-oracle run --files <changed-files>`.

## Anti-Pattern

- Do not replace the loop with direct framework calls like `vitest run`, `jest`, `pytest`, `npm test`, or similar.
