/**
 * Core domain types for the Memory MCP Server.
 *
 * These types are shared by the storage layer, the MCP tool layer and the
 * CLI. They intentionally stay plain-JSON serializable so any MemoryStore
 * implementation (filesystem today, SQLite/remote/vector in the future) can
 * persist them without transformation.
 */

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export const MEMORY_TYPES = [
  "requirement",
  "decision",
  "architecture",
  "task",
  "problem",
  "solution",
  "progress",
  "fact",
  "preference",
  "constraint",
  "discovery",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export function isMemoryType(value: unknown): value is MemoryType {
  return (
    typeof value === "string" &&
    (MEMORY_TYPES as readonly string[]).includes(value)
  );
}

/**
 * A single curated memory entry.
 *
 * `importance` and `confidence` are numbers in the range [0, 1].
 */
export interface Memory {
  id: string;
  projectId: string;
  type: MemoryType;
  content: string;
  /** How important this memory is for future work (0..1). */
  importance: number;
  /** How confident the recording agent was (0..1). */
  confidence: number;
  /** Free-form source hint, e.g. "user", "code-review", "debugging". */
  source?: string;
  agentId?: string;
  sessionId?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

/** Tombstone marker used inside the append-only JSONL memory log. */
export interface MemoryDeletedMarker {
  id: string;
  projectId: string;
  deleted: true;
  updatedAt: string;
}

export type MemoryLogEntry = Memory | MemoryDeletedMarker;

export function isDeletedMarker(
  entry: MemoryLogEntry,
): entry is MemoryDeletedMarker {
  return (entry as MemoryDeletedMarker).deleted === true;
}

export interface MemoryFilter {
  types?: MemoryType[];
  minImportance?: number;
  since?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export type ProjectIdentityKind = "git" | "identity-file" | "path";

export interface ProjectIdentity {
  kind: ProjectIdentityKind;
  /**
   * Canonical identifier for the project:
   * - git: normalized remote URL (e.g. "github.com/company/pms")
   * - identity-file: projectId from `.agent-memory.json`
   * - path: normalized workspace path
   */
  canonical: string;
  /** Human friendly repository/project name. */
  repoName?: string;
  /** Raw git remote URL when available. */
  remoteUrl?: string;
}

export interface Project {
  id: string;
  name: string;
  identity: ProjectIdentity;
  /** Git repository root when identity kind is "git". */
  repoRoot?: string;
  /** All local paths that have been observed for this project. */
  localPaths: string[];
  createdAt: string;
  lastActivityAt: string;
  memoryVersion: number;
}

// ---------------------------------------------------------------------------
// Project context (compact "current state")
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = [
  "unknown",
  "in_progress",
  "paused",
  "blocked",
  "completed",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface ProjectContext {
  projectId: string;
  name: string;
  technology: string[];
  currentTask?: string;
  status: ProjectStatus;
  summary?: string;
  lastAgent?: string;
  lastSession?: string;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const TASK_STATUSES = [
  "active",
  "in_progress",
  "completed",
  "blocked",
  "abandoned",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isOpenTaskStatus(status: TaskStatus): boolean {
  return (
    status === "active" || status === "in_progress" || status === "blocked"
  );
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  /** 0..1, higher = more urgent. */
  priority?: number;
  agentId?: string;
  sessionId?: string;
  relatedFiles?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface Decision {
  id: string;
  projectId: string;
  content: string;
  rationale?: string;
  alternatives?: string[];
  importance: number;
  confidence: number;
  agentId?: string;
  sessionId?: string;
  status: "active" | "superseded";
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const SESSION_STATUSES = [
  "active",
  "completed",
  "interrupted",
  "abandoned",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface Session {
  sessionId: string;
  projectId: string;
  agentId: string;
  agentName?: string;
  startedAt: string;
  endedAt?: string;
  branch?: string;
  workingDirectory?: string;
  summary?: string;
  /**
   * Compressed digest of the entire conversation of this session. Injected
   * into the next briefing so a new chat understands the previous one.
   */
  digest?: string;
  status: SessionStatus;
}

// ---------------------------------------------------------------------------
// Handoffs
// ---------------------------------------------------------------------------

export interface Handoff {
  id: string;
  projectId: string;
  sessionId?: string;
  agentId: string;
  task: string;
  completed: string[];
  remaining: string[];
  problems: string[];
  changedFiles: string[];
  nextAction: string;
  notes?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface AgentInfo {
  agentId: string;
  client?: string;
  version?: string;
  role?: string;
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export interface GitCommitInfo {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface GitInfo {
  isRepo: boolean;
  repoRoot?: string;
  remoteUrl?: string;
  branch?: string;
  headCommit?: string;
  recentCommits?: GitCommitInfo[];
  changedFiles?: string[];
  hasUncommittedChanges?: boolean;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type SearchSourceType =
  | "memory"
  | "task"
  | "decision"
  | "handoff"
  | "session"
  | "context";

export interface SearchResult {
  source: SearchSourceType;
  /** Stable id of the underlying record. */
  id: string;
  projectId: string;
  /** Short human label, e.g. memory type or task title. */
  label: string;
  /** The matched text snippet. */
  snippet: string;
  /** Relevance score in [0, 1], higher = more relevant. */
  score: number;
  createdAt?: string;
  /** The full underlying record. */
  record: unknown;
}

export interface SearchOptions {
  query: string;
  projectId?: string;
  types?: MemoryType[];
  minImportance?: number;
  limit?: number;
  includeRawSessions?: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MemoryConfig {
  storage: {
    type: "filesystem";
  };
  memory: {
    maxContextItems: number;
    enableRawSessions: boolean;
  };
  search: {
    maxResults: number;
  };
}

export const DEFAULT_CONFIG: MemoryConfig = {
  storage: { type: "filesystem" },
  memory: { maxContextItems: 20, enableRawSessions: true },
  search: { maxResults: 20 },
};

// ---------------------------------------------------------------------------
// Detection / initialization results
// ---------------------------------------------------------------------------

export interface ProjectDetection {
  workspacePath: string;
  identity: ProjectIdentity;
  projectId: string;
  git?: GitInfo;
  identityFile?: { path: string; projectId?: string; memoryVersion?: number };
}

export interface UnfinishedWorkSignal {
  activeTask?: Task;
  openSession?: Session;
  uncommittedChanges?: string[];
  lastHandoff?: Handoff;
  lastActivityAt?: string;
  lastAgent?: string;
}
