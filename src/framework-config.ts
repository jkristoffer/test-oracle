import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { normalizeSlashes } from "./path-utils";

export interface FrameworkConfigSnapshot {
  fingerprint: string;
  files: string[];
}

export const FRAMEWORK_CONFIG_FINGERPRINT_KEY = "framework_config_fingerprint";
export const FRAMEWORK_CONFIG_FILES_KEY = "framework_config_files";

const FRAMEWORK_CONFIG_PATTERNS = [
  "vitest.config.*",
  "jest.config.*",
  "playwright.config.*",
  "cypress.config.*",
  "pytest.ini",
  "pyproject.toml",
  "setup.cfg",
  "tox.ini",
  "Cargo.toml",
  "rust-toolchain.toml"
];

const FRAMEWORK_CONFIG_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.test-oracle/**"
];

export function computeFrameworkConfigSnapshot(cwd: string): FrameworkConfigSnapshot {
  const matches = fg.sync(FRAMEWORK_CONFIG_PATTERNS, {
    cwd,
    onlyFiles: true,
    dot: true,
    ignore: FRAMEWORK_CONFIG_IGNORE
  });

  const files = matches.map((file) => normalizeSlashes(file)).sort();
  const hash = createHash("sha256");
  hash.update("framework-config-snapshot");

  for (const file of files) {
    const absolutePath = path.resolve(cwd, file);
    const content = safeReadText(absolutePath);
    hash.update(file);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }

  hash.update(files.join("\0"));

  return {
    fingerprint: hash.digest("hex"),
    files
  };
}

function safeReadText(targetPath: string): string {
  try {
    return fs.readFileSync(targetPath, "utf8");
  } catch {
    return "";
  }
}
