import { CommandName } from "./contracts";

export type ParsedArgs =
  | {
      ok: true;
      command: "help";
    }
  | {
      ok: true;
      command: Exclude<CommandName, "help">;
      files?: string[];
    }
  | {
      ok: false;
      code: "invalid_command" | "invalid_args";
      error: string;
      command?: string;
      details?: Record<string, unknown>;
    };

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    return { ok: true, command: "help" };
  }

  const [commandToken, ...rest] = argv;

  if (commandToken === "help" || commandToken === "-h" || commandToken === "--help") {
    return { ok: true, command: "help" };
  }

  if (commandToken === "run") {
    return parseRunArgs(rest);
  }

  if (
    commandToken === "init" ||
    commandToken === "status" ||
    commandToken === "validate" ||
    commandToken === "reset"
  ) {
    if (rest.length > 0) {
      return {
        ok: false,
        code: "invalid_args",
        error: "`" + commandToken + "` does not accept positional arguments.",
        command: commandToken,
        details: { args: rest }
      };
    }

    return { ok: true, command: commandToken };
  }

  return {
    ok: false,
    code: "invalid_command",
    error: "Unknown command.",
    command: commandToken,
    details: { allowed: ["init", "run", "status", "validate", "reset", "help"] }
  };
}

function parseRunArgs(argv: string[]): ParsedArgs {
  const files: string[] = [];
  let i = 0;

  while (i < argv.length) {
    const token = argv[i];

    if (token !== "--files") {
      return {
        ok: false,
        code: "invalid_args",
        error: "Unsupported argument for `run`.",
        command: "run",
        details: { argument: token }
      };
    }

    i += 1;

    if (i >= argv.length || argv[i].startsWith("--")) {
      return {
        ok: false,
        code: "invalid_args",
        error: "`--files` requires at least one path.",
        command: "run"
      };
    }

    while (i < argv.length && !argv[i].startsWith("--")) {
      files.push(argv[i]);
      i += 1;
    }
  }

  return {
    ok: true,
    command: "run",
    files
  };
}
