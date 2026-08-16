/**
 * Storage path resolution.
 *
 * All memory lives under a single user-level root directory:
 *
 *   Windows:  C:\Users\<username>\.agent-memory\
 *   POSIX:    ~/.agent-memory/
 *
 * The root is resolved from the OS home directory at call time (never
 * hardcoded). The environment variable AGENT_MEMORY_HOME overrides the root;
 * this is used by tests and lets power users relocate storage.
 */
import os from "node:os";
import path from "node:path";

export const ENV_MEMORY_HOME = "AGENT_MEMORY_HOME";
export const ENV_WORKSPACE = "AGENT_MEMORY_WORKSPACE";

/** Resolve the memory root directory for the current user. */
export function getMemoryRoot(): string {
  const override = process.env[ENV_MEMORY_HOME];
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim());
  }
  return path.join(os.homedir(), ".agent-memory");
}

export function getConfigPath(root: string = getMemoryRoot()): string {
  return path.join(root, "config.json");
}

export function getProjectsDir(root: string = getMemoryRoot()): string {
  return path.join(root, "projects");
}

export function getAgentsDir(root: string = getMemoryRoot()): string {
  return path.join(root, "agents");
}

export function getProjectDir(
  projectId: string,
  root: string = getMemoryRoot(),
): string {
  return path.join(getProjectsDir(root), sanitizeSegment(projectId));
}

export function getProjectFile(
  projectId: string,
  root: string = getMemoryRoot(),
): string {
  return path.join(getProjectDir(projectId, root), "project.json");
}

export function getContextFile(
  projectId: string,
  root: string = getMemoryRoot(),
): string {
  return path.join(getProjectDir(projectId, root), "context.json");
}

export function getTasksFile(
  projectId: string,
  root: string = getMemoryRoot(),
): string {
  return path.join(getProjectDir(projectId, root), "tasks.json");
}

export function getDecisionsFile(
  projectId: string,
  root: string = getMemoryRoot(),
): string {
  return path.join(getProjectDir(projectId, root), "decisions.json");
}

export function getMemoriesFile(
  projectId: string,
  root: string = getMemoryRoot(),
): string {
  return path.join(getProjectDir(projectId, root), "memories.jsonl");
}

export function getSessionsDir(
  projectId: string,
  root: string = getMemoryRoot(),
): string {
  return path.join(getProjectDir(projectId, root), "sessions");
}

export function getSessionFile(
  projectId: string,
  sessionId: string,
  root: string = getMemoryRoot(),
): string {
  return path.join(
    getSessionsDir(projectId, root),
    `${sanitizeSegment(sessionId)}.json`,
  );
}

export function getHandoffsDir(
  projectId: string,
  root: string = getMemoryRoot(),
): string {
  return path.join(getProjectDir(projectId, root), "handoffs");
}

export function getLatestHandoffFile(
  projectId: string,
  root: string = getMemoryRoot(),
): string {
  return path.join(getHandoffsDir(projectId, root), "latest.json");
}

export function getHandoffHistoryDir(
  projectId: string,
  root: string = getMemoryRoot(),
): string {
  return path.join(getHandoffsDir(projectId, root), "history");
}

export function getProjectLockFile(
  projectId: string,
  root: string = getMemoryRoot(),
): string {
  return path.join(getProjectDir(projectId, root), ".lock");
}

/** Make a string safe to use as a single path segment. */
export function sanitizeSegment(segment: string): string {
  return (
    segment.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120) || "_"
  );
}

/**
 * Resolve the workspace directory the agent is working in.
 * Priority: explicit argument > AGENT_MEMORY_WORKSPACE > process.cwd().
 */
export function resolveWorkspacePath(explicit?: string): string {
  const candidate =
    explicit && explicit.trim()
      ? explicit.trim()
      : process.env[ENV_WORKSPACE] || process.cwd();
  return path.resolve(candidate);
}
