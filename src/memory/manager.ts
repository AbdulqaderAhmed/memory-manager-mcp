/**
 * MemoryManager — high-level operations over curated memories, tasks,
 * decisions and the project context document.
 *
 * This layer sits between the MCP tools and the MemoryStore and is where
 * defaults (importance/confidence), validation and id generation live.
 */
import type { MemoryStore } from "../storage/interface.js";
import type {
  Decision,
  Memory,
  MemoryFilter,
  MemoryType,
  ProjectContext,
  ProjectStatus,
  Task,
  TaskStatus,
} from "../types.js";
import { PROJECT_STATUSES, TASK_STATUSES, isMemoryType } from "../types.js";
import { clamp01, newId, nowIso } from "../util.js";

export interface SaveMemoryInput {
  projectId: string;
  type: MemoryType;
  content: string;
  importance?: number;
  confidence?: number;
  source?: string;
  agentId?: string;
  sessionId?: string;
  tags?: string[];
  /** When provided, update that memory instead of creating a new one. */
  id?: string;
}

export interface SaveDecisionInput {
  projectId: string;
  content: string;
  rationale?: string;
  alternatives?: string[];
  importance?: number;
  confidence?: number;
  agentId?: string;
  sessionId?: string;
}

export interface UpdateTaskInput {
  projectId: string;
  taskId: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
  relatedFiles?: string[];
  agentId?: string;
}

export interface UpdateContextInput {
  projectId: string;
  name?: string;
  technology?: string[];
  currentTask?: string;
  status?: ProjectStatus;
  summary?: string;
  lastAgent?: string;
  lastSession?: string;
}

export class MemoryManager {
  constructor(private readonly store: MemoryStore) {}

  // -- Memories -------------------------------------------------------------

  async saveMemory(input: SaveMemoryInput): Promise<Memory> {
    if (!isMemoryType(input.type)) {
      throw new Error(`Invalid memory type: ${String(input.type)}`);
    }
    const content = input.content?.trim();
    if (!content) throw new Error("Memory content must not be empty");

    const now = nowIso();
    const existing = input.id
      ? await this.store.getMemory(input.projectId, input.id)
      : null;

    const memory: Memory = existing
      ? {
          ...existing,
          type: input.type,
          content,
          importance: clamp01(input.importance, existing.importance),
          confidence: clamp01(input.confidence, existing.confidence),
          source: input.source ?? existing.source,
          agentId: input.agentId ?? existing.agentId,
          sessionId: input.sessionId ?? existing.sessionId,
          tags: input.tags ?? existing.tags,
          updatedAt: now,
        }
      : {
          id: newId("mem"),
          projectId: input.projectId,
          type: input.type,
          content,
          importance: clamp01(input.importance, 0.5),
          confidence: clamp01(input.confidence, 0.7),
          source: input.source,
          agentId: input.agentId,
          sessionId: input.sessionId,
          tags: input.tags,
          createdAt: now,
          updatedAt: now,
        };

    await this.store.saveMemory(memory);
    return memory;
  }

  async getMemory(projectId: string, memoryId: string): Promise<Memory | null> {
    return this.store.getMemory(projectId, memoryId);
  }

  async getMemories(
    projectId: string,
    filter?: MemoryFilter,
  ): Promise<Memory[]> {
    return this.store.getMemories(projectId, filter);
  }

  async deleteMemory(projectId: string, memoryId: string): Promise<boolean> {
    return this.store.deleteMemory(projectId, memoryId);
  }

  // -- Decisions ------------------------------------------------------------

