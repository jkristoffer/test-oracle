import { OracleConfig, SupportedEcosystem } from "../contracts";
import { InvocationResult } from "../execution";

export interface CoverageEdge {
  source: string;
  testId: string;
}

export interface TestAdapter {
  ecosystem: SupportedEcosystem;
  generateMap(config: OracleConfig, cwd: string): CoverageEdge[];
  queryMap(mapPath: string, changedSources: string[], config: OracleConfig, cwd: string): string[];
  runTests(testIds: string[], config: OracleConfig, cwd: string): InvocationResult;
  parseCoverage(coveragePath: string, config: OracleConfig, cwd: string): string[];
  filterSourceFiles(files: string[], config: OracleConfig, cwd: string): string[];
  detectFailedTest(output: string, mappedTests: string[]): string | null;
  refreshMapFromCoverage?(mapPath: string, mappedTests: string[], config: OracleConfig, cwd: string): boolean;
}
