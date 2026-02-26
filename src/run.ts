import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import {
  CommandError,
  CommandOutput,
  OracleConfig,
  RunResult
} from "./contracts";
import { loadConfig } from "./config";
import { noMapError } from "./output";
import { commandNameFromInvocation, parseCommandInvocation } from "./system";
import { runConfigPreflight } from "./validate";
import { resolveGitBaseline, writeStateBaseline } from "./operations";

const DEFAULT_CONVENTION_PATTERN = "{name}.test.{ext}";
const MAX_ERROR_TEXT = 4000;
const DEFAULT_CACHE_TTL_DAYS = 7;

export function executeRun(files: string[], cwd: string): CommandOutput {
  const runStartMs = Date.now();

  const preflight = runConfigPreflight(cwd);
  if (preflight) {
    return isCommandError(preflight) ? withCommand(preflight, "run") : preflight;
  }

  const loaded = loadConfig(cwd);
  if (!loaded.ok) {
    if (loaded.error) {
      return withCommand(loaded.error, "run");
    }

    return {
      command: "validate",
      valid: false,
      errors: loaded.issues ?? [],
      warnings: []
    };
  }

  const changedFiles = resolveChangedFiles(cwd, files);
  const changedSources = filterSourceFiles(changedFiles, loaded.config, cwd);
  if (changedSources.length === 0) {
    return skipResult("detect", "no_changes", Date.now() - runStartMs);
  }

  const mapPath = path.join(cwd, ".test-oracle", "map.db");
  if (!fs.existsSync(mapPath)) {
    return noMapError("run");
  }

  const mappedTests = resolveMappedTests(mapPath, changedSources, loaded.config, cwd);
  if (mappedTests.length === 0) {
    return skipResult("map", "no_tests_mapped", Date.now() - runStartMs);
  }

  const hash = computeRunHash(cwd, changedSources, mappedTests, loaded.path);
  const cacheDir = ensureCacheDir(cwd);
  evictExpiredCacheEntries(cacheDir, loaded.config.cache_ttl_days ?? DEFAULT_CACHE_TTL_DAYS);
  const cached = readCacheEntry(cacheDir, hash);
  if (cached?.status === "pass") {
    return {
      command: "run",
      status: "pass",
      stage: "cache",
      source: "cache",
      hash,
      tests_run: [],
      tests_skipped: mappedTests.length,
      failed_test: null,
      error: null,
      duration_ms: Date.now() - runStartMs,
      map_updated: false,
      static_checks_passed: false
    };
  }

  const staticChecks = runStaticChecks(loaded.config, changedSources, cwd);
  if (!staticChecks.ok) {
    return {
      command: "run",
      status: "fail",
      stage: "static",
      source: "run",
      check: staticChecks.failedCheck,
      hash,
      tests_run: [],
      tests_skipped: 0,
      failed_test: null,
      error: staticChecks.error,
      duration_ms: Date.now() - runStartMs,
      map_updated: false,
      static_checks_passed: false
    };
  }

  const executeResult = executeMappedTests(loaded.config, mappedTests, cwd);
  const mapUpdated = refreshMapFromCoverage(loaded.config, mapPath, mappedTests, cwd);

  if (executeResult.exitCode === 0) {
    writeCacheEntry(cacheDir, hash, {
      status: "pass",
      timestamp: Math.floor(Date.now() / 1000)
    });
    const statePath = path.join(cwd, ".test-oracle", "state");
    const baseline = resolveGitBaseline(cwd);
    writeStateBaseline(statePath, baseline);

    return {
      command: "run",
      status: "pass",
      stage: "execute",
      source: "run",
      hash,
      tests_run: mappedTests,
      tests_skipped: 0,
      failed_test: null,
      error: null,
      duration_ms: Date.now() - runStartMs,
      map_updated: mapUpdated,
      static_checks_passed: true
    };
  }

  const combinedOutput = combineOutput(executeResult);
  return {
    command: "run",
    status: "fail",
    stage: "execute",
    source: "run",
    hash,
    tests_run: mappedTests,
    tests_skipped: 0,
    failed_test: detectFailedTest(combinedOutput, mappedTests),
    error: summarizeError(combinedOutput),
    duration_ms: Date.now() - runStartMs,
    map_updated: mapUpdated,
    static_checks_passed: true
  };
}

