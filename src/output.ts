import {
  CommandError,
  CommandOutput,
  InitResult,
  ResetResult,
  RunResult,
  ValidationResult
} from "./contracts";

export function writeOutput(output: CommandOutput): void {
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

export function invalidCommandError(command: string): CommandError {
  return {
    kind: "error",
    error: "invalid_command",
    message: "Unknown command.",
    command
  };
}

export function invalidArgsError(
  message: string,
  command?: string,
  details?: Record<string, unknown>
): CommandError {
  return {
    kind: "error",
    error: "invalid_args",
    message,
    command,
    details
  };
}

export function internalError(error: unknown, command?: string): CommandError {
  return {
    kind: "error",
    error: "internal_error",
    message: error instanceof Error ? error.message : "Unexpected internal error.",
    command
  };
}

export function noConfigError(command?: string): CommandError {
  return {
    kind: "error",
    error: "no_config",
    message: "Run test-oracle validate to check setup",
    command
  };
}

export function noMapError(command?: string): CommandError {
  return {
    kind: "error",
    error: "no_map",
    message: "Run test-oracle init to build dependency map",
    command
  };
}

export function unknownEcosystemError(ecosystem: string, command?: string): CommandError {
  return {
    kind: "error",
    error: "unknown_ecosystem",
    message: "No adapter for: " + ecosystem,
    command
  };
}

export function commandNotFoundError(commandName: string, command?: string): CommandError {
  return {
    kind: "error",
    error: "command_not_found",
    message: commandName + " not resolvable",
    command
  };
}

export function coverageParseError(details: string, command?: string): CommandError {
  return {
    kind: "error",
    error: "coverage_parse_error",
    message: details,
    command
  };
}

export function exitCodeFor(output: CommandOutput): number {
  if (isCommandError(output)) {
    return 1;
  }

  if (isRunResult(output)) {
    return output.status === "fail" ? 1 : 0;
  }

  if (isValidationResult(output)) {
    return output.valid ? 0 : 1;
  }

  if (isInitResult(output)) {
    return output.status === "pass" ? 0 : 1;
  }

  if (isResetResult(output)) {
    return output.status === "pass" ? 0 : 1;
  }

  return 0;
}

function isCommandError(value: CommandOutput): value is CommandError {
  return "kind" in value && value.kind === "error";
}

function isRunResult(value: CommandOutput): value is RunResult {
  return value.command === "run";
}

function isValidationResult(value: CommandOutput): value is ValidationResult {
  return value.command === "validate";
}

function isInitResult(value: CommandOutput): value is InitResult {
  return value.command === "init";
}

function isResetResult(value: CommandOutput): value is ResetResult {
  return value.command === "reset";
}
