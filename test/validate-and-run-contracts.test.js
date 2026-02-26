const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { validateCommand, runCommand } = require("../dist/commands.js");

test("validate returns no_config when config file is missing", () => {
  const cwd = mkTempProject();
  const result = validateCommand(cwd);

  assert.equal(result.kind, "error");
  assert.equal(result.error, "no_config");
});

test("validate returns valid=false for invalid config schema", () => {
  const cwd = mkTempProject();
  fs.writeFileSync(
    path.join(cwd, ".test-oracle.yml"),
    [
      "ecosystem: node",
      "test_command: \"npm test\"",
      "coverage_command: \"npm test -- --coverage\"",
      "test_pattern: \"src/**/*.test.ts\""
    ].join("\n")
  );

  const result = validateCommand(cwd);

  assert.equal(result.command, "validate");
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((issue) => issue.field === "source_patterns"),
    "expected source_patterns validation error"
  );
});

test("validate warns when map references deleted files", () => {
  const cwd = mkTempProject();
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".test-oracle"), { recursive: true });

  fs.writeFileSync(path.join(cwd, "src", "app.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(cwd, "src", "app.test.ts"), "test('ok', () => {});\n");

  fs.writeFileSync(
    path.join(cwd, ".test-oracle.yml"),
    [
      "ecosystem: node",
      "test_command: \"node --version\"",
      "coverage_command: \"node --version\"",
      "test_pattern: \"src/**/*.test.ts\"",
      "source_patterns:",
      "  - \"src/**/*.ts\"",
      "  - \"!src/**/*.test.ts\""
    ].join("\n")
  );

  execFileSync(
    "sqlite3",
    [
      path.join(cwd, ".test-oracle", "map.db"),
      "CREATE TABLE file_tests (source_path TEXT NOT NULL, test_id TEXT NOT NULL, last_updated INTEGER NOT NULL, PRIMARY KEY (source_path, test_id)); INSERT INTO file_tests (source_path, test_id, last_updated) VALUES ('src/deleted.ts', 'src/app.test.ts', 1);"
    ],
    { stdio: "ignore" }
  );

  const result = validateCommand(cwd);

  assert.equal(result.command, "validate");
  assert.equal(result.valid, true);
  assert.ok(
    result.warnings.some((issue) => issue.field === "map"),
    "expected map stale warning"
  );
});

test("run returns command_not_found when configured test command is missing", () => {
  const cwd = mkTempProject();
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "app.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(cwd, "src", "app.test.ts"), "test('ok', () => {});\n");

  fs.writeFileSync(
    path.join(cwd, ".test-oracle.yml"),
    [
      "ecosystem: node",
      "test_command: \"__missing_test_command__ run\"",
      "coverage_command: \"node --version\"",
      "test_pattern: \"src/**/*.test.ts\"",
      "source_patterns:",
      "  - \"src/**/*.ts\"",
      "  - \"!src/**/*.test.ts\""
    ].join("\n")
  );

  const result = runCommand([], cwd);

  assert.equal(result.kind, "error");
  assert.equal(result.error, "command_not_found");
  assert.equal(result.command, "run");
});

test("run returns unknown_ecosystem when ecosystem has no adapter", () => {
  const cwd = mkTempProject();
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "app.py"), "print('ok')\n");
  fs.writeFileSync(path.join(cwd, "src", "test_app.py"), "def test_ok():\n    assert True\n");

  fs.writeFileSync(
    path.join(cwd, ".test-oracle.yml"),
    [
      "ecosystem: python",
      "test_command: \"python --version\"",
      "coverage_command: \"python --version\"",
      "test_pattern: \"src/**/*.py\"",
      "source_patterns:",
      "  - \"src/**/*.py\""
    ].join("\n")
  );

  const result = runCommand([], cwd);

  assert.equal(result.kind, "error");
  assert.equal(result.error, "unknown_ecosystem");
  assert.equal(result.command, "run");
});