function computeRunHash(
  cwd: string,
  changedSources: string[],
  mappedTests: string[],
  configPath: string
): string {
  const sourceFiles = unique(changedSources.map((file) => normalizeSlashes(file))).sort();
  const testFiles = resolveMappedTestFiles(cwd, mappedTests).sort();
  const hash = createHash("sha256");

  const configContent = safeReadText(configPath);
  hash.update("config\0" + configContent + "\0");

  for (const source of sourceFiles) {
    const content = safeReadText(path.resolve(cwd, source));
    hash.update("source\0" + source + "\0" + content + "\0");
  }

  for (const testFile of testFiles) {
    const content = safeReadText(path.resolve(cwd, testFile));
    hash.update("test\0" + testFile + "\0" + content + "\0");
  }

  return hash.digest("hex");
}

function resolveMappedTestFiles(cwd: string, mappedTests: string[]): string[] {
  const resolved = new Set<string>();

  for (const testId of mappedTests) {
    const direct = resolveExistingRelativeFile(cwd, testId);
    if (direct) {
      resolved.add(direct);
      continue;
    }

    const separatorIndex = testId.indexOf(":");
    if (separatorIndex > 0) {
      const filePart = testId.slice(0, separatorIndex);
      const fromFilePart = resolveExistingRelativeFile(cwd, filePart);
      if (fromFilePart) {
        resolved.add(fromFilePart);
      }
    }
  }

  return Array.from(resolved.values());
}

function resolveExistingRelativeFile(cwd: string, target: string): string | null {
  const absolute = path.isAbsolute(target) ? target : path.resolve(cwd, target);
  try {
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) {
      return null;
    }
    return normalizeRelativePath(cwd, absolute);
  } catch {
    return null;
  }
}

function safeReadText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function ensureCacheDir(cwd: string): string {
  const cacheDir = path.join(cwd, ".test-oracle", "cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

function evictExpiredCacheEntries(cacheDir: string, ttlDays: number): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cacheDir, { withFileTypes: true });
  } catch {
    return;
  }

  const ttlSeconds = Math.max(0, ttlDays) * 24 * 60 * 60;
  const now = Math.floor(Date.now() / 1000);

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const cachePath = path.join(cacheDir, entry.name);
    const cacheEntry = readCacheEntryByPath(cachePath);
    if (!cacheEntry) {
      try {
        fs.rmSync(cachePath, { force: true });
      } catch {
        // ignore cache cleanup failures
      }
      continue;
    }

    if (now - cacheEntry.timestamp > ttlSeconds) {
      try {
        fs.rmSync(cachePath, { force: true });
      } catch {
        // ignore cache cleanup failures
      }
    }
  }
}

function readCacheEntry(cacheDir: string, hash: string): CacheEntry | null {
  return readCacheEntryByPath(cacheFilePath(cacheDir, hash));
}

