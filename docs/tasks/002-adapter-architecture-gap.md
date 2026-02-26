# 002: Adapter Architecture Not Implemented

## Summary
The spec defines an ecosystem adapter interface, but current runtime logic is inlined and Node-specific.

## Spec References
- Section 2: adapter concept.
- Section 8: `TestAdapter` interface and adapter-based operations.

## Current Implementation
- Supported adapters are hardcoded to node:
  - [`src/config.ts:8`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/config.ts:8)
- Test execution and coverage execution are direct command invocations in orchestrator code, not adapter calls:
  - [`src/run.ts:511`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/run.ts:511)
  - [`src/operations.ts:49`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/operations.ts:49)

## Gap
There is no implemented adapter registry/interface boundary that owns `generateMap`, `queryMap`, `runTests`, and coverage parsing.

## Expected Fix
- Introduce a formal adapter interface and registry.
- Move ecosystem-specific execution and parsing into a Node adapter module.

## Acceptance Criteria
- Core command orchestration uses adapter calls instead of direct ecosystem-specific logic.
- Adapter selection is explicit and compatible with the spec interface contract.