test("run returns no_map when config is valid and changed source exists", () => {
  const cwd = mkTempProject();
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "app.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(cwd, "src", "app.test.ts"), "test('ok', () => {});\n");

  fs.writeFileSync(
    path.join(cwd, ".test-oracle.yml"),
    [
      "ecosystem: node",
      "test_command: \"node --version\"",
      "coverage_command: \"node --version\"",
      "test_pattern: \"src/**/*.test.ts\"",
      "source_patterns:",
      "  - \"src/**/*.ts\"",
      "  - \"!src/**/*.test.ts\""
    ].join("\n")
  );

  const result = runCommand(["src/app.ts"], cwd);

  assert.equal(result.kind, "error");
  assert.equal(result.error, "no_map");
  assert.equal(result.command, "run");
});

test("run returns no_tests_mapped when map exists but no mappings and no fallback", () => {
  const cwd = mkTempProject();
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".test-oracle"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "app.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(cwd, "src", "other.test.ts"), "test('ok', () => {});\n");

  fs.writeFileSync(
    path.join(cwd, ".test-oracle.yml"),
    [
      "ecosystem: node",
      "test_command: \"node --version\"",
      "coverage_command: \"node --version\"",
      "test_pattern: \"src/**/*.test.ts\"",
      "source_patterns:",
      "  - \"src/**/*.ts\"",
      "  - \"!src/**/*.test.ts\""
    ].join("\n")
  );

  execFileSync(
    "sqlite3",
    [
      path.join(cwd, ".test-oracle", "map.db"),
      "CREATE TABLE file_tests (source_path TEXT NOT NULL, test_id TEXT NOT NULL, last_updated INTEGER NOT NULL, PRIMARY KEY (source_path, test_id));"
    ],
    { stdio: "ignore" }
  );

  const result = runCommand(["src/app.ts"], cwd);

  assert.equal(result.command, "run");
  assert.equal(result.status, "skip");
  assert.equal(result.stage, "map");
  assert.equal(result.reason, "no_tests_mapped");
});

test("run fails in static stage and does not execute tests", () => {
  const cwd = mkTempProject();
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".test-oracle"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "app.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(cwd, "src", "app.test.ts"), "test('ok', () => {});\n");
  fs.writeFileSync(
    path.join(cwd, "scripts", "execute-marker.js"),
    "const fs = require('node:fs'); fs.writeFileSync('executed.marker', 'yes');\n"
  );

  fs.writeFileSync(
    path.join(cwd, ".test-oracle.yml"),
    [
      "ecosystem: node",
      "test_command: \"node ./scripts/execute-marker.js\"",
      "coverage_command: \"node --version\"",
      "test_pattern: \"src/**/*.test.ts\"",
      "source_patterns:",
      "  - \"src/**/*.ts\"",
      "  - \"!src/**/*.test.ts\"",
      "static_checks:",
      "  - \"node -e \\\"process.exit(1)\\\"\""
    ].join("\n")
  );

  execFileSync(
    "sqlite3",
    [
      path.join(cwd, ".test-oracle", "map.db"),
      "CREATE TABLE file_tests (source_path TEXT NOT NULL, test_id TEXT NOT NULL, last_updated INTEGER NOT NULL, PRIMARY KEY (source_path, test_id)); INSERT INTO file_tests (source_path, test_id, last_updated) VALUES ('src/app.ts', 'src/app.test.ts', 1);"
    ],
    { stdio: "ignore" }
  );

  const result = runCommand(["src/app.ts"], cwd);

  assert.equal(result.command, "run");
  assert.equal(result.status, "fail");
  assert.equal(result.stage, "static");
  assert.equal(result.static_checks_passed, false);
  assert.equal(fs.existsSync(path.join(cwd, "executed.marker")), false);
});

