/**
 * SessionManager — tracks agent interaction sessions per project.
 *
 * A session represents one continuous agent working period. Sessions are the
 * backbone of unfinished-work detection: an "active" session whose agent went
 * silent indicates work may have been interrupted.
 */
import type { MemoryStore } from "../storage/interface.js";
import type { Session, SessionStatus } from "../types.js";
import { SESSION_STATUSES } from "../types.js";
import { newId, nowIso, truncate } from "../util.js";

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

export interface SaveDigestInput {
  projectId: string;
  /** Session to attach the digest to. Defaults to the most recent session. */
  sessionId?: string;
  agentId?: string;
  digest: string;
}

/**
 * Maximum stored digest size. Large enough to keep real detail, small enough
 * that session files never bloat — this is the "compression" budget.
 */
export const MAX_DIGEST_CHARS = 4000;

export class SessionManager {
  constructor(private readonly store: MemoryStore) {}

  async startSession(input: StartSessionInput): Promise<Session> {
    const session: Session = {
      sessionId: newId("sess"),
      projectId: input.projectId,
      agentId: input.agentId,
      agentName: input.agentName,
      startedAt: nowIso(),
      branch: input.branch,
      workingDirectory: input.workingDirectory,
      status: "active",
    };
    await this.store.saveSession(session);
    return session;
  }

  async finishSession(input: FinishSessionInput): Promise<Session> {
    const existing = await this.store.getSession(
      input.projectId,
      input.sessionId,
    );
    if (!existing) throw new Error(`Session not found: ${input.sessionId}`);
    const status =
      input.status && SESSION_STATUSES.includes(input.status)
        ? input.status
        : "completed";
    const updated: Session = {
      ...existing,
      status,
      summary: input.summary?.trim() || existing.summary,
      endedAt: nowIso(),
    };
    await this.store.saveSession(updated);
    return updated;
  }

  async getSession(
    projectId: string,
    sessionId: string,
  ): Promise<Session | null> {
    return this.store.getSession(projectId, sessionId);
  }

  /**
   * Compress and store a whole-conversation digest on a session.
   *
   * The digest is the "compressed" form of a chat: detailed enough for the
   * next agent to understand what happened from first message to last, but
   * capped so storage stays small. The ContextBuilder "decompresses" it by
   * injecting it into the next briefing.
   */
  async saveDigest(input: SaveDigestInput): Promise<Session> {
    const digest = truncate(input.digest.trim(), MAX_DIGEST_CHARS);
    if (!digest) throw new Error("Digest must not be empty");

    let session = input.sessionId
      ? await this.store.getSession(input.projectId, input.sessionId)
      : await this.getLatestSession(input.projectId);
    if (!session) {
      // No session tracked yet — create one to carry the digest.
      session = await this.startSession({
        projectId: input.projectId,
        agentId: input.agentId ?? "unknown",
      });
    }
    const updated: Session = { ...session, digest };
    await this.store.saveSession(updated);
    return updated;
  }

  /** The most recent session that carries a conversation digest. */
  async getLatestDigest(projectId: string): Promise<{
    session: Session;
    digest: string;
  } | null> {
    const sessions = await this.store.listSessions(projectId);
    for (const session of sessions) {
      if (session.digest) return { session, digest: session.digest };
    }
    return null;
  }

  async listSessions(projectId: string): Promise<Session[]> {
    return this.store.listSessions(projectId);
  }

  /** Sessions still marked active (candidates for unfinished-work detection). */
  async getActiveSessions(projectId: string): Promise<Session[]> {
    const sessions = await this.store.listSessions(projectId);
    return sessions.filter((s) => s.status === "active");
  }

  /** The most recent session regardless of status. */
  async getLatestSession(projectId: string): Promise<Session | null> {
    const sessions = await this.store.listSessions(projectId);
    return sessions[0] ?? null;
  }
}
