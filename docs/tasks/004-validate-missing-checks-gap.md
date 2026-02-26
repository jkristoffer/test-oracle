# 004: `validate` Missing Spec Checks

## Summary
`validate` implements core checks, but two expected checks are not implemented.

## Spec References
- Section 3 (`validate` command): include framework-config-changed-since-init reporting.
- Section 5 staleness note: `validate` should detect/report staleness conditions.

## Current Implementation
- Implemented checks include ecosystem, command resolvability, test/source pattern matches, and deleted map references:
  - [`src/validate.ts:56`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/validate.ts:56)
  - [`src/validate.ts:164`](/Users/kristoffersanio/git/jkristoffer.com/test-oracle/src/validate.ts:164)

## Gap
Missing explicit checks for:
1. Framework config files changed since last init.
2. Source files that exist but have no map entry (stale/new coverage visibility signal described in spec).

## Expected Fix
- Persist minimal framework-config fingerprint metadata at init.
- Add validate diagnostics for framework-config drift and source-without-map-entry findings.

## Acceptance Criteria
- `validate` surfaces structured warnings/errors for framework-config drift.
- `validate` can report count/details of source files lacking dependency-map entries.
