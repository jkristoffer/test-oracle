import fs from "node:fs";
import path from "node:path";

export function normalizeSlashes(value: string): string {
  return value.replaceAll("\\", "/");
}

export function safeRealpath(targetPath: string): string | null {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return null;
  }
}

export function normalizeRelativePath(cwd: string, filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  const cwdReal = safeRealpath(cwd) ?? cwd;
  const absoluteReal = safeRealpath(absolutePath) ?? absolutePath;

  const candidates = [
    path.relative(cwd, absolutePath),
    path.relative(cwdReal, absoluteReal),
    path.relative(cwdReal, absolutePath),
    path.relative(cwd, absoluteReal)
  ].filter((candidate) => candidate.length > 0);

  const preferred =
    candidates.find((candidate) => !candidate.startsWith("..")) ??
    candidates[0] ??
    path.basename(absolutePath);

  return normalizeSlashes(preferred);
}
