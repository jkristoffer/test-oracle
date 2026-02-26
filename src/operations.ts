import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CommandError,
  CommandOutput,
  InitResult,
  ResetResult,
  StatusResult,
  ValidationResult
} from "./contracts";
import { loadConfig } from "./config";
import { runConfigPreflight, validateProject } from "./validate";
import {
  computeCacheHitRate,
  readCacheMetrics,
  resetCacheMetrics
} from "./cacheMetrics";
import { escapeSql } from "./sql-utils";
import {
  computeFrameworkConfigSnapshot,
  FRAMEWORK_CONFIG_FINGERPRINT_KEY,
  FRAMEWORK_CONFIG_FILES_KEY,
  FrameworkConfigSnapshot
} from "./framework-config";
import { getAdapter } from "./adapters";
import { unknownEcosystemError } from "./output";

const MAP_SCHEMA_VERSION = "1";
const MAP_FRESH_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export function executeInit(cwd: string): CommandOutput {
  const startedAt = Date.now();

  const preflight = runConfigPreflight(cwd, "init");
  if (preflight) {
    return isCommandError(preflight) ? withCommand(preflight, "init") : preflight;
  }

  const loaded = loadConfig(cwd);
  if (!loaded.ok) {
    if (loaded.error) {
      return withCommand(loaded.error, "init");
    }
    return {
      command: "validate",
      valid: false,
      errors: loaded.issues ?? [],
      warnings: []
    };
  }

  const oracleDir = path.join(cwd, ".test-oracle");
  fs.mkdirSync(oracleDir, { recursive: true });
  const mapPath = path.join(oracleDir, "map.db");
  const statePath = path.join(oracleDir, "state");

  const adapter = getAdapter(loaded.config.ecosystem);
  if (!adapter) {
    return withCommand(unknownEcosystemError(loaded.config.ecosystem, "init"), "init");
  }

  let edges: Array<{ source: string; testId: string }>;
  try {
    edges = adapter.generateMap(loaded.config, cwd);
  } catch (error) {
    return initFailureResult(mapPath, startedAt, asErrorMessage(error));
  }
  if (edges.length === 0) {
    return initFailureResult(
      mapPath,
      startedAt,
      "Unable to derive source-to-test mappings from coverage output."
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const snapshot = computeFrameworkConfigSnapshot(cwd);
  const mapUpdated = rebuildMap(
    mapPath,
    edges,
    loaded.config.ecosystem,
    nowSeconds,
    snapshot
  );
  if (!mapUpdated) {
    return initFailureResult(
      mapPath,
      startedAt,
      "Failed to rebuild dependency map (map.db)."
    );
  }

  const baseline = resolveGitBaseline(cwd);
  const stateUpdated = writeStateBaseline(statePath, baseline);

  return {
    command: "init",
    implemented: true,
    status: "pass",
    message: "Dependency map initialized successfully.",
    map: {
      path: mapPath,
      entries: edges.length,
      updated: true,
      last_full_run: new Date(nowSeconds * 1000).toISOString()
    },
    state: {
      baseline,
      updated: stateUpdated
    },
    duration_ms: Date.now() - startedAt,
    error: null
  };
}

export function executeStatus(cwd: string): StatusResult {
  const mapPath = path.join(cwd, ".test-oracle", "map.db");
  const cacheDir = path.join(cwd, ".test-oracle", "cache");

  const mapInfo = readMapStatus(mapPath);
  const cacheInfo = readCacheStatus(cacheDir);
  const configInfo = readConfigStatus(cwd);
  const cacheMetrics = readCacheMetrics(cwd);

  return {
    command: "status",
    implemented: true,
    map: {
      last_updated: mapInfo.lastUpdatedIso,
      entries: mapInfo.entries,
      fresh: mapInfo.fresh
    },
    cache: {
      entries: cacheInfo.entries,
      hit_rate: computeCacheHitRate(cacheMetrics)
    },
    config: configInfo
  };
}

export function executeReset(cwd: string): ResetResult {
  const mapPath = path.join(cwd, ".test-oracle", "map.db");
  const cacheDir = path.join(cwd, ".test-oracle", "cache");
  const statePath = path.join(cwd, ".test-oracle", "state");

  const errors: string[] = [];
  const cleared = {
    map: false,
    cache: false,
    state: false
  };

  const mapExisted = fs.existsSync(mapPath);
  if (mapExisted) {
    try {
      fs.rmSync(mapPath, { force: true });
      cleared.map = true;
    } catch (error) {
      errors.push("map: " + asErrorMessage(error));
    }
  }

  const cacheExisted = fs.existsSync(cacheDir);
  if (cacheExisted) {
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      fs.mkdirSync(cacheDir, { recursive: true });
      cleared.cache = true;
    } catch (error) {
      errors.push("cache: " + asErrorMessage(error));
    }
  }

  resetCacheMetrics(cwd);

  const stateExisted = fs.existsSync(statePath);
  if (stateExisted) {
    try {
      fs.rmSync(statePath, { force: true });
      cleared.state = true;
    } catch (error) {
      errors.push("state: " + asErrorMessage(error));
    }
  }

  if (errors.length > 0) {
    return {
      command: "reset",
      implemented: true,
      status: "partial",
      cleared,
      message: "Reset completed with errors: " + errors.join("; ")
    };
  }

  return {
    command: "reset",
    implemented: true,
    status: "pass",
    cleared,
    message: "Reset completed."
  };
}

function initFailureResult(mapPath: string, startedAt: number, error: string): InitResult {
  return {
    command: "init",
    implemented: true,
    status: "fail",
    message: "Init failed.",
    map: {
      path: mapPath,
      entries: 0,
      updated: false,
      last_full_run: null
    },
    state: {
      baseline: null,
      updated: false
    },
    duration_ms: Date.now() - startedAt,
    error
  };
}

function rebuildMap(
  mapPath: string,
  edges: Array<{ source: string; testId: string }>,
  ecosystem: string,
  nowSeconds: number,
  snapshot?: FrameworkConfigSnapshot
): boolean {
  const sql: string[] = [];
  sql.push("BEGIN TRANSACTION;");
  sql.push(
    "CREATE TABLE IF NOT EXISTS file_tests (source_path TEXT NOT NULL, test_id TEXT NOT NULL, last_updated INTEGER NOT NULL, PRIMARY KEY (source_path, test_id));"
  );
  sql.push(
    "CREATE TABLE IF NOT EXISTS map_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
  );
  sql.push("DELETE FROM file_tests;");
  sql.push("DELETE FROM map_meta;");

  for (const edge of edges) {
    sql.push(
      "INSERT INTO file_tests (source_path, test_id, last_updated) VALUES ('" +
        escapeSql(edge.source) +
        "', '" +
        escapeSql(edge.testId) +
        "', " +
        String(nowSeconds) +
        ");"
    );
  }

  sql.push(
    "INSERT INTO map_meta (key, value) VALUES ('last_full_run', '" +
      String(nowSeconds) +
      "');"
  );
  sql.push(
    "INSERT INTO map_meta (key, value) VALUES ('adapter', '" + escapeSql(ecosystem) + "');"
  );
  sql.push(
    "INSERT INTO map_meta (key, value) VALUES ('schema_version', '" + MAP_SCHEMA_VERSION + "');"
  );
  if (snapshot) {
    sql.push(
      "INSERT INTO map_meta (key, value) VALUES ('" +
        FRAMEWORK_CONFIG_FINGERPRINT_KEY +
        "', '" +
        escapeSql(snapshot.fingerprint) +
        "');"
    );
    sql.push(
      "INSERT INTO map_meta (key, value) VALUES ('" +
        FRAMEWORK_CONFIG_FILES_KEY +
        "', '" +
        escapeSql(JSON.stringify(snapshot.files)) +
        "');"
    );
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

function readMapStatus(mapPath: string): {
  entries: number;
  lastUpdatedIso: string | null;
  fresh: boolean | null;
} {
  if (!fs.existsSync(mapPath)) {
    return {
      entries: 0,
      lastUpdatedIso: null,
      fresh: null
    };
  }

  try {
    const output = execFileSync(
      "sqlite3",
      [mapPath, "SELECT COUNT(*), MAX(last_updated) FROM file_tests;"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    )
      .trim()
      .split("|");

    const entries = Number(output[0] ?? 0);
    const maxLastUpdated = Number(output[1] ?? 0);
    const hasTimestamp = Number.isFinite(maxLastUpdated) && maxLastUpdated > 0;
    const lastUpdatedIso = hasTimestamp
      ? new Date(maxLastUpdated * 1000).toISOString()
      : null;
    const fresh =
      hasTimestamp && entries > 0
        ? Math.floor(Date.now() / 1000) - maxLastUpdated <= MAP_FRESH_WINDOW_SECONDS
        : null;

    return {
      entries: Number.isFinite(entries) ? entries : 0,
      lastUpdatedIso,
      fresh
    };
  } catch {
    return {
      entries: 0,
      lastUpdatedIso: null,
      fresh: null
    };
  }
}

function readCacheStatus(cacheDir: string): { entries: number } {
  if (!fs.existsSync(cacheDir)) {
    return { entries: 0 };
  }

  try {
    const entries = fs
      .readdirSync(cacheDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .length;
    return { entries };
  } catch {
    return { entries: 0 };
  }
}

function readConfigStatus(cwd: string): StatusResult["config"] {
  const validation = validateProject(cwd);
  if (isCommandError(validation)) {
    if (validation.error === "no_config") {
      return {
        state: "pending",
        valid: null,
        errors: 0
      };
    }

    return {
      state: "invalid",
      valid: false,
      errors: 1
    };
  }

  if (validation.valid) {
    return {
      state: "valid",
      valid: true,
      errors: 0
    };
  }

  return {
    state: "invalid",
    valid: false,
    errors: validation.errors.length
  };
}

export function writeStateBaseline(statePath: string, baseline: string | null): boolean {
  if (!baseline) {
    return false;
  }

  try {
    fs.writeFileSync(statePath, baseline + "\n");
    return true;
  } catch {
    return false;
  }
}

export function resolveGitBaseline(cwd: string): string | null {
  try {
    const output = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function withCommand(error: CommandError, command: string): CommandError {
  return {
    ...error,
    command
  };
}

function isCommandError(value: ValidationResult | CommandError): value is CommandError {
  return "kind" in value && value.kind === "error";
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