test("run passes execute stage and refreshes map from coverage", () => {
  const cwd = mkTempProject();
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".test-oracle"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "app.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(cwd, "src", "app.test.ts"), "test('ok', () => {});\n");
  fs.writeFileSync(path.join(cwd, "scripts", "pass-test.js"), "process.exit(0);\n");
  fs.writeFileSync(
    path.join(cwd, "scripts", "write-coverage.js"),
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const src = path.join(process.cwd(), 'src', 'app.ts');",
      "const coverageDir = path.join(process.cwd(), 'coverage');",
      "fs.mkdirSync(coverageDir, { recursive: true });",
      "fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify({ [src]: { path: src } }));"
    ].join("\n")
  );

  fs.writeFileSync(
    path.join(cwd, ".test-oracle.yml"),
    [
      "ecosystem: node",
      "test_command: \"node ./scripts/pass-test.js\"",
      "coverage_command: \"node ./scripts/write-coverage.js\"",
      "test_pattern: \"src/**/*.test.ts\"",
      "source_patterns:",
      "  - \"src/**/*.ts\"",
      "  - \"!src/**/*.test.ts\"",
      "static_checks:",
      "  - \"node --version\""
    ].join("\n")
  );

  execFileSync(
    "sqlite3",
    [
      path.join(cwd, ".test-oracle", "map.db"),
      "CREATE TABLE file_tests (source_path TEXT NOT NULL, test_id TEXT NOT NULL, last_updated INTEGER NOT NULL, PRIMARY KEY (source_path, test_id));"
    ],
    { stdio: "ignore" }
  );

  const result = runCommand(["src/app.ts"], cwd);

  assert.equal(result.command, "run");
  assert.equal(result.status, "pass");
  assert.equal(result.stage, "execute");
  assert.equal(result.static_checks_passed, true);
  assert.equal(result.map_updated, true);
  assert.deepEqual(result.tests_run, ["src/app.test.ts"]);

  const updatedCount = execFileSync(
    "sqlite3",
    [
      path.join(cwd, ".test-oracle", "map.db"),
      "SELECT COUNT(*) FROM file_tests WHERE source_path='src/app.ts' AND test_id='src/app.test.ts';"
    ],
    { encoding: "utf8" }
  ).trim();
  assert.equal(updatedCount, "1");
});

test("run fails in execute stage with structured failure details", () => {
  const cwd = mkTempProject();
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(cwd, ".test-oracle"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "app.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(cwd, "src", "app.test.ts"), "test('ok', () => {});\n");
  fs.writeFileSync(
    path.join(cwd, "scripts", "fail-test.js"),
    "console.error('FAIL src/app.test.ts'); process.exit(2);\n"
  );
  fs.writeFileSync(
    path.join(cwd, "scripts", "write-coverage.js"),
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const src = path.join(process.cwd(), 'src', 'app.ts');",
      "const coverageDir = path.join(process.cwd(), 'coverage');",
      "fs.mkdirSync(coverageDir, { recursive: true });",
      "fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify({ [src]: { path: src } }));"
    ].join("\n")
  );

  fs.writeFileSync(
    path.join(cwd, ".test-oracle.yml"),
    [
      "ecosystem: node",
      "test_command: \"node ./scripts/fail-test.js\"",
      "coverage_command: \"node ./scripts/write-coverage.js\"",
      "test_pattern: \"src/**/*.test.ts\"",
      "source_patterns:",
      "  - \"src/**/*.ts\"",
      "  - \"!src/**/*.test.ts\""
    ].join("\n")
  );

  execFileSync(
    "sqlite3",
    [
      path.join(cwd, ".test-oracle", "map.db"),
      "CREATE TABLE file_tests (source_path TEXT NOT NULL, test_id TEXT NOT NULL, last_updated INTEGER NOT NULL, PRIMARY KEY (source_path, test_id)); INSERT INTO file_tests (source_path, test_id, last_updated) VALUES ('src/app.ts', 'src/app.test.ts', 1);"
    ],
    { stdio: "ignore" }
  );

  const result = runCommand(["src/app.ts"], cwd);

  assert.equal(result.command, "run");
  assert.equal(result.status, "fail");
  assert.equal(result.stage, "execute");
  assert.equal(result.failed_test, "src/app.test.ts");
  assert.match(result.error, /FAIL src\/app\.test\.ts/);
  assert.equal(result.static_checks_passed, true);
});

function mkTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "test-oracle-"));
}
