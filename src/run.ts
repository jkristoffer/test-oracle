import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CommandError,
  CommandOutput,
  RunResult
} from "./contracts";
import { loadConfig } from "./config";
import { getAdapter } from "./adapters";
import { combineOutput, summarizeError } from "./execution";
import { unknownEcosystemError, noMapError } from "./output";
import { runConfigPreflight } from "./validate";
import { resolveGitBaseline, writeStateBaseline } from "./operations";
import { normalizeRelativePath, normalizeSlashes, unique } from "./utils/paths";
import { readCacheMetrics, writeCacheMetrics, CacheMetrics } from "./cacheMetrics";

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

  const adapter = getAdapter(loaded.config.ecosystem);
  if (!adapter) {
    return withCommand(unknownEcosystemError(loaded.config.ecosystem, "run"), "run");
  }

  const changedFiles = resolveChangedFiles(cwd, files);
  const changedSources = adapter.filterSourceFiles(changedFiles, loaded.config, cwd);
  if (changedSources.length === 0) {
    return skipResult("detect", "no_changes", Date.now() - runStartMs);
  }

  const mapPath = path.join(cwd, ".test-oracle", "map.db");
  if (!fs.existsSync(mapPath)) {
    return noMapError("run");
  }

  const mappedTests = adapter.queryMap(mapPath, changedSources, loaded.config, cwd);
  if (mappedTests.length === 0) {
    return skipResult("map", "no_tests_mapped", Date.now() - runStartMs);
  }

  const hash = computeRunHash(cwd, changedSources, mappedTests, loaded.path);
  const cacheDir = ensureCacheDir(cwd);
  evictExpiredCacheEntries(cacheDir, loaded.config.cache_ttl_days ?? DEFAULT_CACHE_TTL_DAYS);
  const cached = readCacheEntry(cacheDir, hash);
  if (cached?.status === "pass") {
    recordCacheHit(cwd);
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

  recordCacheMiss(cwd);

  const executeResult = adapter.runTests(mappedTests, loaded.config, cwd);
  const mapUpdated = adapter.refreshMapFromCoverage
    ? adapter.refreshMapFromCoverage(mapPath, mappedTests, loaded.config, cwd)
    : false;

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
    failed_test: adapter.detectFailedTest(combinedOutput, mappedTests),
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


function recordCacheHit(cwd: string): void {
  updateCacheMetrics(cwd, (metrics) => {
    metrics.hits += 1;
  });
}

function recordCacheMiss(cwd: string): void {
  updateCacheMetrics(cwd, (metrics) => {
    metrics.misses += 1;
  });
}

function updateCacheMetrics(cwd: string, updater: (metrics: CacheMetrics) => void): void {
  const metrics = readCacheMetrics(cwd);
  updater(metrics);
  metrics.updated_at = new Date().toISOString();
  writeCacheMetrics(cwd, metrics);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface CacheEntry {
  status: "pass" | "fail";
  timestamp: number;
}
