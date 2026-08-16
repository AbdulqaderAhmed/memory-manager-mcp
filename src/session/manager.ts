/**
 * SessionManager — tracks agent interaction sessions per project.
 *
 * A session represents one continuous agent working period. Sessions are the
 * backbone of unfinished-work detection: an "active" session whose agent went
 * silent indicates work may have been interrupted.
 */
import type { MemoryStore } from '../storage/interface.js';
import type { Session, SessionStatus } from '../types.js';
import { SESSION_STATUSES } from '../types.js';
import { newId, nowIso } from '../util.js';

export interface StartSessionInput {
  projectId: string;
  agentId: string;
  agentName?: string;
  branch?: string;
  workingDirectory?: string;
}

export interface FinishSessionInput {
  projectId: string;
  sessionId: string;
  status?: SessionStatus;
  summary?: string;
}

export class SessionManager {
  constructor(private readonly store: MemoryStore) {}

  async startSession(input: StartSessionInput): Promise<Session> {
    const session: Session = {
      sessionId: newId('sess'),
      projectId: input.projectId,
      agentId: input.agentId,
      agentName: input.agentName,
      startedAt: nowIso(),
      branch: input.branch,
      workingDirectory: input.workingDirectory,
      status: 'active',
    };
    await this.store.saveSession(session);
    return session;
  }

  async finishSession(input: FinishSessionInput): Promise<Session> {
    const existing = await this.store.getSession(input.projectId, input.sessionId);
    if (!existing) throw new Error(`Session not found: ${input.sessionId}`);
    const status = input.status && SESSION_STATUSES.includes(input.status) ? input.status : 'completed';
    const updated: Session = {
      ...existing,
      status,
      summary: input.summary?.trim() || existing.summary,
      endedAt: nowIso(),
    };
    await this.store.saveSession(updated);
    return updated;
  }

  async getSession(projectId: string, sessionId: string): Promise<Session | null> {
    return this.store.getSession(projectId, sessionId);
  }

  async listSessions(projectId: string): Promise<Session[]> {
    return this.store.listSessions(projectId);
  }

  /** Sessions still marked active (candidates for unfinished-work detection). */
  async getActiveSessions(projectId: string): Promise<Session[]> {
    const sessions = await this.store.listSessions(projectId);
    return sessions.filter((s) => s.status === 'active');
  }

  /** The most recent session regardless of status. */
  async getLatestSession(projectId: string): Promise<Session | null> {
    const sessions = await this.store.listSessions(projectId);
    return sessions[0] ?? null;
  }
}
