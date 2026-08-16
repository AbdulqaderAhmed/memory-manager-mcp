/**
 * Unfinished-work detection.
 *
 * Signals (read-only — nothing is ever modified):
 *   - an open task exists
 *   - a session is still marked active (agent went silent)
 *   - uncommitted git changes exist
 *   - a recent handoff lists remaining work
 */
import type { MemoryStore } from '../storage/interface.js';
import type { UnfinishedWorkSignal } from '../types.js';
import type { MemoryManager } from '../memory/manager.js';
import type { SessionManager } from '../session/manager.js';
import type { HandoffManager } from '../handoff/manager.js';
import { getGitInfo } from '../git/gitService.js';

export interface DetectUnfinishedOptions {
  workspacePath?: string;
}

export async function detectUnfinishedWork(
  projectId: string,
  deps: {
    store: MemoryStore;
    memoryManager: MemoryManager;
    sessionManager: SessionManager;
    handoffManager: HandoffManager;
  },
  options?: DetectUnfinishedOptions,
): Promise<UnfinishedWorkSignal | null> {
  const [activeTask, activeSessions, latestHandoff, latestSession, context] = await Promise.all([
    deps.memoryManager.getCurrentTask(projectId),
    deps.sessionManager.getActiveSessions(projectId),
    deps.handoffManager.getLatestHandoff(projectId),
    deps.sessionManager.getLatestSession(projectId),
    deps.store.getContext(projectId),
  ]);

  let uncommittedChanges: string[] | undefined;
  if (options?.workspacePath) {
    const git = await getGitInfo(options.workspacePath, { includeCommits: false });
    if (git.isRepo && git.hasUncommittedChanges && git.changedFiles) {
      uncommittedChanges = git.changedFiles;
    }
  }

  const hasSignal =
    activeTask ||
    activeSessions.length > 0 ||
    (uncommittedChanges && uncommittedChanges.length > 0) ||
    (latestHandoff && latestHandoff.remaining.length > 0);

  if (!hasSignal) return null;

  return {
    activeTask: activeTask ?? undefined,
    openSession: activeSessions[0],
    uncommittedChanges,
    lastHandoff: latestHandoff ?? undefined,
    lastActivityAt: context?.lastUpdated ?? latestSession?.startedAt,
    lastAgent: context?.lastAgent ?? latestSession?.agentId,
  };
}
