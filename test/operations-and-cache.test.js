const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  initCommand,
  resetCommand,
  runCommand,
  statusCommand
} = require("../dist/commands.js");

test("run writes pass cache and uses cache hit on repeat run", () => {
  const cwd = mkTempProject();
  scaffoldNodeFixture(cwd);
  writeConfig(cwd, [
    "ecosystem: node",
    "test_command: \"node ./scripts/pass-test.js\"",
    "coverage_command: \"node ./scripts/write-coverage.js\"",
    "test_pattern: \"src/**/*.test.ts\"",
    "source_patterns:",
    "  - \"src/**/*.ts\"",
    "  - \"!src/**/*.test.ts\"",
    "static_checks:",
    "  - \"node ./scripts/static-check.js\"",
    "cache_ttl_days: 7"
  ]);
  seedMap(cwd, [
    "CREATE TABLE file_tests (source_path TEXT NOT NULL, test_id TEXT NOT NULL, last_updated INTEGER NOT NULL, PRIMARY KEY (source_path, test_id));",
    "INSERT INTO file_tests (source_path, test_id, last_updated) VALUES ('src/app.ts', 'src/app.test.ts', 1);"
  ]);

  const first = runCommand(["src/app.ts"], cwd);
  assert.equal(first.command, "run");
  assert.equal(first.status, "pass");
  assert.equal(first.stage, "execute");
  assert.ok(first.hash && first.hash.length > 0, "expected non-empty hash");

  const cacheFile = path.join(cwd, ".test-oracle", "cache", first.hash + ".json");
  assert.equal(fs.existsSync(cacheFile), true);

  cleanupMarker(cwd, "static.marker");
  cleanupMarker(cwd, "executed.marker");

  const second = runCommand(["src/app.ts"], cwd);
  assert.equal(second.command, "run");
  assert.equal(second.status, "pass");
  assert.equal(second.stage, "cache");
  assert.equal(second.source, "cache");
  assert.equal(second.hash, first.hash);
  assert.equal(second.tests_skipped, 1);
  assert.deepEqual(second.tests_run, []);
  assert.equal(fs.existsSync(path.join(cwd, "static.marker")), false);
  assert.equal(fs.existsSync(path.join(cwd, "executed.marker")), false);
});

test("run ignores cached fail entries and executes mapped tests", () => {
  const cwd = mkTempProject();
  scaffoldNodeFixture(cwd);
  writeConfig(cwd, [
    "ecosystem: node",
    "test_command: \"node ./scripts/pass-test.js\"",
    "coverage_command: \"node ./scripts/write-coverage.js\"",
    "test_pattern: \"src/**/*.test.ts\"",
    "source_patterns:",
    "  - \"src/**/*.ts\"",
    "  - \"!src/**/*.test.ts\""
  ]);
  seedMap(cwd, [
    "CREATE TABLE file_tests (source_path TEXT NOT NULL, test_id TEXT NOT NULL, last_updated INTEGER NOT NULL, PRIMARY KEY (source_path, test_id));",
    "INSERT INTO file_tests (source_path, test_id, last_updated) VALUES ('src/app.ts', 'src/app.test.ts', 1);"
  ]);

  const first = runCommand(["src/app.ts"], cwd);
  assert.equal(first.status, "pass");
  assert.ok(first.hash, "expected hash from first run");

  const cacheFile = path.join(cwd, ".test-oracle", "cache", first.hash + ".json");
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({ status: "fail", timestamp: Math.floor(Date.now() / 1000) })
  );
  cleanupMarker(cwd, "executed.marker");

  const second = runCommand(["src/app.ts"], cwd);
  assert.equal(second.command, "run");
  assert.equal(second.stage, "execute");
  assert.equal(second.source, "run");
  assert.equal(fs.existsSync(path.join(cwd, "executed.marker")), true);
});

