#!/usr/bin/env node

import { parseArgs } from "./args";
import {
  helpCommand,
  initCommand,
  resetCommand,
  runCommand,
  statusCommand,
  validateCommand
} from "./commands";
import { CommandOutput } from "./contracts";
import {
  exitCodeFor,
  internalError,
  invalidArgsError,
  invalidCommandError,
  writeOutput
} from "./output";

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);

  if (!parsed.ok) {
    const output =
      parsed.code === "invalid_command"
        ? invalidCommandError(parsed.command ?? "unknown")
        : invalidArgsError(parsed.error, parsed.command, parsed.details);
    writeOutput(output);
    return exitCodeFor(output);
  }

  let output: CommandOutput;

  switch (parsed.command) {
    case "help":
      output = helpCommand();
      break;
    case "init":
      output = initCommand();
      break;
    case "run":
      output = runCommand(parsed.files ?? [], process.cwd());
      break;
    case "status":
      output = statusCommand();
      break;
    case "validate":
      output = validateCommand(process.cwd());
      break;
    case "reset":
      output = resetCommand();
      break;
  }

  writeOutput(output);
  return exitCodeFor(output);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const output = internalError(error);
    writeOutput(output);
    process.exitCode = 1;
  });
