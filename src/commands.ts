import {
  CommandOutput,
  HelpResult,
  InitResult,
  ResetResult,
  StatusResult
} from "./contracts";
import { executeInit, executeReset, executeStatus } from "./operations";
import { executeRun } from "./run";
import { validateProject } from "./validate";

export const CLI_NAME = "test-oracle";
export const CLI_VERSION = "0.5.0";

export function runCommand(files: string[], cwd: string = process.cwd()): CommandOutput {
  return executeRun(files, cwd);
}

export function initCommand(cwd: string = process.cwd()): CommandOutput {
  return executeInit(cwd);
}

export function statusCommand(cwd: string = process.cwd()): StatusResult {
  return executeStatus(cwd);
}

export function validateCommand(cwd: string = process.cwd()): CommandOutput {
  return validateProject(cwd);
}

export function resetCommand(cwd: string = process.cwd()): ResetResult {
  return executeReset(cwd);
}

export function helpCommand(): HelpResult {
  return {
    command: "help",
    name: CLI_NAME,
    version: CLI_VERSION,
    commands: [
      {
        name: "init",
        usage: "test-oracle init",
        description: "Run full suite with coverage to build initial dependency map."
      },
      {
        name: "run",
        usage: "test-oracle run [--files <path1> <path2> ...]",
        description: "Run optimized pipeline using changed-file detection or explicit files."
      },
      {
        name: "status",
        usage: "test-oracle status",
        description: "Report map freshness, cache state, and config validity."
      },
      {
        name: "validate",
        usage: "test-oracle validate",
        description: "Validate current configuration and map references."
      },
      {
        name: "reset",
        usage: "test-oracle reset",
        description: "Clear map and cache state and force fresh initialization."
      }
    ]
  };
}