test("init builds dependency map and writes state baseline", () => {
  const cwd = mkTempProject();
  scaffoldNodeFixture(cwd);
  writeConfig(cwd, [
    "ecosystem: node",
    "test_command: \"node ./scripts/pass-test.js\"",
    "coverage_command: \"node ./scripts/write-coverage.js\"",
    "test_pattern: \"src/**/*.test.ts\"",
    "source_patterns:",
    "  - \"src/**/*.ts\"",
    "  - \"!src/**/*.test.ts\""
  ]);

  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });

  const result = initCommand(cwd);
  assert.equal(result.command, "init");
  assert.equal(result.status, "pass");
  assert.equal(result.implemented, true);
  assert.equal(result.map.updated, true);
  assert.ok(result.map.entries > 0, "expected map entries");
  assert.equal(result.state.updated, true);
  assert.ok(result.state.baseline, "expected git baseline");

  const mapCount = execFileSync(
    "sqlite3",
    [path.join(cwd, ".test-oracle", "map.db"), "SELECT COUNT(*) FROM file_tests;"],
    { encoding: "utf8" }
  ).trim();
  assert.equal(mapCount, "2");

  const metaCount = execFileSync(
    "sqlite3",
    [
      path.join(cwd, ".test-oracle", "map.db"),
      "SELECT COUNT(*) FROM map_meta WHERE key='last_full_run';"
    ],
    { encoding: "utf8" }
  ).trim();
  assert.equal(metaCount, "1");
});

test("status reports map cache and config details", () => {
  const cwd = mkTempProject();
  scaffoldNodeFixture(cwd);
  writeConfig(cwd, [
    "ecosystem: node",
    "test_command: \"node ./scripts/pass-test.js\"",
    "coverage_command: \"node ./scripts/write-coverage.js\"",
    "test_pattern: \"src/**/*.test.ts\"",
    "source_patterns:",
    "  - \"src/**/*.ts\"",
    "  - \"!src/**/*.test.ts\""
  ]);

  fs.mkdirSync(path.join(cwd, ".test-oracle", "cache"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".test-oracle", "cache", "abc.json"),
    JSON.stringify({ status: "pass", timestamp: Math.floor(Date.now() / 1000) })
  );
  seedMap(cwd, [
    "CREATE TABLE file_tests (source_path TEXT NOT NULL, test_id TEXT NOT NULL, last_updated INTEGER NOT NULL, PRIMARY KEY (source_path, test_id));",
    "INSERT INTO file_tests (source_path, test_id, last_updated) VALUES ('src/app.ts', 'src/app.test.ts', 1);"
  ]);

  const result = statusCommand(cwd);
  assert.equal(result.command, "status");
  assert.equal(result.implemented, true);
  assert.equal(result.map.entries, 1);
  assert.ok(result.map.last_updated, "expected map timestamp");
  assert.equal(typeof result.map.fresh, "boolean");
  assert.equal(result.cache.entries, 1);
  assert.equal(result.config.state, "valid");
  assert.equal(result.config.valid, true);
  assert.equal(result.config.errors, 0);
});

test("status reports pending config when config file is missing", () => {
  const cwd = mkTempProject();
  const result = statusCommand(cwd);

  assert.equal(result.command, "status");
  assert.equal(result.config.state, "pending");
  assert.equal(result.config.valid, null);
  assert.equal(result.config.errors, 0);
});

test("reset clears map cache and state files", () => {
  const cwd = mkTempProject();
  fs.mkdirSync(path.join(cwd, ".test-oracle", "cache"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".test-oracle", "map.db"), "");
  fs.writeFileSync(
    path.join(cwd, ".test-oracle", "cache", "entry.json"),
    JSON.stringify({ status: "pass", timestamp: Math.floor(Date.now() / 1000) })
  );
  fs.writeFileSync(path.join(cwd, ".test-oracle", "state"), "abc123\n");

  const result = resetCommand(cwd);
  assert.equal(result.command, "reset");
  assert.equal(result.implemented, true);
  assert.equal(result.status, "pass");
  assert.equal(result.cleared.map, true);
  assert.equal(result.cleared.cache, true);
  assert.equal(result.cleared.state, true);
  assert.equal(fs.existsSync(path.join(cwd, ".test-oracle", "map.db")), false);
  assert.equal(fs.existsSync(path.join(cwd, ".test-oracle", "state")), false);

  const cacheDir = path.join(cwd, ".test-oracle", "cache");
  assert.equal(fs.existsSync(cacheDir), true);
  assert.deepEqual(fs.readdirSync(cacheDir), []);
});

