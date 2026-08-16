/**
 * Global configuration (~/.agent-memory/config.json).
 *
 * Missing keys fall back to safe defaults; unknown keys are ignored. The
 * config file is created on first use so users can discover and edit it.
 */
import { DEFAULT_CONFIG, type MemoryConfig } from "./types.js";
import { getConfigPath, getMemoryRoot } from "./storage/paths.js";
import { readJsonOrNull, writeJsonAtomic } from "./storage/fsutil.js";

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Merge a partial user config over the defaults, sanitizing values. */
export function normalizeConfig(partial: unknown): MemoryConfig {
  const p = (partial ?? {}) as Record<string, any>;
  return {
    storage: { type: "filesystem" },
    memory: {
      maxContextItems: clampInt(
        p?.memory?.maxContextItems,
        DEFAULT_CONFIG.memory.maxContextItems,
        1,
        200,
      ),
      enableRawSessions:
        typeof p?.memory?.enableRawSessions === "boolean"
          ? p.memory.enableRawSessions
          : DEFAULT_CONFIG.memory.enableRawSessions,
    },
    search: {
      maxResults: clampInt(
        p?.search?.maxResults,
        DEFAULT_CONFIG.search.maxResults,
        1,
        200,
      ),
    },
  };
}

export interface LoadedConfig {
  config: MemoryConfig;
  configPath: string;
  created: boolean;
}

/**
 * Load (and lazily create) the global config.
 */
export async function loadConfig(root?: string): Promise<LoadedConfig> {
  const memoryRoot = root ?? getMemoryRoot();
  const configPath = getConfigPath(memoryRoot);
  const existing = await readJsonOrNull<unknown>(configPath);
  if (existing === null) {
    await writeJsonAtomic(configPath, DEFAULT_CONFIG);
    return { config: { ...DEFAULT_CONFIG }, configPath, created: true };
  }
  return { config: normalizeConfig(existing), configPath, created: false };
}