  async recordDecision(input: SaveDecisionInput): Promise<Decision> {
    const content = input.content?.trim();
    if (!content) throw new Error("Decision content must not be empty");
    const now = nowIso();
    const decision: Decision = {
      id: newId("dec"),
      projectId: input.projectId,
      content,
      rationale: input.rationale?.trim() || undefined,
      alternatives: input.alternatives,
      importance: clamp01(input.importance, 0.8),
      confidence: clamp01(input.confidence, 0.8),
      agentId: input.agentId,
      sessionId: input.sessionId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.store.saveDecision(decision);

    // Decisions are also valuable as searchable memories.
    await this.store.saveMemory({
      id: newId("mem"),
      projectId: input.projectId,
      type: "decision",
      content,
      importance: decision.importance,
      confidence: decision.confidence,
      source: "record_decision",
      agentId: input.agentId,
      sessionId: input.sessionId,
      createdAt: now,
      updatedAt: now,
    });
    return decision;
  }

  async getDecisions(
    projectId: string,
    activeOnly = false,
  ): Promise<Decision[]> {
    const decisions = await this.store.getDecisions(projectId);
    const filtered = activeOnly
      ? decisions.filter((d) => d.status === "active")
      : decisions;
    return [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // -- Tasks ----------------------------------------------------------------

  async createTask(input: {
    projectId: string;
    title: string;
    description?: string;
    status?: TaskStatus;
    priority?: number;
    agentId?: string;
    sessionId?: string;
    relatedFiles?: string[];
  }): Promise<Task> {
    const title = input.title?.trim();
    if (!title) throw new Error("Task title must not be empty");
    const now = nowIso();
    const task: Task = {
      id: newId("task"),
      projectId: input.projectId,
      title,
      description: input.description?.trim() || undefined,
      status:
        input.status && TASK_STATUSES.includes(input.status)
          ? input.status
          : "active",
      priority: clamp01(input.priority, 0.5),
      agentId: input.agentId,
      sessionId: input.sessionId,
      relatedFiles: input.relatedFiles,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.saveTask(task);
    return task;
  }

  async updateTask(input: UpdateTaskInput): Promise<Task> {
    const existing = await this.store.getTask(input.projectId, input.taskId);
    if (!existing) throw new Error(`Task not found: ${input.taskId}`);
    const now = nowIso();
    const updated: Task = {
      ...existing,
      title: input.title?.trim() || existing.title,
      description:
        input.description !== undefined
          ? input.description.trim() || undefined
          : existing.description,
      status:
        input.status && TASK_STATUSES.includes(input.status)
          ? input.status
          : existing.status,
      priority:
        input.priority !== undefined
          ? clamp01(input.priority, existing.priority ?? 0.5)
          : existing.priority,
      relatedFiles: input.relatedFiles ?? existing.relatedFiles,
      agentId: input.agentId ?? existing.agentId,
      updatedAt: now,
      completedAt:
        input.status === "completed"
          ? now
          : input.status
            ? undefined
            : existing.completedAt,
    };
    await this.store.saveTask(updated);
    return updated;
  }

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    return this.store.getTask(projectId, taskId);
  }

  async getTasks(projectId: string): Promise<Task[]> {
    const tasks = await this.store.getTasks(projectId);
    return [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** The most recently updated open task, if any. */
  async getCurrentTask(projectId: string): Promise<Task | null> {
    const tasks = await this.getTasks(projectId);
    return (
      tasks.find((t) => t.status === "in_progress") ??
      tasks.find((t) => t.status === "active") ??
      tasks.find((t) => t.status === "blocked") ??
      null
    );
  }

  // -- Context --------------------------------------------------------------

  async getContext(projectId: string): Promise<ProjectContext | null> {
    return this.store.getContext(projectId);
  }

  async updateContext(input: UpdateContextInput): Promise<ProjectContext> {
    const existing = (await this.store.getContext(input.projectId)) ?? {
      projectId: input.projectId,
      name: "",
      technology: [],
      status: "unknown" as ProjectStatus,
      lastUpdated: nowIso(),
    };
    const updated: ProjectContext = {
      ...existing,
      name: input.name?.trim() || existing.name,
      technology: input.technology ?? existing.technology,
      currentTask:
        input.currentTask !== undefined
          ? input.currentTask.trim() || undefined
          : existing.currentTask,
      status:
        input.status && PROJECT_STATUSES.includes(input.status)
          ? input.status
          : existing.status,
      summary:
        input.summary !== undefined
          ? input.summary.trim() || undefined
          : existing.summary,
      lastAgent: input.lastAgent ?? existing.lastAgent,
      lastSession: input.lastSession ?? existing.lastSession,
      lastUpdated: nowIso(),
    };
    await this.store.saveContext(updated);
    return updated;
  }
}
