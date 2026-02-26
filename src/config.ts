import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { CommandError, OracleConfig, ValidationIssue } from "./contracts";
import { noConfigError } from "./output";

export const CONFIG_FILENAME = ".test-oracle.yml";
export const SUPPORTED_ADAPTERS = ["node"] as const;

type ConfigLoadSuccess = {
  ok: true;
  config: OracleConfig;
  path: string;
};

type ConfigLoadFailure = {
  ok: false;
  error?: CommandError;
  issues?: ValidationIssue[];
  path: string;
};

export type ConfigLoadResult = ConfigLoadSuccess | ConfigLoadFailure;

export function loadConfig(cwd: string): ConfigLoadResult {
  const configPath = path.join(cwd, CONFIG_FILENAME);

  if (!fs.existsSync(configPath)) {
    return {
      ok: false,
      error: noConfigError(),
      path: configPath
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          field: "config",
          message: "Unable to read config: " + asErrorMessage(error)
        }
      ],
      path: configPath
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          field: "config",
          message: "Invalid YAML: " + asErrorMessage(error)
        }
      ],
      path: configPath
    };
  }

  const validation = normalizeConfig(parsed);
  if (validation.issues.length > 0) {
    return {
      ok: false,
      issues: validation.issues,
      path: configPath
    };
  }

  return {
    ok: true,
    config: validation.config,
    path: configPath
  };
}

function normalizeConfig(input: unknown): {
  config: OracleConfig;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      config: emptyConfig(),
      issues: [{ field: "config", message: "Config must be a YAML object." }]
    };
  }

  const config: OracleConfig = {
    ecosystem: readString(input, "ecosystem", issues),
    test_command: readString(input, "test_command", issues),
    coverage_command: readString(input, "coverage_command", issues),
    test_pattern: readString(input, "test_pattern", issues),
    source_patterns: readStringArray(input, "source_patterns", issues),
    static_checks: readOptionalStringArray(input, "static_checks", issues),
    fail_fast: readOptionalBoolean(input, "fail_fast", issues),
    cache_ttl_days: readOptionalNumber(input, "cache_ttl_days", issues),
    coverage_format: readOptionalString(input, "coverage_format", issues),
    convention_map: readOptionalConventionMap(input, issues),
    notes: readOptionalString(input, "notes", issues),
    module_boundaries: readOptionalArray(input, "module_boundaries", issues)
  };

  return {
    config,
    issues
  };
}

function readString(
  value: Record<string, unknown>,
  field: keyof OracleConfig,
  issues: ValidationIssue[]
): string {
  const raw = value[field];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    issues.push({
      field: String(field),
      message: "Field is required and must be a non-empty string."
    });
    return "";
  }
  return raw;
}

function readStringArray(
  value: Record<string, unknown>,
  field: keyof OracleConfig,
  issues: ValidationIssue[]
): string[] {
  const raw = value[field];
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.push({
      field: String(field),
      message: "Field is required and must be a non-empty array of strings."
    });
    return [];
  }

  const invalidEntry = raw.find((item) => typeof item !== "string" || item.trim().length === 0);
  if (invalidEntry !== undefined) {
    issues.push({
      field: String(field),
      message: "Field must contain only non-empty strings."
    });
    return [];
  }

  return raw as string[];
}

function readOptionalString(
  value: Record<string, unknown>,
  field: keyof OracleConfig,
  issues: ValidationIssue[]
): string | undefined {
  const raw = value[field];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string") {
    issues.push({ field: String(field), message: "Field must be a string when provided." });
    return undefined;
  }
  return raw;
}

function readOptionalBoolean(
  value: Record<string, unknown>,
  field: keyof OracleConfig,
  issues: ValidationIssue[]
): boolean | undefined {
  const raw = value[field];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "boolean") {
    issues.push({ field: String(field), message: "Field must be a boolean when provided." });
    return undefined;
  }
  return raw;
}

function readOptionalNumber(
  value: Record<string, unknown>,
  field: keyof OracleConfig,
  issues: ValidationIssue[]
): number | undefined {
  const raw = value[field];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "number" || Number.isNaN(raw)) {
    issues.push({ field: String(field), message: "Field must be a number when provided." });
    return undefined;
  }
  return raw;
}

function readOptionalStringArray(
  value: Record<string, unknown>,
  field: keyof OracleConfig,
  issues: ValidationIssue[]
): string[] | undefined {
  const raw = value[field];
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    issues.push({ field: String(field), message: "Field must be an array of strings." });
    return undefined;
  }

  const invalidEntry = raw.find((item) => typeof item !== "string" || item.trim().length === 0);
  if (invalidEntry !== undefined) {
    issues.push({ field: String(field), message: "Field must contain only non-empty strings." });
    return undefined;
  }

  return raw as string[];
}

function readOptionalArray(
  value: Record<string, unknown>,
  field: keyof OracleConfig,
  issues: ValidationIssue[]
): unknown[] | undefined {
  const raw = value[field];
  if (raw === undefined) {
    return undefined;
  }

  if (!Array.isArray(raw)) {
    issues.push({ field: String(field), message: "Field must be an array when provided." });
    return undefined;
  }

  return raw;
}

function readOptionalConventionMap(
  value: Record<string, unknown>,
  issues: ValidationIssue[]
): { pattern: string } | undefined {
  const raw = value.convention_map;
  if (raw === undefined) {
    return undefined;
  }

  if (!isRecord(raw)) {
    issues.push({
      field: "convention_map",
      message: "Field must be an object with a string `pattern` key."
    });
    return undefined;
  }

  const pattern = raw.pattern;
  if (typeof pattern !== "string" || pattern.trim().length === 0) {
    issues.push({
      field: "convention_map.pattern",
      message: "Field must be a non-empty string when convention_map is provided."
    });
    return undefined;
  }

  return { pattern };
}

function emptyConfig(): OracleConfig {
  return {
    ecosystem: "",
    test_command: "",
    coverage_command: "",
    test_pattern: "",
    source_patterns: []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
