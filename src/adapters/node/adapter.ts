import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { OracleConfig } from "../../contracts";
import { CoverageEdge, TestAdapter } from "../types";
import { AdapterError } from "../errors";
import {
  buildTestExtraArgs,
  combineOutput,
  runInvocation,
  summarizeError
} from "../../execution";
import { normalizeRelativePath, normalizeSlashes } from "../../utils/paths";

const DEFAULT_CONVENTION_PATTERN = "{name}.test.{ext}";
const COVERAGE_CANDIDATES = [
  (cwd: string) => path.join(cwd, "coverage", "coverage-final.json"),
  (cwd: string) => path.join(cwd, "coverage-final.json"),
  (cwd: string) => path.join(cwd, ".nyc_output", "out.json")
];
const MAP_IGNORE = ["**/node_modules/**", "**/.git/**"];

export const nodeAdapter: TestAdapter = {
  ecosystem: "node",

  generateMap(config, cwd) {
    const availableTests = fg
      .sync([config.test_pattern], {
        cwd,
        onlyFiles: true,
        dot: true,
        ignore: MAP_IGNORE
      })
      .map((file) => normalizeSlashes(file))
      .sort();

    if (availableTests.length === 0) {
      throw new AdapterError("test_pattern did not resolve test files during init.");
    }

    const edges = buildInitEdges(availableTests, config, cwd);
    if (edges.length === 0) {
      throw new AdapterError("Unable to derive source-to-test mappings from coverage output.");
    }

    return edges;
  },

  queryMap(mapPath, changedSources, config, cwd) {
    const rows = readMapRows(mapPath);
    const bySource = new Map<string, Set<string>>();

    for (const row of rows) {
      const source = normalizeRelativePath(cwd, row.sourcePath);
      if (!bySource.has(source)) {
        bySource.set(source, new Set());
      }
      bySource.get(source)?.add(row.testId);
    }

    const mapped = new Set<string>();
    const unresolved = new Set<string>();

    for (const sourcePath of changedSources) {
      const directMatches = bySource.get(sourcePath);
      if (directMatches && directMatches.size > 0) {
        for (const testId of directMatches) {
          mapped.add(normalizeSlashes(testId));
        }
        continue;
      }

      unresolved.add(sourcePath);
    }

    const fallbackPattern = config.convention_map?.pattern || DEFAULT_CONVENTION_PATTERN;
    for (const sourcePath of unresolved) {
      const fallback = resolveConventionFallback(sourcePath, fallbackPattern, cwd);
      if (fallback) {
        mapped.add(fallback);
      }
    }

    return Array.from(mapped.values()).sort();
  },

  runTests(testIds, config, cwd) {
    const extraArgs = buildTestExtraArgs(config.test_command, config, testIds);
    return runInvocation(config.test_command, cwd, extraArgs, true);
  },

  parseCoverage(coveragePath, config, cwd) {
    return extractCoveredSources(coveragePath, cwd, config);
  },

  refreshMapFromCoverage(mapPath, mappedTests, config, cwd) {
    const edges = collectCoverageEdgesForTests(config, cwd, mappedTests);
    if (!edges || edges.length === 0) {
      return false;
    }

    return upsertCoverageMappings(mapPath, edges);
  }
};

function buildInitEdges(
  availableTests: string[],
  config: OracleConfig,
  cwd: string
): CoverageEdge[] {
  const normalizedTests = Array.from(new Set(availableTests.map((test) => normalizeSlashes(test)))).sort();
  const dedup = new Set<string>();
  const edges: CoverageEdge[] = [];

  for (const testId of normalizedTests) {
    let coverageSources: string[];
    try {
      coverageSources = collectCoverageSourcesForTest(config, cwd, testId);
    } catch (error) {
      if (error instanceof AdapterError) {
        throw error;
      }
      throw new AdapterError("Failed to collect coverage for: " + testId);
    }

    for (const source of coverageSources) {
      if (source.length === 0) {
        continue;
      }
      const normalizedSource = normalizeSlashes(source);
      const key = normalizedSource + "\n" + testId;
      if (dedup.has(key)) {
        continue;
      }
      dedup.add(key);
      edges.push({ source: normalizedSource, testId });
    }
  }

  return edges;
}

function collectCoverageEdgesForTests(
  config: OracleConfig,
  cwd: string,
  mappedTests: string[]
): CoverageEdge[] | null {
  const normalizedTests = Array.from(new Set(mappedTests.map((test) => normalizeSlashes(test)))).sort();
  const edges: CoverageEdge[] = [];

  for (const testId of normalizedTests) {
    let coverageSources: string[];
    try {
      coverageSources = collectCoverageSourcesForTest(config, cwd, testId);
    } catch {
      return null;
    }

    for (const source of coverageSources) {
      if (source.length === 0) {
        continue;
      }
      edges.push({ source: normalizeSlashes(source), testId });
    }
  }

  return edges;
}

