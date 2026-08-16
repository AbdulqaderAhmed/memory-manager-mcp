/**
 * Storage abstraction.
 *
 * The MCP layer only ever talks to this interface. The default (and V1-only)
 * implementation is FileSystemMemoryStore, but the design allows future
 * backends (SQLiteMemoryStore, RemoteMemoryStore, VectorMemoryStore) without
 * touching the MCP tool layer.
 */
import type {
  Decision,
  Handoff,
  Memory,
  MemoryFilter,
  Project,
  ProjectContext,
  Session,
  Task,
} from '../types.js';

export interface MemoryStore {
  // -- Projects -------------------------------------------------------------
  getProject(id: string): Promise<Project | null>;
  saveProject(project: Project): Promise<void>;
  listProjects(): Promise<Project[]>;
  deleteProject(id: string): Promise<void>;

  // -- Project context ------------------------------------------------------
  getContext(projectId: string): Promise<ProjectContext | null>;
  saveContext(context: ProjectContext): Promise<void>;

  // -- Memories -------------------------------------------------------------
  getMemories(projectId: string, filter?: MemoryFilter): Promise<Memory[]>;
  getMemory(projectId: string, memoryId: string): Promise<Memory | null>;
  saveMemory(memory: Memory): Promise<void>;
  deleteMemory(projectId: string, memoryId: string): Promise<boolean>;

  // -- Tasks ----------------------------------------------------------------
  getTasks(projectId: string): Promise<Task[]>;
  getTask(projectId: string, taskId: string): Promise<Task | null>;
  saveTask(task: Task): Promise<void>;
  deleteTask(projectId: string, taskId: string): Promise<boolean>;

  // -- Decisions ------------------------------------------------------------
  getDecisions(projectId: string): Promise<Decision[]>;
  saveDecision(decision: Decision): Promise<void>;

  // -- Sessions -------------------------------------------------------------
  getSession(projectId: string, sessionId: string): Promise<Session | null>;
  listSessions(projectId: string): Promise<Session[]>;
  saveSession(session: Session): Promise<void>;

  // -- Handoffs -------------------------------------------------------------
  getLatestHandoff(projectId: string): Promise<Handoff | null>;
  getHandoffHistory(projectId: string): Promise<Handoff[]>;
  saveHandoff(handoff: Handoff): Promise<void>;

  // -- Maintenance ----------------------------------------------------------
  /** Delete every stored memory for a project (context/tasks/etc. remain). */
  clearMemories(projectId: string): Promise<void>;
}
