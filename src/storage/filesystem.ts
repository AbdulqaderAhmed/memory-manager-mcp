/**
 * FileSystemMemoryStore — the default, database-free MemoryStore backend.
 *
 * Layout (under ~/.agent-memory):
 *
 *   projects/<projectId>/
 *     project.json      structured project record
 *     context.json      compact current-state document
 *     tasks.json        task list (read-modify-write under lock)
 *     decisions.json    decision list (read-modify-write under lock)
 *     memories.jsonl    append-only memory log (updates append new versions,
 *                       deletes append tombstones)
 *     sessions/<id>.json
 *     handoffs/latest.json
 *     handoffs/history/<ts>-<id>.json
 *
 * Crash safety: all JSON documents are written via temp-file + fsync +
 * atomic rename. The JSONL log tolerates a truncated final line.
 *
 * Concurrency: read-modify-write operations take a per-project advisory
 * lock; append-only writes use O_APPEND + fsync.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MemoryStore } from './interface.js';
import {
  appendJsonLine,
  readJsonl,
  readJsonOrNull,
  withLock,
  writeJsonAtomic,
} from './fsutil.js';
import {
  getContextFile,
  getDecisionsFile,
  getHandoffHistoryDir,
  getHandoffsDir,
  getLatestHandoffFile,
  getMemoriesFile,
  getProjectDir,
  getProjectFile,
  getProjectLockFile,
  getProjectsDir,
  getSessionFile,
  getSessionsDir,
  getTasksFile,
  sanitizeSegment,
} from './paths.js';
import type {
  Decision,
  Handoff,
  Memory,
  MemoryFilter,
  MemoryLogEntry,
  Project,
  ProjectContext,
  Session,
  Task,
} from '../types.js';
import { isDeletedMarker } from '../types.js';

export class FileSystemMemoryStore implements MemoryStore {
  constructor(private readonly root: string) {}

  // -- Projects -------------------------------------------------------------

  async getProject(id: string): Promise<Project | null> {
    return readJsonOrNull<Project>(getProjectFile(id, this.root));
  }

  async saveProject(project: Project): Promise<void> {
    await writeJsonAtomic(getProjectFile(project.id, this.root), project);
  }

  async listProjects(): Promise<Project[]> {
    const dir = getProjectsDir(this.root);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    const projects: Project[] = [];
    for (const entry of entries) {
      const project = await readJsonOrNull<Project>(path.join(dir, entry, 'project.json'));
      if (project) projects.push(project);
    }
    projects.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
    return projects;
  }

  async deleteProject(id: string): Promise<void> {
    await fs.rm(getProjectDir(id, this.root), { recursive: true, force: true });
  }

  // -- Project context ------------------------------------------------------

  async getContext(projectId: string): Promise<ProjectContext | null> {
    return readJsonOrNull<ProjectContext>(getContextFile(projectId, this.root));
  }

  async saveContext(context: ProjectContext): Promise<void> {
    await writeJsonAtomic(getContextFile(context.projectId, this.root), context);
  }

  // -- Memories (append-only JSONL with versioning + tombstones) ------------

  async getMemories(projectId: string, filter?: MemoryFilter): Promise<Memory[]> {
    const memories = await this.materializeMemories(projectId);
    let result = memories;
    if (filter) {
      if (filter.types && filter.types.length > 0) {
        result = result.filter((m) => filter.types!.includes(m.type));
      }
      if (filter.minImportance !== undefined) {
        result = result.filter((m) => m.importance >= filter.minImportance!);
      }
      if (filter.since) {
        result = result.filter((m) => m.updatedAt >= filter.since!);
      }
      if (filter.limit !== undefined && filter.limit > 0) {
        result = result.slice(0, filter.limit);
      }
    }
    return result;
  }

  async getMemory(projectId: string, memoryId: string): Promise<Memory | null> {
    const memories = await this.materializeMemories(projectId);
    return memories.find((m) => m.id === memoryId) ?? null;
  }

  async saveMemory(memory: Memory): Promise<void> {
    await appendJsonLine(getMemoriesFile(memory.projectId, this.root), memory);
  }

  async deleteMemory(projectId: string, memoryId: string): Promise<boolean> {
    const existing = await this.getMemory(projectId, memoryId);
    if (!existing) return false;
    await appendJsonLine(getMemoriesFile(projectId, this.root), {
      id: memoryId,
      projectId,
      deleted: true,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  /**
   * Replay the JSONL log: later entries for the same id replace earlier ones;
   * tombstones remove entries. Result is sorted newest-first by updatedAt.
   */
  private async materializeMemories(projectId: string): Promise<Memory[]> {
    const entries = await readJsonl<MemoryLogEntry>(getMemoriesFile(projectId, this.root));
    const byId = new Map<string, Memory>();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || typeof (entry as Memory).id !== 'string') {
        continue;
      }
      if (isDeletedMarker(entry)) {
        byId.delete(entry.id);
      } else {
        byId.set(entry.id, entry);
      }
    }
    return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // -- Tasks ----------------------------------------------------------------

  async getTasks(projectId: string): Promise<Task[]> {
    const tasks = await readJsonOrNull<Task[]>(getTasksFile(projectId, this.root));
    return Array.isArray(tasks) ? tasks : [];
  }

  async getTask(projectId: string, taskId: string): Promise<Task | null> {
    const tasks = await this.getTasks(projectId);
    return tasks.find((t) => t.id === taskId) ?? null;
  }

  async saveTask(task: Task): Promise<void> {
    const lockPath = getProjectLockFile(task.projectId, this.root);
    await withLock(lockPath, async () => {
      const tasks = await this.getTasks(task.projectId);
      const idx = tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) tasks[idx] = task;
      else tasks.push(task);
      await writeJsonAtomic(getTasksFile(task.projectId, this.root), tasks);
    });
  }

  async deleteTask(projectId: string, taskId: string): Promise<boolean> {
    const lockPath = getProjectLockFile(projectId, this.root);
    return withLock(lockPath, async () => {
      const tasks = await this.getTasks(projectId);
      const next = tasks.filter((t) => t.id !== taskId);
      if (next.length === tasks.length) return false;
      await writeJsonAtomic(getTasksFile(projectId, this.root), next);
      return true;
    });
  }

  // -- Decisions ------------------------------------------------------------

  async getDecisions(projectId: string): Promise<Decision[]> {
    const decisions = await readJsonOrNull<Decision[]>(getDecisionsFile(projectId, this.root));
    return Array.isArray(decisions) ? decisions : [];
  }

  async saveDecision(decision: Decision): Promise<void> {
    const lockPath = getProjectLockFile(decision.projectId, this.root);
    await withLock(lockPath, async () => {
      const decisions = await this.getDecisions(decision.projectId);
      const idx = decisions.findIndex((d) => d.id === decision.id);
      if (idx >= 0) decisions[idx] = decision;
      else decisions.push(decision);
      await writeJsonAtomic(getDecisionsFile(decision.projectId, this.root), decisions);
    });
  }

  // -- Sessions -------------------------------------------------------------

  async getSession(projectId: string, sessionId: string): Promise<Session | null> {
    return readJsonOrNull<Session>(getSessionFile(projectId, sessionId, this.root));
  }

  async listSessions(projectId: string): Promise<Session[]> {
    const dir = getSessionsDir(projectId, this.root);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    const sessions: Session[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const session = await readJsonOrNull<Session>(path.join(dir, entry));
      if (session) sessions.push(session);
    }
    sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return sessions;
  }

  async saveSession(session: Session): Promise<void> {
    await writeJsonAtomic(getSessionFile(session.projectId, session.sessionId, this.root), session);
  }

  // -- Handoffs -------------------------------------------------------------

  async getLatestHandoff(projectId: string): Promise<Handoff | null> {
    return readJsonOrNull<Handoff>(getLatestHandoffFile(projectId, this.root));
  }

  async getHandoffHistory(projectId: string): Promise<Handoff[]> {
    const dir = getHandoffHistoryDir(projectId, this.root);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    const handoffs: Handoff[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const handoff = await readJsonOrNull<Handoff>(path.join(dir, entry));
      if (handoff) handoffs.push(handoff);
    }
    handoffs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return handoffs;
  }

  async saveHandoff(handoff: Handoff): Promise<void> {
    const lockPath = getProjectLockFile(handoff.projectId, this.root);
    await withLock(lockPath, async () => {
      await fs.mkdir(getHandoffsDir(handoff.projectId, this.root), { recursive: true });
      const stamp = handoff.createdAt.replace(/[:.]/g, '-');
      const historyFile = path.join(
        getHandoffHistoryDir(handoff.projectId, this.root),
        `${stamp}-${sanitizeSegment(handoff.id)}.json`,
      );
      await writeJsonAtomic(historyFile, handoff);
      await writeJsonAtomic(getLatestHandoffFile(handoff.projectId, this.root), handoff);
    });
  }

  // -- Maintenance ----------------------------------------------------------

  async clearMemories(projectId: string): Promise<void> {
    await fs.rm(getMemoriesFile(projectId, this.root), { force: true });
  }
}
