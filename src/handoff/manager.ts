/**
 * HandoffManager — first-class structured handoffs between agents.
 *
 * A handoff captures, in a compact form, everything the NEXT agent needs:
 * what was done, what remains, known problems, changed files and the
 * recommended next action.
 *
 * Storage keeps both `latest.json` (fast retrieval) and a full history.
 */
import type { MemoryStore } from '../storage/interface.js';
import type { Handoff } from '../types.js';
import { newId, nowIso } from '../util.js';

export interface CreateHandoffInput {
  projectId: string;
  sessionId?: string;
  agentId: string;
  task: string;
  completed?: string[];
  remaining?: string[];
  problems?: string[];
  changedFiles?: string[];
  nextAction: string;
  notes?: string;
}

export class HandoffManager {
  constructor(private readonly store: MemoryStore) {}

  async createHandoff(input: CreateHandoffInput): Promise<Handoff> {
    const task = input.task?.trim();
    if (!task) throw new Error('Handoff task must not be empty');
    const nextAction = input.nextAction?.trim();
    if (!nextAction) throw new Error('Handoff nextAction must not be empty');

    const handoff: Handoff = {
      id: newId('ho'),
      projectId: input.projectId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      task,
      completed: cleanList(input.completed),
      remaining: cleanList(input.remaining),
      problems: cleanList(input.problems),
      changedFiles: cleanList(input.changedFiles),
      nextAction,
      notes: input.notes?.trim() || undefined,
      createdAt: nowIso(),
    };
    await this.store.saveHandoff(handoff);
    return handoff;
  }

  async getLatestHandoff(projectId: string): Promise<Handoff | null> {
    return this.store.getLatestHandoff(projectId);
  }

  async getHistory(projectId: string, limit = 10): Promise<Handoff[]> {
    const history = await this.store.getHandoffHistory(projectId);
    return history.slice(0, limit);
  }
}

function cleanList(items?: string[]): string[] {
  return (items ?? [])
    .map((i) => i?.trim())
    .filter((i): i is string => Boolean(i));
}
