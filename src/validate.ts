import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import {
  CommandError,
  OracleConfig,
  ValidationIssue,
  ValidationResult
} from "./contracts";
import { loadConfig, SUPPORTED_ADAPTERS } from "./config";
import { commandNotFoundError, unknownEcosystemError } from "./output";
import { commandNameFromInvocation, isCommandResolvable } from "./system";
import { normalizeSlashes } from "./path-utils";
import {
  computeFrameworkConfigSnapshot,
  FRAMEWORK_CONFIG_FINGERPRINT_KEY,
  FRAMEWORK_CONFIG_FILES_KEY
} from "./framework-config";

export function validateProject(cwd: string): ValidationResult | CommandError {
  const loaded = loadConfig(cwd);

  if (!loaded.ok) {
    if (loaded.error) {
      return loaded.error;
    }

    return {
      command: "validate",
      valid: false,
      errors: loaded.issues ?? [],
      warnings: []
    };
  }

  return buildValidationResult(loaded.config, cwd);
}

export function runConfigPreflight(
  cwd: string,
  command: string = "run"
): CommandError | ValidationResult | null {
  const validation = validateProject(cwd);

  if (isCommandError(validation)) {
    return validation;
  }

  if (validation.valid) {
    return null;
  }

  const mappedError = mapValidationToCommandError(validation, command);
  if (mappedError) {
    return mappedError;
  }

  return validation;
}

