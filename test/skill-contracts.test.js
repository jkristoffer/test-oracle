const test = require("node:test");
const assert = require("node:assert/strict");

const {
  INIT_PROMPT_ASSET_PATH,
  UPDATE_PROMPT_ASSET_PATH,
  decideSkillNextStep,
  decisionUsesOnlyOracleCommands,
  isDirectFrameworkTestCommand
} = require("../dist/skill.js");

test("skill routes no_config to init prompt flow", () => {
  const decision = decideSkillNextStep({
    kind: "error",
    error: "no_config",
    message: "Run test-oracle validate to check setup",
    command: "run"
  });

  assert.equal(decision.next, "prompt_init_config");
  assert.equal(decision.reason, "no_config");
  assert.equal(decision.prompt_asset, INIT_PROMPT_ASSET_PATH);
  assert.deepEqual(decision.commands, ["test-oracle validate", "test-oracle init"]);
});

test("skill routes validate invalid result to update prompt flow", () => {
  const decision = decideSkillNextStep({
    command: "validate",
    valid: false,
    errors: [{ field: "test_pattern", message: "Pattern matches 0 files" }],
    warnings: []
  });

  assert.equal(decision.next, "prompt_update_config");
  assert.equal(decision.reason, "invalid_config");
  assert.equal(decision.prompt_asset, UPDATE_PROMPT_ASSET_PATH);
});

test("skill routes no_map to init rebuild flow", () => {
  const decision = decideSkillNextStep({
    kind: "error",
    error: "no_map",
    message: "Run test-oracle init to build dependency map",
    command: "run"
  });

  assert.equal(decision.next, "run_init");
  assert.equal(decision.reason, "missing_map");
  assert.deepEqual(decision.commands, [
    "test-oracle init",
    "test-oracle run --files <changed-files>"
  ]);
});

test("skill routes static failure to static-fix loop", () => {
  const decision = decideSkillNextStep({
    command: "run",
    status: "fail",
    stage: "static",
    source: "run",
    check: "eslint",
    hash: null,
    tests_run: [],
    tests_skipped: 0,
    failed_test: null,
    error: "Unexpected any.",
    duration_ms: 100,
    map_updated: false,
    static_checks_passed: false
  });

  assert.equal(decision.next, "fix_static");
  assert.equal(decision.reason, "static_failure");
  assert.equal(decision.check, "eslint");
});

test("skill routes execute failure to test-fix loop", () => {
  const decision = decideSkillNextStep({
    command: "run",
    status: "fail",
    stage: "execute",
    source: "run",
    hash: null,
    tests_run: ["src/app.test.ts"],
    tests_skipped: 0,
    failed_test: "src/app.test.ts",
    error: "expected 401, got 200",
    duration_ms: 200,
    map_updated: true,
    static_checks_passed: true
  });

  assert.equal(decision.next, "fix_test");
  assert.equal(decision.reason, "execute_failure");
  assert.equal(decision.failed_test, "src/app.test.ts");
});

test("skill routes stale map warning to init rebuild flow", () => {
  const decision = decideSkillNextStep({
    command: "validate",
    valid: true,
    errors: [],
    warnings: [{ field: "map", message: "4 entries reference deleted files" }]
  });

  assert.equal(decision.next, "run_init");
  assert.equal(decision.reason, "stale_map");
});

test("skill routes config runtime errors to update prompt flow", () => {
  const decision = decideSkillNextStep({
    kind: "error",
    error: "command_not_found",
    message: "vitest not resolvable",
    command: "run"
  });

  assert.equal(decision.next, "prompt_update_config");
  assert.equal(decision.reason, "config_runtime_error");
  assert.equal(decision.prompt_asset, UPDATE_PROMPT_ASSET_PATH);
});

test("skill decisions enforce no direct framework test invocation", () => {
  const decisions = [
    decideSkillNextStep({
      kind: "error",
      error: "no_config",
      message: "Run test-oracle validate to check setup",
      command: "run"
    }),
    decideSkillNextStep({
      kind: "error",
      error: "no_map",
      message: "Run test-oracle init to build dependency map",
      command: "run"
    }),
    decideSkillNextStep({
      command: "run",
      status: "fail",
      stage: "execute",
      source: "run",
      hash: null,
      tests_run: ["src/app.test.ts"],
      tests_skipped: 0,
      failed_test: "src/app.test.ts",
      error: "expected 401, got 200",
      duration_ms: 200,
      map_updated: true,
      static_checks_passed: true
    })
  ];

  for (const decision of decisions) {
    assert.equal(decisionUsesOnlyOracleCommands(decision), true);
  }
});

test("direct-framework command detector flags blocked commands", () => {
  assert.equal(isDirectFrameworkTestCommand("vitest run src/app.test.ts"), true);
  assert.equal(isDirectFrameworkTestCommand("npm test -- src/app.test.ts"), true);
  assert.equal(isDirectFrameworkTestCommand("pytest tests/test_app.py"), true);

  assert.equal(isDirectFrameworkTestCommand("test-oracle run --files src/app.ts"), false);
  assert.equal(isDirectFrameworkTestCommand("test-oracle validate"), false);
});
