/**
 * Project detection: figure out WHICH project an agent is working on.
 *
 * Detection chain (see project/identity.ts for the priority rules):
 *   1. Git repository (remote URL -> canonical identity)
 *   2. `.agent-memory.json` identity file in the workspace root
 *   3. Normalized workspace path
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { GitInfo, ProjectDetection } from '../types.js';
import { getGitInfo } from '../git/gitService.js';
import { deriveIdentity, projectIdFromCanonical } from './identity.js';
import { resolveWorkspacePath } from '../storage/paths.js';

export const IDENTITY_FILE_NAME = '.agent-memory.json';

export interface IdentityFileContent {
  projectId?: string;
  memoryVersion?: number;
  name?: string;
}

/** Read `.agent-memory.json` from a directory, if present and valid. */
export async function readIdentityFile(dir: string): Promise<IdentityFileContent | null> {
  try {
    const raw = await fs.readFile(path.join(dir, IDENTITY_FILE_NAME), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as IdentityFileContent;
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect the project for a workspace directory.
 * Pure detection — does not write anything.
 */
export async function detectProject(workspacePath?: string): Promise<ProjectDetection> {
  const workspace = resolveWorkspacePath(workspacePath);
  const git: GitInfo = await getGitInfo(workspace);
  const identityFile = await readIdentityFile(workspace);

  const identity = deriveIdentity({
    workspacePath: workspace,
    gitRemoteUrl: git.remoteUrl,
    gitRepoName: undefined,
    identityFileProjectId: identityFile?.projectId,
  });

  return {
    workspacePath: workspace,
    identity,
    projectId: projectIdFromCanonical(identity.canonical),
    git: git.isRepo ? git : undefined,
    identityFile: identityFile
      ? {
          path: path.join(workspace, IDENTITY_FILE_NAME),
          projectId: identityFile.projectId,
          memoryVersion: identityFile.memoryVersion,
        }
      : undefined,
  };
}
