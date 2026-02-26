# test-oracle v0.4 Implementation Plan

## Scope Decision

This v0.4 plan is step-by-step and limited to skill-layer integration for agent usage.

- Focus on the deterministic skill workflow that wraps the CLI.
- Do not expand CLI runtime scope beyond what is already implemented.
- Do not start additional ecosystem adapter work in this cycle.

## Goal

Deliver a production-ready skill that teaches AI coding agents how to use `test-oracle` correctly:

1. always call `test-oracle run` instead of raw test commands.
2. generate/update `.test-oracle.yml` through prompts when needed.
3. react to `validate` and `run` structured outputs deterministically.

## Deliverables

1. Skill specification (`SKILL.md`)
- Defines command usage, guardrails, and decision flow.
- Includes mandatory trigger behavior for:
  - missing config (`error=no_config`)
  - invalid config (`valid=false`)
  - map missing (`error=no_map`)
  - static failure (`stage=static`)
  - execute failure (`stage=execute`)

2. Prompt assets for config lifecycle (Section 14 alignment)
- Init prompt for initial `.test-oracle.yml` generation.
- Update prompt for targeted config patching on validation/runtime issues.
- Clear boundaries: prompt logic updates config; CLI never mutates config.

3. Agent integration examples
- Minimal playbooks for common loops:
  - new project bootstrap
  - iterative coding cycle with changed files
  - stale/broken config recovery

4. Contract-driven validation of skill behavior
- Scenario checks that ensure skill decisions match CLI output contracts.
- Regression checks for false-positive branches and misuse (e.g., direct framework test invocation).

## Step-by-Step Execution Plan

### Step 1: Define skill command policy
- Document hard rule: use `test-oracle run` for routine test execution.
- Document required pre-check flow with `test-oracle validate` when setup is unknown.

### Step 2: Encode structured-output decision tree
- Add explicit branches for each canonical output shape.
- Ensure each branch has deterministic next action.

### Step 3: Add config init/update prompt assets
- Write init prompt for generating `.test-oracle.yml`.
- Write update prompt for patching only stale/invalid fields.
- Include expected inputs and required post-actions (`validate`, then `init` when needed).

### Step 4: Add realistic usage recipes
- Provide short end-to-end examples with concrete command sequences.
- Cover both success and failure loops.

### Step 5: Validate skill behavior against fixtures
- Run scenario-based checks to confirm:
  - no direct raw test command usage,
  - correct handling of `no_config`, `valid=false`, `no_map`, `static`, and `execute` failures.

## Acceptance Criteria

- Skill makes correct next-step decisions from structured CLI outputs only.
- Skill reliably drives config generation/update prompts when required.
- Skill prevents direct framework command usage in normal agent loops.
- Skill docs are concise, actionable, and runnable in real coding sessions.

## Out of Scope (for this v0.4 cycle)

- Additional CLI execution features not needed for skill integration.
- New adapters (Python/Rust/Go) and monorepo expansion.
- CI platform orchestration and distributed cache work.
