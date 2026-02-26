# test-oracle v0.5 Implementation Plan

## Intent Alignment

This cycle closes the remaining core CLI gaps so `test-oracle` is fully usable as the deterministic engine described in the spec:

- keep test execution minimal and targeted,
- make cache-based skipping reliable,
- provide operational commands for bootstrap, visibility, and recovery,
- keep config agent-managed and read-only from CLI.

## Scope Decision

v0.5 is limited to core runtime completion in the existing Node/TS path:

1. Stage 3 cache behavior in `test-oracle run`.
2. Production implementations of `init`, `status`, and `reset`.
3. Contract and regression tests for these behaviors.

No new ecosystem adapters or broader platform expansion in this cycle.

## Goals

1. Implement deterministic cache short-circuiting for unchanged passing states.
2. Make `test-oracle init` build a usable dependency map and baseline state.
3. Make `status` and `reset` operational for day-to-day agent workflows.

## Deliverables

1. **Stage 3 Cache Engine**
- Hash computation from changed source files + mapped tests + `.test-oracle.yml`.
- Pass-hit short-circuit (`source: "cache"`).
- Fail-hit rerun policy (never trust cached fail as final).
- TTL eviction via `cache_ttl_days`.
- Pass result persistence after successful execution.

2. **`init` Command (Operational)**
- Config preflight and ecosystem/command checks.
- Full coverage run path for initial map population.
- Rebuild `.test-oracle/map.db` and refresh metadata (`last_full_run`, adapter, schema version).
- Write/update `.test-oracle/state` baseline for diff detection.

3. **`status` Command (Operational)**
- Real map metrics (entry count, last updated timestamp, freshness signal).
- Real cache metrics (entry count and hit-rate if telemetry exists; explicit `null` when unavailable).
- Config validation summary based on current project state.

4. **`reset` Command (Operational)**
- Clear map, cache, and state deterministically.
- Return structured confirmation of what was cleared.

5. **Contract-Driven Test Coverage**
- Cache-path scenarios (pass hit, fail hit, miss).
- `init/status/reset` integration scenarios.
- Regression protection for v0.2-v0.4 behavior.

## Step-by-Step Execution Plan

### Step 1: Cache primitives and hash contract
- Implement file-content hash builder for Stage 3 contract.
- Implement cache read/write/evict helpers under `.test-oracle/cache/`.
- Define cache-entry schema (`status`, `timestamp`, optional metadata).

### Step 2: Integrate Stage 3 into `run`
- Insert cache check between map and static stages.
- Return early on cached pass with structured run result.
- Continue pipeline on cache miss or cached fail.

### Step 3: Persist pass outcomes
- On execute pass, persist cache entry for computed hash.
- Ensure cache write failures do not crash run result emission.

### Step 4: Implement `init`
- Execute full coverage workflow and parse coverage artifacts.
- Rebuild/replace mapping entries deterministically.
- Update map metadata + state baseline.
- Return structured init summary payload.

### Step 5: Implement `status`
- Read map/cache/config signals from on-disk state.
- Return stable structured status payload for both empty and populated states.

### Step 6: Implement `reset`
- Remove/clear map.db, cache entries, and state file safely.
- Return explicit boolean cleared flags in response.

### Step 7: Test and harden
- Add contract tests for cache semantics and operational commands.
- Re-run existing tests to verify no regressions in validation/run/skill behavior.

## Acceptance Criteria

- `run` performs spec-aligned Stage 3 cache behavior (pass skip, fail rerun).
- `init` produces a usable map and baseline state from a coverage run.
- `status` and `reset` are no longer placeholders.
- All new and existing command outputs remain structured and machine-parseable.
- Existing v0.2-v0.4 contracts stay green.

## Out of Scope (v0.5)

- Python/Rust/Go adapter work.
- Monorepo/multi-ecosystem orchestration.
- Remote/shared cache and CI artifact distribution.
- Additional skill-layer feature expansion beyond consuming stable CLI outputs.
