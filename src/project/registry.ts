/**
 * Project registry: automatic registration and lookup of projects.
 *
 * When a previously unknown project is detected it is registered
 * automatically — no manual setup required.
 */
import path from 'node:path';
import type { MemoryStore } from '../storage/interface.js';
import type { Project, ProjectContext, ProjectDetection } from '../types.js';
import { MEMORY_VERSION } from '../version.js';
import { nowIso } from '../util.js';

export interface EnsureProjectResult {
  project: Project;
  /** True when the project was just created by this call. */
  isNew: boolean;
}

export class ProjectRegistry {
  constructor(private readonly store: MemoryStore) {}

  /**
   * Find or create the project for a detection result. Also refreshes
   * lastActivityAt and records any newly observed local path.
   */
  async ensureProject(detection: ProjectDetection): Promise<EnsureProjectResult> {
    const existing = await this.store.getProject(detection.projectId);
    const now = nowIso();
    const localPath = detection.git?.repoRoot ?? detection.workspacePath;

    if (existing) {
      if (!existing.localPaths.includes(localPath)) {
        existing.localPaths.push(localPath);
      }
      if (detection.git?.remoteUrl && !existing.identity.remoteUrl) {
        existing.identity.remoteUrl = detection.git.remoteUrl;
      }
      existing.lastActivityAt = now;
      await this.store.saveProject(existing);
      return { project: existing, isNew: false };
    }

    const name =
      detection.identity.repoName ??
      path.basename(detection.workspacePath);

    const project: Project = {
      id: detection.projectId,
      name,
      identity: detection.identity,
      repoRoot: detection.git?.repoRoot,
      localPaths: [localPath],
      createdAt: now,
      lastActivityAt: now,
      memoryVersion: MEMORY_VERSION,
    };
    await this.store.saveProject(project);

    // Seed an initial context document.
    const context: ProjectContext = {
      projectId: project.id,
      name: project.name,
      technology: [],
      status: 'unknown',
      lastUpdated: now,
    };
    await this.store.saveContext(context);

    return { project, isNew: true };
  }

  async getProject(projectId: string): Promise<Project | null> {
    return this.store.getProject(projectId);
  }

  async listProjects(): Promise<Project[]> {
    return this.store.listProjects();
  }
}