function buildValidationResult(config: OracleConfig, cwd: string): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  validateEcosystem(config, errors);
  validateCommandField(config.test_command, "test_command", cwd, errors);
  validateCommandField(config.coverage_command, "coverage_command", cwd, errors);
  validateStaticChecks(config.static_checks ?? [], cwd, errors);
  validatePattern(config.test_pattern, "test_pattern", cwd, errors);
  validateSourcePatterns(config.source_patterns, cwd, errors);
  warnings.push(...collectDeletedMapWarnings(cwd));
  warnings.push(...collectFrameworkConfigDriftWarnings(cwd));
  warnings.push(...collectMissingMapEntriesWarnings(config, cwd));

  return {
    command: "validate",
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function validateEcosystem(config: OracleConfig, errors: ValidationIssue[]): void {
  if (!SUPPORTED_ADAPTERS.includes(config.ecosystem as (typeof SUPPORTED_ADAPTERS)[number])) {
    errors.push({
      field: "ecosystem",
      message: "No adapter for: " + config.ecosystem
    });
  }
}

function validateCommandField(
  invocation: string,
  field: string,
  cwd: string,
  errors: ValidationIssue[]
): void {
  const commandName = commandNameFromInvocation(invocation);
  if (!commandName) {
    errors.push({
      field,
      message: "Command is empty."
    });
    return;
  }

  if (!isCommandResolvable(commandName, cwd)) {
    errors.push({
      field,
      message: commandName + " not resolvable"
    });
  }
}

function validateStaticChecks(
  staticChecks: string[],
  cwd: string,
  errors: ValidationIssue[]
): void {
  staticChecks.forEach((check, index) => {
    const commandName = commandNameFromInvocation(check);
    if (!commandName) {
      errors.push({
        field: "static_checks[" + index + "]",
        message: "Command is empty."
      });
      return;
    }

    if (!isCommandResolvable(commandName, cwd)) {
      errors.push({
        field: "static_checks[" + index + "]",
        message: commandName + " not resolvable"
      });
    }
  });
}

function validatePattern(pattern: string, field: string, cwd: string, errors: ValidationIssue[]): void {
  const matches = fg.sync([pattern], {
    cwd,
    onlyFiles: true,
    dot: true,
    ignore: ["**/node_modules/**", "**/.git/**"]
  });

  if (matches.length === 0) {
    errors.push({
      field,
      message: "Pattern matches 0 files"
    });
  }
}

function validateSourcePatterns(patterns: string[], cwd: string, errors: ValidationIssue[]): void {
  const matches = fg.sync(patterns, {
    cwd,
    onlyFiles: true,
    dot: true,
    ignore: ["**/node_modules/**", "**/.git/**"]
  });

  if (matches.length === 0) {
    errors.push({
      field: "source_patterns",
      message: "Patterns match 0 files"
    });
  }
}

function collectDeletedMapWarnings(cwd: string): ValidationIssue[] {
  const mapPath = path.join(cwd, ".test-oracle", "map.db");
  if (!fs.existsSync(mapPath)) {
    return [];
  }

  let sourcePaths: string[];
  try {
    sourcePaths = readDistinctSourcePaths(mapPath);
  } catch (error) {
    return [
      {
        field: "map",
        message: "Unable to inspect map.db: " + asErrorMessage(error)
      }
    ];
  }

  let missingCount = 0;
  for (const sourcePath of sourcePaths) {
    const absolutePath = path.isAbsolute(sourcePath)
      ? sourcePath
      : path.resolve(cwd, sourcePath);
    if (!fs.existsSync(absolutePath)) {
      missingCount += 1;
    }
  }

  if (missingCount > 0) {
    return [
      {
        field: "map",
        message: String(missingCount) + " entries reference deleted files"
      }
    ];
  }

  return [];
}

function collectFrameworkConfigDriftWarnings(cwd: string): ValidationIssue[] {
  const mapPath = path.join(cwd, ".test-oracle", "map.db");
  if (!fs.existsSync(mapPath)) {
    return [];
  }

  const storedFingerprint = readMapMetaValue(mapPath, FRAMEWORK_CONFIG_FINGERPRINT_KEY);
  if (!storedFingerprint) {
    return [];
  }

  const currentSnapshot = computeFrameworkConfigSnapshot(cwd);
  if (currentSnapshot.fingerprint === storedFingerprint) {
    return [];
  }

  const storedFiles = parseStoredFiles(
    readMapMetaValue(mapPath, FRAMEWORK_CONFIG_FILES_KEY)
  );
  const currentSample = currentSnapshot.files.slice(0, 3).join(", ") || "none";
  const storedSample = storedFiles.slice(0, 3).join(", ") || "none";

  return [
    {
      field: "framework_config",
      message:
        "Framework config files changed since last `test-oracle init` (current: " +
        currentSample +
        "; stored: " +
        storedSample +
        "). Run `test-oracle init` to rebuild the map."
    }
  ];
}

function collectMissingMapEntriesWarnings(
  config: OracleConfig,
  cwd: string
): ValidationIssue[] {
  const mapPath = path.join(cwd, ".test-oracle", "map.db");
  if (!fs.existsSync(mapPath)) {
    return [];
  }

  let mapSources: string[];
  try {
    mapSources = readDistinctSourcePaths(mapPath);
  } catch {
    return [];
  }

  if (mapSources.length === 0) {
    return [];
  }

  const sourceMatches = fg
    .sync(config.source_patterns, {
      cwd,
      onlyFiles: true,
      dot: true,
      ignore: ["**/node_modules/**", "**/.git/**"]
    })
    .map((file) => normalizeSlashes(file));

  const mapSet = new Set(mapSources);
  const missing = sourceMatches.filter((file) => !mapSet.has(file));

  if (missing.length === 0) {
    return [];
  }

  const sample = missing.slice(0, 3).join(", ");
  const plural = missing.length === 1 ? "file" : "files";
  return [
    {
      field: "map",
      message:
        String(missing.length) +
        " source " +
        plural +
        " from source_patterns have no map entries (example: " +
        sample +
        ")."
    }
  ];
}

function readDistinctSourcePaths(mapPath: string): string[] {
  const output = execFileSync(
    "sqlite3",
    [mapPath, "SELECT DISTINCT source_path FROM file_tests;"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );

  return output
    .split("\n")
    .map((line) => normalizeSlashes(line.trim()))
    .filter((line) => line.length > 0);
}

function readMapMetaValue(mapPath: string, key: string): string | null {
  try {
    const output = execFileSync(
      "sqlite3",
      [mapPath, `SELECT value FROM map_meta WHERE key = '${key}';`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    )
      .trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function parseStoredFiles(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === "string" ? item : ""))
        .map((item) => normalizeSlashes(item))
        .filter((item) => item.length > 0);
    }
  } catch {
    // ignore parse errors
  }

  return [];
}

function mapValidationToCommandError(
  result: ValidationResult,
  command: string
): CommandError | null {
  const ecosystemError = result.errors.find((issue) => issue.field === "ecosystem");
  if (ecosystemError && ecosystemError.message.startsWith("No adapter for: ")) {
    const ecosystem = ecosystemError.message.replace("No adapter for: ", "").trim();
    return unknownEcosystemError(ecosystem, command);
  }

  const commandError = result.errors.find((issue) => issue.message.endsWith(" not resolvable"));
  if (commandError) {
    const commandName = commandError.message.slice(
      0,
      commandError.message.length - " not resolvable".length
    );
    return commandNotFoundError(commandName, command);
  }

  return null;
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
