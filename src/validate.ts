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

  try {
    const output = execFileSync(
      "sqlite3",
      [mapPath, "SELECT DISTINCT source_path FROM file_tests;"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );

    const sourcePaths = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

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
  } catch (error) {
    return [
      {
        field: "map",
        message: "Unable to inspect map.db: " + asErrorMessage(error)
      }
    ];
  }
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