function readCacheEntryByPath(cachePath: string): CacheEntry | null {
  let raw: string;
  try {
    raw = fs.readFileSync(cachePath, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const status = parsed.status;
  const timestamp = parsed.timestamp;
  if ((status !== "pass" && status !== "fail") || typeof timestamp !== "number") {
    return null;
  }

  return {
    status,
    timestamp
  };
}

function writeCacheEntry(cacheDir: string, hash: string, entry: CacheEntry): void {
  try {
    fs.writeFileSync(cacheFilePath(cacheDir, hash), JSON.stringify(entry));
  } catch {
    // ignore cache write failures; run output remains deterministic
  }
}

function cacheFilePath(cacheDir: string, hash: string): string {
  return path.join(cacheDir, hash + ".json");
}

function skipResult(
  stage: "detect" | "map",
  reason: "no_changes" | "no_tests_mapped",
  durationMs: number
): RunResult {
  return {
    command: "run",
    status: "skip",
    stage,
    source: "run",
    hash: null,
    tests_run: [],
    tests_skipped: 0,
    failed_test: null,
    error: null,
    duration_ms: durationMs,
    map_updated: false,
    static_checks_passed: false,
    reason
  };
}

function resolveChangedFiles(cwd: string, explicitFiles: string[]): string[] {
  if (explicitFiles.length > 0) {
    return unique(explicitFiles.map((file) => normalizeRelativePath(cwd, file)));
  }

  const statePath = path.join(cwd, ".test-oracle", "state");
  if (fs.existsSync(statePath)) {
    const baseline = fs.readFileSync(statePath, "utf8").trim();
    if (baseline.length > 0) {
      const fromState = safeGitChangedFiles(cwd, ["diff", "--name-only", baseline, "--"]);
      if (fromState.length > 0) {
        return unique(fromState.map((file) => normalizeRelativePath(cwd, file)));
      }
    }
  }

  const fromHead = safeGitChangedFiles(cwd, ["diff", "--name-only", "HEAD", "--"]);
  if (fromHead.length > 0) {
    return unique(fromHead.map((file) => normalizeRelativePath(cwd, file)));
  }

  const untracked = safeGitChangedFiles(cwd, [
    "ls-files",
    "--modified",
    "--others",
    "--exclude-standard"
  ]);
  return unique(untracked.map((file) => normalizeRelativePath(cwd, file)));
}

function safeGitChangedFiles(cwd: string, args: string[]): string[] {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function filterSourceFiles(files: string[], config: OracleConfig, cwd: string): string[] {
  if (files.length === 0) {
    return [];
  }

  const matchedSources = new Set(
    fg
      .sync(config.source_patterns, {
        cwd,
        onlyFiles: true,
        dot: true,
        ignore: ["**/node_modules/**", "**/.git/**"]
      })
      .map((file) => normalizeSlashes(file))
  );

  return files
    .map((file) => normalizeSlashes(file))
    .filter((file) => matchedSources.has(file));
}

function resolveMappedTests(
  mapPath: string,
  changedSources: string[],
  config: OracleConfig,
  cwd: string
): string[] {
  const rows = readMapRows(mapPath);
  const bySource = new Map<string, Set<string>>();

  for (const row of rows) {
    const source = normalizeRelativePath(cwd, row.sourcePath);
    if (!bySource.has(source)) {
      bySource.set(source, new Set());
    }
    bySource.get(source)?.add(row.testId);
  }

  const mapped = new Set<string>();
  const unresolved = new Set<string>();

  for (const sourcePath of changedSources) {
    const directMatches = bySource.get(sourcePath);
    if (directMatches && directMatches.size > 0) {
      for (const testId of directMatches) {
        mapped.add(normalizeSlashes(testId));
      }
      continue;
    }

    unresolved.add(sourcePath);
  }

  const fallbackPattern = config.convention_map?.pattern || DEFAULT_CONVENTION_PATTERN;
  for (const sourcePath of unresolved) {
    const fallback = resolveConventionFallback(sourcePath, fallbackPattern, cwd);
    if (fallback) {
      mapped.add(fallback);
    }
  }

  return Array.from(mapped.values()).sort();
}

function readMapRows(mapPath: string): Array<{ sourcePath: string; testId: string }> {
  try {
    const output = execFileSync(
      "sqlite3",
      [mapPath, "SELECT source_path, test_id FROM file_tests;"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const dividerIndex = line.indexOf("|");
        if (dividerIndex === -1) {
          return {
            sourcePath: line,
            testId: ""
          };
        }

        return {
          sourcePath: line.slice(0, dividerIndex),
          testId: line.slice(dividerIndex + 1)
        };
      })
      .filter((row) => row.testId.length > 0);
  } catch {
    return [];
  }
}

function resolveConventionFallback(
  sourcePath: string,
  pattern: string,
  cwd: string
): string | null {
  const parsed = path.parse(sourcePath);
  const extWithoutDot = parsed.ext.startsWith(".") ? parsed.ext.slice(1) : parsed.ext;
  const filename = pattern
    .replaceAll("{name}", parsed.name)
    .replaceAll("{ext}", extWithoutDot);
  const candidate = normalizeSlashes(path.join(parsed.dir, filename));
  const absoluteCandidate = path.resolve(cwd, candidate);
  if (fs.existsSync(absoluteCandidate)) {
    return candidate;
  }

  return null;
}

function runStaticChecks(
  config: OracleConfig,
  changedSources: string[],
  cwd: string
): { ok: true } | { ok: false; failedCheck: string; error: string } {
  const checks = config.static_checks ?? [];
  for (const check of checks) {
    const checkName = commandNameFromInvocation(check) ?? "unknown";
    const scopedArgs = shouldScopeStaticCheck(check) ? changedSources : [];
    const result = runInvocation(check, cwd, scopedArgs, true);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        failedCheck: checkName,
        error: summarizeError(combineOutput(result))
      };
    }
  }

  return { ok: true };
}

function executeMappedTests(
  config: OracleConfig,
  mappedTests: string[],
  cwd: string
): InvocationResult {
  const extraArgs = buildTestExtraArgs(config.test_command, config, mappedTests);
  return runInvocation(config.test_command, cwd, extraArgs, true);
}

function buildTestExtraArgs(
  invocation: string,
  config: OracleConfig,
  mappedTests: string[]
): string[] {
  const failFast = config.fail_fast ?? true;
  const args: string[] = [];
  const lowerInvocation = invocation.toLowerCase();
  const commandName = (commandNameFromInvocation(invocation) ?? "").toLowerCase();

  if (failFast && shouldAttachBailFlag(commandName, lowerInvocation)) {
    args.push("--bail");
  }

  args.push(...mappedTests);
  return args;
}

function shouldAttachBailFlag(commandName: string, invocation: string): boolean {
  if (commandName === "vitest" || commandName === "jest") {
    return true;
  }

  if (
    (commandName === "npm" ||
      commandName === "pnpm" ||
      commandName === "yarn" ||
      commandName === "bun" ||
      commandName === "npx") &&
    (invocation.includes("vitest") || invocation.includes("jest"))
  ) {
    return true;
  }

  return false;
}

function refreshMapFromCoverage(
  config: OracleConfig,
  mapPath: string,
  mappedTests: string[],
  cwd: string
): boolean {
  const edges = collectCoverageEdgesForTests(config, cwd, mappedTests);
  if (!edges || edges.length === 0) {
    return false;
  }

  return upsertCoverageMappings(mapPath, edges);
}

function collectCoverageEdgesForTests(
  config: OracleConfig,
  cwd: string,
  mappedTests: string[]
): Array<{ source: string; testId: string }> | null {
  const normalizedTests = Array.from(
    new Set(mappedTests.map((test) => normalizeSlashes(test)))
  ).sort();
  const edges: Array<{ source: string; testId: string }> = [];

  for (const testId of normalizedTests) {
    const coverageSources = collectCoverageSourcesForTest(config, cwd, testId);
    if (coverageSources === null) {
      return null;
    }

    for (const source of coverageSources) {
      if (source.length === 0) {
        continue;
      }
      edges.push({ source: normalizeSlashes(source), testId });
    }
  }

  return edges;
}

function collectCoverageSourcesForTest(
  config: OracleConfig,
  cwd: string,
  testId: string
): string[] | null {
  cleanCoverageArtifacts(cwd);
  const coverageRun = runInvocation(config.coverage_command, cwd, [testId], true);
  if (coverageRun.exitCode !== 0) {
    return null;
  }

  const coveragePath = findCoveragePath(cwd);
  if (!coveragePath) {
    return null;
  }

  return extractCoveredSources(coveragePath, cwd, config);
}

function cleanCoverageArtifacts(cwd: string): void {
  const targets = [
    path.join(cwd, "coverage"),
    path.join(cwd, "coverage-final.json"),
    path.join(cwd, ".nyc_output")
  ];

  for (const target of targets) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

function findCoveragePath(cwd: string): string | null {
  const candidates = [
    path.join(cwd, "coverage", "coverage-final.json"),
    path.join(cwd, "coverage-final.json"),
    path.join(cwd, ".nyc_output", "out.json")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractCoveredSources(coveragePath: string, cwd: string, config: OracleConfig): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(coveragePath, "utf8"));
  } catch {
    return [];
  }

  if (!isRecord(parsed)) {
    return [];
  }

  const knownSources = new Set(
    fg
      .sync(config.source_patterns, {
        cwd,
        onlyFiles: true,
        dot: true,
        ignore: ["**/node_modules/**", "**/.git/**"]
      })
      .map((file) => normalizeSlashes(file))
  );

  const covered = new Set<string>();
  for (const key of Object.keys(parsed)) {
    const normalized = normalizeRelativePath(cwd, key);
    if (normalized.startsWith("../")) {
      continue;
    }
    if (knownSources.has(normalized)) {
      covered.add(normalized);
    }
  }

  return Array.from(covered.values()).sort();
}

function upsertCoverageMappings(
  mapPath: string,
  edges: Array<{ source: string; testId: string }>
): boolean {
  if (edges.length === 0) {
    return false;
  }

  const grouped = new Map<string, Set<string>>();
  for (const edge of edges) {
    const tests = grouped.get(edge.source) ?? new Set<string>();
    tests.add(normalizeSlashes(edge.testId));
    grouped.set(edge.source, tests);
  }

  const sources = Array.from(grouped.keys()).sort();
  const now = Math.floor(Date.now() / 1000);
  const sql: string[] = [];
  sql.push("BEGIN TRANSACTION;");
  sql.push(
    "CREATE TABLE IF NOT EXISTS file_tests (source_path TEXT NOT NULL, test_id TEXT NOT NULL, last_updated INTEGER NOT NULL, PRIMARY KEY (source_path, test_id));"
  );

  for (const source of sources) {
    sql.push("DELETE FROM file_tests WHERE source_path = '" + escapeSql(source) + "';");
  }

  for (const source of sources) {
    const tests = Array.from(grouped.get(source) ?? []).sort();
    for (const testId of tests) {
      sql.push(
        "INSERT INTO file_tests (source_path, test_id, last_updated) VALUES ('" +
          escapeSql(source) +
          "', '" +
          escapeSql(testId) +
          "', " +
          String(now) +
          ") ON CONFLICT(source_path, test_id) DO UPDATE SET last_updated = excluded.last_updated;"
      );
    }
  }

  sql.push("COMMIT;");

  try {
    execFileSync("sqlite3", [mapPath, sql.join("\n")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return true;
  } catch {
    return false;
  }
}

function runInvocation(
  invocation: string,
  cwd: string,
  extraArgs: string[],
  enablePassThrough: boolean
): InvocationResult {
  const parsed = parseCommandInvocation(invocation);
  if (!parsed) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Command is empty.",
      durationMs: 0
    };
  }

  const startMs = Date.now();
  const args = appendExtraArgs(parsed.command, parsed.args, extraArgs, enablePassThrough);
  const result = spawnSync(parsed.command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error?.message ?? ""),
    durationMs: Date.now() - startMs
  };
}