function collectCoverageSourcesForTest(config: OracleConfig, cwd: string, testId: string): string[] {
  cleanCoverageArtifacts(cwd);
  const coverageRun = runInvocation(config.coverage_command, cwd, [testId], true);
  if (coverageRun.exitCode !== 0) {
    const message = summarizeError(combineOutput(coverageRun));
    throw new AdapterError(`Coverage run failed for ${testId}: ${message}`);
  }

  const coveragePath = findCoveragePath(cwd);
  if (!coveragePath) {
    throw new AdapterError(
      "Coverage output not found. Expected coverage-final.json artifact after running coverage."
    );
  }

  return extractCoveredSources(coveragePath, cwd, config);
}

function cleanCoverageArtifacts(cwd: string): void {
  const targets = [
    path.join(cwd, "coverage"),
    path.join(cwd, "coverage-final.json"),
    path.join(cwd, ".nyc_output")
  ];

  for (const target of targets) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

function findCoveragePath(cwd: string): string | null {
  for (const candidate of COVERAGE_CANDIDATES) {
    const resolved = candidate(cwd);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }
  return null;
}

function extractCoveredSources(coveragePath: string, cwd: string, config: OracleConfig): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(coveragePath, "utf8"));
  } catch {
    return [];
  }

  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }

  const knownSources = new Set(
    fg
      .sync(config.source_patterns, {
        cwd,
        onlyFiles: true,
        dot: true,
        ignore: MAP_IGNORE
      })
      .map((file) => normalizeSlashes(file))
  );

  const covered = new Set<string>();
  for (const key of Object.keys(parsed)) {
    const normalized = normalizeRelativePath(cwd, key);
    if (normalized.startsWith("../")) {
      continue;
    }
    if (knownSources.has(normalized)) {
      covered.add(normalized);
    }
  }

  return Array.from(covered.values()).sort();
}

function readMapRows(mapPath: string): Array<{ sourcePath: string; testId: string }> {
  try {
    const output = execFileSync("sqlite3", [mapPath, "SELECT source_path, test_id FROM file_tests;"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const dividerIndex = line.indexOf("|");
        if (dividerIndex === -1) {
          return {
            sourcePath: line,
            testId: ""
          };
        }

        return {
          sourcePath: line.slice(0, dividerIndex),
          testId: line.slice(dividerIndex + 1)
        };
      })
      .filter((row) => row.testId.length > 0);
  } catch {
    return [];
  }
}

function resolveConventionFallback(sourcePath: string, pattern: string, cwd: string): string | null {
  const parsed = path.parse(sourcePath);
  const extWithoutDot = parsed.ext.startsWith(".") ? parsed.ext.slice(1) : parsed.ext;
  const filename = pattern
    .replaceAll("{name}", parsed.name)
    .replaceAll("{ext}", extWithoutDot);
  const candidate = normalizeSlashes(path.join(parsed.dir, filename));
  const absoluteCandidate = path.resolve(cwd, candidate);
  if (fs.existsSync(absoluteCandidate)) {
    return candidate;
  }

  return null;
}

function upsertCoverageMappings(mapPath: string, edges: CoverageEdge[]): boolean {
  if (edges.length === 0) {
    return false;
  }

  const grouped = new Map<string, Set<string>>();
  for (const edge of edges) {
    const tests = grouped.get(edge.source) ?? new Set<string>();
    tests.add(normalizeSlashes(edge.testId));
    grouped.set(edge.source, tests);
  }

  const sources = Array.from(grouped.keys()).sort();
  const now = Math.floor(Date.now() / 1000);
  const sql: string[] = [];
  sql.push("BEGIN TRANSACTION;");
  sql.push(
    "CREATE TABLE IF NOT EXISTS file_tests (source_path TEXT NOT NULL, test_id TEXT NOT NULL, last_updated INTEGER NOT NULL, PRIMARY KEY (source_path, test_id));"
  );

  for (const source of sources) {
    sql.push("DELETE FROM file_tests WHERE source_path = '" + escapeSql(source) + "';");
  }

  for (const source of sources) {
    const tests = Array.from(grouped.get(source) ?? []).sort();
    for (const testId of tests) {
      sql.push(
        "INSERT INTO file_tests (source_path, test_id, last_updated) VALUES ('" +
          escapeSql(source) +
          "', '" +
          escapeSql(testId) +
          "', " +
          String(now) +
          ") ON CONFLICT(source_path, test_id) DO UPDATE SET last_updated = excluded.last_updated;"
      );
    }
  }

  sql.push("COMMIT;");

  try {
    execFileSync("sqlite3", [mapPath, sql.join("\n")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return true;
  } catch {
    return false;
  }
}

function escapeSql(value: string): string {
  return value.replaceAll("'", "''");
}
