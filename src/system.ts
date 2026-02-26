import fs from "node:fs";
import path from "node:path";

export interface ParsedInvocation {
  command: string;
  args: string[];
}

export function commandNameFromInvocation(invocation: string): string | null {
  const parsed = parseCommandInvocation(invocation);
  if (!parsed) {
    return null;
  }

  return parsed.command;
}

export function parseCommandInvocation(invocation: string): ParsedInvocation | null {
  const tokens = tokenizeCommand(invocation);
  if (tokens.length === 0) {
    return null;
  }

  return {
    command: tokens[0],
    args: tokens.slice(1)
  };
}

export function isCommandResolvable(commandName: string, cwd: string): boolean {
  if (commandName.trim().length === 0) {
    return false;
  }

  if (looksLikePath(commandName)) {
    const resolved = path.isAbsolute(commandName)
      ? commandName
      : path.resolve(cwd, commandName);
    return isExistingFile(resolved);
  }

  const paths = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);

  for (const candidateDir of paths) {
    const candidate = path.join(candidateDir, commandName);
    if (isExistingFile(candidate)) {
      return true;
    }
  }

  return false;
}

function looksLikePath(commandName: string): boolean {
  return commandName.includes("/") || commandName.includes("\\") || commandName.startsWith(".");
}

function isExistingFile(candidatePath: string): boolean {
  try {
    const stat = fs.statSync(candidatePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function tokenizeCommand(input: string): string[] {
  const value = input.trim();
  if (value.length === 0) {
    return [];
  }

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escapeNext = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escapeNext) {
    current += "\\";
  }

  if (quote) {
    return [];
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