function appendExtraArgs(
  command: string,
  baseArgs: string[],
  extraArgs: string[],
  enablePassThrough: boolean
): string[] {
  if (extraArgs.length === 0) {
    return [...baseArgs];
  }

  const lower = command.toLowerCase();
  if (!enablePassThrough || !isPackageManager(lower)) {
    return [...baseArgs, ...extraArgs];
  }

  if (baseArgs.includes("--")) {
    return [...baseArgs, ...extraArgs];
  }

  return [...baseArgs, "--", ...extraArgs];
}

function isPackageManager(command: string): boolean {
  return command === "npm" || command === "pnpm" || command === "yarn" || command === "bun";
}

function shouldScopeStaticCheck(invocation: string): boolean {
  const value = invocation.toLowerCase();
  return (
    value.includes("eslint") ||
    value.includes("biome") ||
    value.includes("prettier") ||
    value.includes("oxlint") ||
    value.includes("ruff")
  );
}

function detectFailedTest(output: string, mappedTests: string[]): string | null {
  const normalized = output.toLowerCase();
  for (const mappedTest of mappedTests) {
    if (normalized.includes(mappedTest.toLowerCase())) {
      return mappedTest;
    }
  }

  const match = output.match(/([A-Za-z0-9_./-]+\.(test|spec)\.[A-Za-z0-9_:-]+)/);
  return match ? match[1] : null;
}

