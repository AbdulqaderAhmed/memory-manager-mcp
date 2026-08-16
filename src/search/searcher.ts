/**
 * Searcher — fast local keyword search across all memory sources.
 *
 * V1 deliberately avoids embeddings/vector databases. It uses tokenized
 * keyword matching with a simple relevance model (term coverage, phrase
 * bonus, importance, recency). The SearchOptions interface is designed so a
 * semantic backend can be swapped in later without changing callers.
 */
import type { MemoryStore } from '../storage/interface.js';
import type {
  Memory,
  SearchResult,
  SearchOptions,
} from '../types.js';
import { rankMemory } from '../memory/ranker.js';
import { truncate } from '../util.js';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has',
  'have', 'how', 'i', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'this', 'to', 'was', 'were', 'what', 'when', 'where', 'which',
  'who', 'will', 'with', 'you', 'your',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Normalized keyword relevance of `text` for `query` in [0, 1].
 * Combines term coverage with a phrase-match bonus.
 */
export function textRelevance(query: string, text: string): number {
  const haystack = text.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  let score = 0;

  // Phrase bonus.
  if (q.length > 2 && haystack.includes(q)) {
    score += 0.5;
  }

  const terms = tokenize(query);
  if (terms.length > 0) {
    let hits = 0;
    for (const term of terms) {
      if (haystack.includes(term)) hits += 1;
    }
    score += 0.5 * (hits / terms.length);
  }

  return Math.min(1, score);
}

export class Searcher {
  constructor(
    private readonly store: MemoryStore,
    private readonly defaultMaxResults: number = 20,
  ) {}

  async search(options: SearchOptions): Promise<SearchResult[]> {
    const query = options.query?.trim() ?? '';
    if (!query) return [];
    const limit = options.limit ?? this.defaultMaxResults;
    const results: SearchResult[] = [];

    const projectIds = options.projectId
      ? [options.projectId]
      : (await this.store.listProjects()).map((p) => p.id);

    for (const projectId of projectIds) {
      // -- Memories ---------------------------------------------------------
      const memories = await this.store.getMemories(projectId, {
        types: options.types,
        minImportance: options.minImportance,
      });
      for (const memory of memories) {
        const rel = textRelevance(query, `${memory.content} ${(memory.tags ?? []).join(' ')}`);
        if (rel <= 0) continue;
        const score = rankMemory(memory, rel);
        results.push({
          source: 'memory',
          id: memory.id,
          projectId,
          label: memory.type,
          snippet: truncate(memory.content, 200),
          score,
          createdAt: memory.createdAt,
          record: memory,
        });
      }

      // -- Tasks ------------------------------------------------------------
      const tasks = await this.store.getTasks(projectId);
      for (const task of tasks) {
        const rel = textRelevance(query, `${task.title} ${task.description ?? ''}`);
        if (rel <= 0) continue;
        results.push({
          source: 'task',
          id: task.id,
          projectId,
          label: `${task.status}: ${task.title}`,
          snippet: truncate(task.description ?? task.title, 200),
          score: Math.min(1, rel * 0.9 + (task.status === 'in_progress' ? 0.1 : 0)),
          createdAt: task.createdAt,
          record: task,
        });
      }

      // -- Decisions --------------------------------------------------------
      const decisions = await this.store.getDecisions(projectId);
      for (const decision of decisions) {
        const rel = textRelevance(query, `${decision.content} ${decision.rationale ?? ''}`);
        if (rel <= 0) continue;
        results.push({
          source: 'decision',
          id: decision.id,
          projectId,
          label: 'decision',
          snippet: truncate(decision.content, 200),
          score: Math.min(1, rel * 0.85 + decision.importance * 0.15),
          createdAt: decision.createdAt,
          record: decision,
        });
      }

      // -- Handoffs ---------------------------------------------------------
      const handoffs = await this.store.getHandoffHistory(projectId);
      for (const handoff of handoffs) {
        const blob = [
          handoff.task,
          handoff.nextAction,
          ...handoff.completed,
          ...handoff.remaining,
          ...handoff.problems,
        ].join(' ');
        const rel = textRelevance(query, blob);
        if (rel <= 0) continue;
        results.push({
          source: 'handoff',
          id: handoff.id,
          projectId,
          label: `handoff: ${handoff.task}`,
          snippet: truncate(`Next: ${handoff.nextAction}`, 200),
          score: Math.min(1, rel * 0.9),
          createdAt: handoff.createdAt,
          record: handoff,
        });
      }

      // -- Session summaries ------------------------------------------------
      const sessions = await this.store.listSessions(projectId);
      for (const session of sessions) {
        if (!session.summary) continue;
        const rel = textRelevance(query, session.summary);
        if (rel <= 0) continue;
        results.push({
          source: 'session',
          id: session.sessionId,
          projectId,
          label: `session (${session.agentId})`,
          snippet: truncate(session.summary, 200),
          score: Math.min(1, rel * 0.7),
          createdAt: session.startedAt,
          record: session,
        });
      }

      // -- Context ----------------------------------------------------------
      const context = await this.store.getContext(projectId);
      if (context) {
        const blob = [context.name, context.summary ?? '', context.currentTask ?? ''].join(' ');
        const rel = textRelevance(query, blob);
        if (rel > 0) {
          results.push({
            source: 'context',
            id: projectId,
            projectId,
            label: 'project context',
            snippet: truncate(blob, 200),
            score: Math.min(1, rel * 0.8),
            createdAt: context.lastUpdated,
            record: context,
          });
        }
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
