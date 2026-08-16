/**
 * MemoryService — the composition root / facade.
 *
 * Wires the store, managers, searcher and context builder together and
 * exposes the high-level operations used by both the MCP tool layer and the
 * CLI. Keeping this facade means the MCP layer stays thin and testable.
 */
import { FileSystemMemoryStore } from "./storage/filesystem.js";
import type { MemoryStore } from "./storage/interface.js";
import { getMemoryRoot } from "./storage/paths.js";
import { loadConfig, type LoadedConfig } from "./config.js";
import { ProjectRegistry } from "./project/registry.js";
import { detectProject } from "./project/detector.js";
import { MemoryManager } from "./memory/manager.js";
import { SessionManager } from "./session/manager.js";
import { HandoffManager } from "./handoff/manager.js";
import { Searcher } from "./search/searcher.js";
import {
  ContextBuilder,
  type BuiltContext,
  type BuildContextOptions,
} from "./context/builder.js";
import type { Project, ProjectDetection } from "./types.js";

export interface MemoryServiceOptions {
  /** Override the memory root (defaults to ~/.agent-memory). */
  root?: string;
}

export class MemoryService {
  readonly root: string;
  readonly store: MemoryStore;
  readonly registry: ProjectRegistry;
  readonly memoryManager: MemoryManager;
  readonly sessionManager: SessionManager;
  readonly handoffManager: HandoffManager;
  readonly searcher: Searcher;
  readonly contextBuilder: ContextBuilder;

  private configPromise: Promise<LoadedConfig> | null = null;

  constructor(options?: MemoryServiceOptions) {
    this.root = options?.root ?? getMemoryRoot();
    this.store = new FileSystemMemoryStore(this.root);
    this.registry = new ProjectRegistry(this.store);
    this.memoryManager = new MemoryManager(this.store);
    this.sessionManager = new SessionManager(this.store);
    this.handoffManager = new HandoffManager(this.store);
    this.searcher = new Searcher(this.store);
    this.contextBuilder = new ContextBuilder(
      this.store,
      this.memoryManager,
      this.sessionManager,
      this.handoffManager,
    );
  }

  async getConfig(): Promise<LoadedConfig> {
    if (!this.configPromise) {
      this.configPromise = loadConfig(this.root);
    }
    return this.configPromise;
  }

  /** Detect the project for a workspace and auto-register it. */
  async detectAndRegister(workspacePath?: string): Promise<{
    detection: ProjectDetection;
    project: Project;
    isNew: boolean;
  }> {
    const detection = await detectProject(workspacePath);
    const { project, isNew } = await this.registry.ensureProject(detection);
    return { detection, project, isNew };
  }

  /** Build the full context briefing for a workspace. */
  async initializeContext(
    workspacePath?: string,
    options?: Omit<BuildContextOptions, "workspacePath">,
  ): Promise<BuiltContext & { detection: ProjectDetection; isNew: boolean }> {
    const { detection, project, isNew } =
      await this.detectAndRegister(workspacePath);
    const built = await this.contextBuilder.build(project, {
      ...options,
      workspacePath: detection.workspacePath,
    });
    return { ...built, detection, isNew };
  }

  /** Delete all memory for a project. */
  async deleteProjectMemory(projectId: string): Promise<void> {
    await this.store.deleteProject(projectId);
  }

  /** Delete ALL memory for ALL projects (and the config file). */
  async clearAllMemory(): Promise<void> {
    const projects = await this.store.listProjects();
    for (const project of projects) {
      await this.store.deleteProject(project.id);
    }
  }
}