function combineOutput(result: InvocationResult): string {
  const parts = [result.stderr.trim(), result.stdout.trim()].filter((part) => part.length > 0);
  return parts.join("\n");
}

function summarizeError(text: string): string {
  if (text.trim().length === 0) {
    return "Command failed with no output.";
  }

  if (text.length <= MAX_ERROR_TEXT) {
    return text;
  }

  return text.slice(0, MAX_ERROR_TEXT);
}

function normalizeRelativePath(cwd: string, filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  const cwdReal = safeRealpath(cwd) ?? cwd;
  const absoluteReal = safeRealpath(absolutePath) ?? absolutePath;

  const candidates = [
    path.relative(cwd, absolutePath),
    path.relative(cwdReal, absoluteReal),
    path.relative(cwdReal, absolutePath),
    path.relative(cwd, absoluteReal)
  ].filter((candidate) => candidate.length > 0);

  const preferred =
    candidates.find((candidate) => !candidate.startsWith("..")) ?? candidates[0] ?? path.basename(absolutePath);

  return normalizeSlashes(preferred);
}

function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function withCommand(error: CommandError, command: string): CommandError {
  return {
    ...error,
    command
  };
}

function isCommandError(value: CommandOutput): value is CommandError {
  return "kind" in value && value.kind === "error";
}

function escapeSql(value: string): string {
  return value.replaceAll("'", "''");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeRealpath(targetPath: string): string | null {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return null;
  }
}

interface InvocationResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface CacheEntry {
  status: "pass" | "fail";
  timestamp: number;
}
