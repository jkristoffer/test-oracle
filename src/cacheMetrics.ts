import fs from "node:fs";
import path from "node:path";

export interface CacheMetrics {
  hits: number;
  misses: number;
  updated_at: string | null;
}

const METRICS_FILENAME = "cache-metrics.json";

function metricsFilePath(cwd: string): string {
  return path.join(cwd, ".test-oracle", METRICS_FILENAME);
}

function defaultMetrics(): CacheMetrics {
  return { hits: 0, misses: 0, updated_at: null };
}

export function readCacheMetrics(cwd: string): CacheMetrics {
  const filePath = metricsFilePath(cwd);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.hits === "number" &&
      typeof parsed.misses === "number"
    ) {
      return {
        hits: Math.max(0, parsed.hits),
        misses: Math.max(0, parsed.misses),
        updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : null
      };
    }
  } catch {
    // fall back to defaults
  }

  return defaultMetrics();
}

export function writeCacheMetrics(cwd: string, metrics: CacheMetrics): void {
  try {
    fs.mkdirSync(path.join(cwd, ".test-oracle"), { recursive: true });
    fs.writeFileSync(metricsFilePath(cwd), JSON.stringify(metrics));
  } catch {
    // best effort; keep runs deterministic even on failure
  }
}

export function resetCacheMetrics(cwd: string): void {
  try {
    fs.rmSync(metricsFilePath(cwd), { force: true });
  } catch {
    // ignore
  }
}

export function computeCacheHitRate(metrics: CacheMetrics): number {
  const total = metrics.hits + metrics.misses;
  if (total === 0) {
    return 0;
  }
  return metrics.hits / total;
}
