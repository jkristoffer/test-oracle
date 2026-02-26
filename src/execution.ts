import { spawnSync } from "node:child_process";
import { parseCommandInvocation, commandNameFromInvocation } from "./system";
import { OracleConfig } from "./contracts";

export interface InvocationResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const MAX_ERROR_TEXT = 4000;

export function runInvocation(
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

export function appendExtraArgs(
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

export function combineOutput(result: InvocationResult): string {
  const parts = [result.stderr.trim(), result.stdout.trim()].filter((part) => part.length > 0);
  return parts.join("\n");
}

export function summarizeError(text: string): string {
  if (text.trim().length === 0) {
    return "Command failed with no output.";
  }

  if (text.length <= MAX_ERROR_TEXT) {
    return text;
  }

  return text.slice(0, MAX_ERROR_TEXT);
}

export function shouldAttachBailFlag(commandName: string, invocation: string): boolean {
  if (commandName === "vitest" || commandName === "jest") {
    return true;
  }

  if (
    (commandName === "npm" ||
      commandName === "pnpm" ||
      commandName === "yarn" ||
      commandName === "bun") &&
    (invocation.includes("vitest") || invocation.includes("jest"))
  ) {
    return true;
  }

  return false;
}

export function buildTestExtraArgs(
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
