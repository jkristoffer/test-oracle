import {
  CommandError,
  CommandOutput,
  RunResult,
  ValidationIssue,
  ValidationResult
} from "./contracts";

export const INIT_PROMPT_ASSET_PATH = "docs/prompts/config-init-prompt.md";
export const UPDATE_PROMPT_ASSET_PATH = "docs/prompts/config-update-prompt.md";

export type SkillDecision =
  | {
      next: "prompt_init_config";
      reason: "no_config";
      prompt_asset: string;
      commands: string[];
    }
  | {
      next: "prompt_update_config";
      reason: "invalid_config" | "config_runtime_error";
      prompt_asset: string;
      commands: string[];
    }
  | {
      next: "run_init";
      reason: "missing_map" | "stale_map";
      commands: string[];
    }
  | {
      next: "fix_static";
      reason: "static_failure";
      check: string | null;
      error: string | null;
      commands: string[];
    }
  | {
      next: "fix_test";
      reason: "execute_failure";
      failed_test: string | null;
      error: string | null;
      commands: string[];
    }
  | {
      next: "continue";
      reason:
        | "validate_ok"
        | "run_pass"
        | "run_skip_no_changes"
        | "run_skip_no_tests_mapped";
      commands: string[];
    }
  | {
      next: "inspect";
      reason: "unrecognized";
      detail: string;
      commands: string[];
    };

export function decideSkillNextStep(output: CommandOutput): SkillDecision {
  if (isCommandError(output)) {
    return decideFromError(output);
  }

  if (output.command === "validate") {
    return decideFromValidate(output);
  }

  if (output.command === "run") {
    return decideFromRun(output);
  }

  return {
    next: "inspect",
    reason: "unrecognized",
    detail: "Output command is outside v0.4 skill routing scope.",
    commands: []
  };
}

export function isDirectFrameworkTestCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  if (normalized.length === 0) {
    return false;
  }

  if (normalized === "test-oracle" || normalized.startsWith("test-oracle ")) {
    return false;
  }

  return DIRECT_TEST_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function decisionUsesOnlyOracleCommands(decision: SkillDecision): boolean {
  return decision.commands.every((command) => !isDirectFrameworkTestCommand(command));
}

function decideFromError(output: CommandError): SkillDecision {
  if (output.error === "no_config") {
    return {
      next: "prompt_init_config",
      reason: "no_config",
      prompt_asset: INIT_PROMPT_ASSET_PATH,
      commands: ["test-oracle validate", "test-oracle init"]
    };
  }

  if (output.error === "no_map") {
    return {
      next: "run_init",
      reason: "missing_map",
      commands: ["test-oracle init", "test-oracle run --files <changed-files>"]
    };
  }

  if (
    output.error === "command_not_found" ||
    output.error === "unknown_ecosystem" ||
    output.error === "coverage_parse_error"
  ) {
    return {
      next: "prompt_update_config",
      reason: "config_runtime_error",
      prompt_asset: UPDATE_PROMPT_ASSET_PATH,
      commands: ["test-oracle validate", "test-oracle run --files <changed-files>"]
    };
  }

  return {
    next: "inspect",
    reason: "unrecognized",
    detail: "Unhandled error code: " + output.error,
    commands: []
  };
}

function decideFromValidate(output: ValidationResult): SkillDecision {
  if (!output.valid) {
    return {
      next: "prompt_update_config",
      reason: "invalid_config",
      prompt_asset: UPDATE_PROMPT_ASSET_PATH,
      commands: ["test-oracle validate", "test-oracle init"]
    };
  }

  if (hasDeletedFileMapWarning(output.warnings)) {
    return {
      next: "run_init",
      reason: "stale_map",
      commands: ["test-oracle init", "test-oracle run --files <changed-files>"]
    };
  }

  return {
    next: "continue",
    reason: "validate_ok",
    commands: []
  };
}

function decideFromRun(output: RunResult): SkillDecision {
  if (output.status === "fail" && output.stage === "static") {
    return {
      next: "fix_static",
      reason: "static_failure",
      check: output.check ?? null,
      error: output.error,
      commands: ["test-oracle run --files <changed-files>"]
    };
  }

  if (output.status === "fail" && output.stage === "execute") {
    return {
      next: "fix_test",
      reason: "execute_failure",
      failed_test: output.failed_test,
      error: output.error,
      commands: ["test-oracle run --files <changed-files>"]
    };
  }

  if (output.status === "pass") {
    return {
      next: "continue",
      reason: "run_pass",
      commands: []
    };
  }

  if (output.status === "skip" && output.reason === "no_changes") {
    return {
      next: "continue",
      reason: "run_skip_no_changes",
      commands: []
    };
  }

  if (output.status === "skip" && output.reason === "no_tests_mapped") {
    return {
      next: "continue",
      reason: "run_skip_no_tests_mapped",
      commands: []
    };
  }

  return {
    next: "inspect",
    reason: "unrecognized",
    detail: "Unhandled run output shape.",
    commands: []
  };
}

function hasDeletedFileMapWarning(warnings: ValidationIssue[]): boolean {
  return warnings.some((warning) => {
    if (warning.field !== "map") {
      return false;
    }
    return warning.message.includes("entries reference deleted files");
  });
}

function normalizeCommand(command: string): string {
  return command.trim().toLowerCase().replace(/\s+/g, " ");
}

const DIRECT_TEST_COMMAND_PATTERNS = [
  /^vitest(\s|$)/,
  /^jest(\s|$)/,
  /^pytest(\s|$)/,
  /^cargo\s+test(\s|$)/,
  /^go\s+test(\s|$)/,
  /^(npm|pnpm|yarn|bun)\s+(test|run\s+test)(\s|$)/,
  /^(npm|pnpm|yarn|bun|npx)\s+(vitest|jest)(\s|$)/
];

function isCommandError(output: CommandOutput): output is CommandError {
  return "kind" in output && output.kind === "error";
}