test("map tracks coverage-derived edges per test and keeps them after refresh", () => {
  const cwd = mkTempProject();
  scaffoldNodeFixture(cwd);
  writeConfig(cwd, [
    "ecosystem: node",
    "test_command: \"node ./scripts/pass-test.js\"",
    "coverage_command: \"node ./scripts/write-coverage.js\"",
    "test_pattern: \"src/**/*.test.ts\"",
    "source_patterns:",
    "  - \"src/**/*.ts\"",
    "  - \"!src/**/*.test.ts\""
  ]);

  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });

  const initResult = initCommand(cwd);
  assert.equal(initResult.command, "init");
  assert.equal(initResult.status, "pass");

  const expectedRows = ["src/app.ts|src/app.test.ts", "src/other.ts|src/other.test.ts"];
  const rowsBefore = execFileSync(
    "sqlite3",
    [
      path.join(cwd, ".test-oracle", "map.db"),
      "SELECT source_path || '|' || test_id FROM file_tests ORDER BY source_path, test_id;"
    ],
    { encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  assert.deepEqual(rowsBefore, expectedRows);

  const runResult = runCommand(["src/app.ts"], cwd);
  assert.equal(runResult.command, "run");
  assert.equal(runResult.status, "pass");

  const rowsAfter = execFileSync(
    "sqlite3",
    [
      path.join(cwd, ".test-oracle", "map.db"),
      "SELECT source_path || '|' || test_id FROM file_tests ORDER BY source_path, test_id;"
    ],
    { encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  assert.deepEqual(rowsAfter, expectedRows);
});

function scaffoldNodeFixture(cwd) {
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "src", "app.ts"), "export const value = 1;\n");
  fs.writeFileSync(path.join(cwd, "src", "app.test.ts"), "test('ok', () => {});\n");
  fs.writeFileSync(path.join(cwd, "src", "other.ts"), "export const otherValue = 2;\n");
  fs.writeFileSync(path.join(cwd, "src", "other.test.ts"), "test('other', () => {});\n");
  fs.writeFileSync(
    path.join(cwd, "scripts", "pass-test.js"),
    "const fs = require('node:fs'); fs.writeFileSync('executed.marker', 'yes'); process.exit(0);\n"
  );
  fs.writeFileSync(
    path.join(cwd, "scripts", "static-check.js"),
    "const fs = require('node:fs'); fs.writeFileSync('static.marker', 'yes'); process.exit(0);\n"
  );
  fs.writeFileSync(
    path.join(cwd, "scripts", "write-coverage.js"),
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const cwd = process.cwd();",
      "const coverageDir = path.join(cwd, 'coverage');",
      "fs.rmSync(coverageDir, { recursive: true, force: true });",
      "fs.mkdirSync(coverageDir, { recursive: true });",
      "const srcDir = path.join(cwd, 'src');",
      "const testId = process.argv[2] ?? '';",
      "const coverage = {};",
      "if (testId.includes('src/app.test.ts')) {",
      "  const target = path.join(srcDir, 'app.ts');",
      "  coverage[target] = { path: target };",
      "}",
      "if (testId.includes('src/other.test.ts')) {",
      "  const target = path.join(srcDir, 'other.ts');",
      "  coverage[target] = { path: target };",
      "}",
      "if (Object.keys(coverage).length === 0) {",
      "  const fallback = path.join(srcDir, 'app.ts');",
      "  coverage[fallback] = { path: fallback };",
      "}",
      "fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify(coverage));"
    ].join("\n")
  );
}

function seedMap(cwd, sqlStatements) {
  fs.mkdirSync(path.join(cwd, ".test-oracle"), { recursive: true });
  execFileSync(
    "sqlite3",
    [path.join(cwd, ".test-oracle", "map.db"), sqlStatements.join(" ")],
    { stdio: "ignore" }
  );
}

function writeConfig(cwd, lines) {
  fs.writeFileSync(path.join(cwd, ".test-oracle.yml"), lines.join("\n"));
}

function cleanupMarker(cwd, markerName) {
  const marker = path.join(cwd, markerName);
  if (fs.existsSync(marker)) {
    fs.rmSync(marker, { force: true });
  }
}

function mkTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "test-oracle-"));
}
