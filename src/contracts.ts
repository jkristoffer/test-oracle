export type CommandName = "init" | "run" | "status" | "validate" | "reset" | "help";

export type PipelineStage =
  | "detect"
  | "map"
  | "cache"
  | "static"
  | "execute"
  | "result";

export type RunStatus = "pass" | "fail" | "skip";
export type RunSource = "run" | "cache";
export type RunSkipReason = "no_changes" | "no_tests_mapped";

export interface RunResult {
  command: "run";
  status: RunStatus;
  stage: PipelineStage;
  source: RunSource;
  check?: string;
  hash: string | null;
  tests_run: string[];
  tests_skipped: number;
  failed_test: string | null;
  error: string | null;
  duration_ms: number;
  map_updated: boolean;
  static_checks_passed: boolean;
  reason?: RunSkipReason;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  command: "validate";
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export type SupportedEcosystem = "node" | "python" | "rust" | "go";

export interface OracleConfig {
  ecosystem: SupportedEcosystem | string;
  test_command: string;
  coverage_command: string;
  test_pattern: string;
  source_patterns: string[];
  static_checks?: string[];
  fail_fast?: boolean;
  cache_ttl_days?: number;
  coverage_format?: string;
  convention_map?: {
    pattern: string;
  };
  notes?: string;
  module_boundaries?: unknown[];
}

export interface StatusResult {
  command: "status";
  implemented: boolean;
  map: {
    last_updated: string | null;
    entries: number;
    fresh: boolean | null;
  };
  cache: {
    entries: number;
    hit_rate: number | null;
  };
  config: {
    state: "pending" | "valid" | "invalid";
    valid: boolean | null;
    errors: number;
  };
}

export interface InitResult {
  command: "init";
  implemented: boolean;
  status: "pass" | "fail";
  message: string;
  map: {
    path: string;
    entries: number;
    updated: boolean;
    last_full_run: string | null;
  };
  state: {
    baseline: string | null;
    updated: boolean;
  };
  duration_ms: number;
  error: string | null;
}

export interface ResetResult {
  command: "reset";
  implemented: boolean;
  status: "pass" | "partial";
  cleared: {
    map: boolean;
    cache: boolean;
    state: boolean;
  };
  message: string;
}

export interface HelpResult {
  command: "help";
  name: string;
  version: string;
  commands: Array<{
    name: Exclude<CommandName, "help">;
    usage: string;
    description: string;
  }>;
}

export interface CommandError {
  kind: "error";
  error:
    | "invalid_command"
    | "invalid_args"
    | "internal_error"
    | "not_implemented"
    | "no_config"
    | "no_map"
    | "unknown_ecosystem"
    | "command_not_found"
    | "coverage_parse_error";
  message: string;
  command?: string;
  details?: Record<string, unknown>;
}

export type CommandOutput =
  | RunResult
  | ValidationResult
  | StatusResult
  | InitResult
  | ResetResult
  | HelpResult
  | CommandError;
