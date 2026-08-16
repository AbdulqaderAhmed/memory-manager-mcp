import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { useTempMemoryHome, rmDir, initPlainWorkspace } from './helpers.js';
import { MemoryService } from '../src/service.js';
import { rankMemory, rankMemories, TYPE_HALF_LIFE_DAYS } from '../src/memory/ranker.js';
import { textRelevance, tokenize } from '../src/search/searcher.js';
import type { Memory } from '../src/types.js';

function mem(partial: Partial<Memory>): Memory {
  const now = new Date().toISOString();
  return {
    id: partial.id ?? 'mem_x',
    projectId: partial.projectId ?? 'proj_r',
    type: partial.type ?? 'fact',
    content: partial.content ?? 'content',
    importance: partial.importance ?? 0.5,
    confidence: partial.confidence ?? 0.5,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe('memory ranking', () => {
  it('decisions stay relevant much longer than discoveries', () => {
    expect(TYPE_HALF_LIFE_DAYS.decision).toBeGreaterThan(TYPE_HALF_LIFE_DAYS.discovery);

    const oldDecision = mem({ type: 'decision', importance: 0.9, updatedAt: daysAgo(120) });
    const oldDiscovery = mem({ type: 'discovery', importance: 0.5, updatedAt: daysAgo(120) });
    const now = new Date();
    expect(rankMemory(oldDecision, 1, {}, now)).toBeGreaterThan(
      rankMemory(oldDiscovery, 1, {}, now),
    );
  });

  it('higher importance and confidence rank higher', () => {
    const now = new Date();
    const high = mem({ importance: 0.95, confidence: 0.95 });
    const low = mem({ importance: 0.1, confidence: 0.1 });
    expect(rankMemory(high, 1, {}, now)).toBeGreaterThan(rankMemory(low, 1, {}, now));
  });

  it('recent memories beat stale ones of the same type', () => {
    const now = new Date();
    const fresh = mem({ type: 'progress', updatedAt: daysAgo(1) });
    const stale = mem({ type: 'progress', updatedAt: daysAgo(200) });
    expect(rankMemory(fresh, 1, {}, now)).toBeGreaterThan(rankMemory(stale, 1, {}, now));
  });

  it('rankMemories sorts by blended score', () => {
    const now = new Date();
    const memories = [
      mem({ id: 'a', type: 'discovery', importance: 0.2, updatedAt: daysAgo(100) }),
      mem({ id: 'b', type: 'decision', importance: 0.95, updatedAt: daysAgo(100) }),
      mem({ id: 'c', type: 'fact', importance: 0.5, updatedAt: daysAgo(1) }),
    ];
    const ranked = rankMemories(memories, () => 1, {}, now);
    expect(ranked[0].memory.id).toBe('b');
    expect(ranked[ranked.length - 1].memory.id).toBe('a');
  });
});

describe('text relevance', () => {
  it('scores phrase matches higher than partial matches', () => {
    const exact = textRelevance('employee permission', 'Use RBAC for employee permission checks');
    const partial = textRelevance('employee permission', 'employee scheduling only');
    expect(exact).toBeGreaterThan(partial);
  });

  it('returns 0 for no overlap', () => {
    expect(textRelevance('zebra', 'nothing to see here')).toBe(0);
  });

  it('tokenizes and drops stopwords', () => {
    expect(tokenize('The quick brown fox')).toEqual(['quick', 'brown', 'fox']);
  });
});

describe('MemoryService memory operations', () => {
  let home: string;
  let service: MemoryService;
  let workspace: string;
  let cleanupWs: () => Promise<void>;

  beforeAll(async () => {
    home = await useTempMemoryHome('memhome-memory');
    service = new MemoryService();
    const ws = await initPlainWorkspace();
    workspace = ws.dir;
    cleanupWs = ws.cleanup;
  });

  afterAll(async () => {
    await cleanupWs();
    await rmDir(home);
  });

  it('saves, retrieves and updates memories', async () => {
    const { project } = await service.detectAndRegister(workspace);

    const saved = await service.memoryManager.saveMemory({
      projectId: project.id,
      type: 'decision',
      content: 'Use RBAC for employee permissions.',
      importance: 0.95,
      confidence: 0.9,
      agentId: 'cursor',
    });
    expect(saved.id).toMatch(/^mem_/);
    expect(saved.importance).toBe(0.95);

    const fetched = await service.memoryManager.getMemory(project.id, saved.id);
    expect(fetched?.content).toBe('Use RBAC for employee permissions.');

    const updated = await service.memoryManager.saveMemory({
      projectId: project.id,
      type: 'decision',
      content: 'Use RBAC with fine-grained scopes.',
      id: saved.id,
    });
    expect(updated.id).toBe(saved.id);
    const all = await service.memoryManager.getMemories(project.id);
    expect(all.filter((m) => m.id === saved.id)).toHaveLength(1);
    expect(all.find((m) => m.id === saved.id)?.content).toBe('Use RBAC with fine-grained scopes.');
  });

  it('rejects invalid memory types and empty content', async () => {
    const { project } = await service.detectAndRegister(workspace);
    await expect(
      service.memoryManager.saveMemory({
        projectId: project.id,
        type: 'nonsense' as never,
        content: 'x',
      }),
    ).rejects.toThrow();
    await expect(
      service.memoryManager.saveMemory({ projectId: project.id, type: 'fact', content: '   ' }),
    ).rejects.toThrow();
  });

  it('records decisions and lists them newest first', async () => {
    const { project } = await service.detectAndRegister(workspace);
    await service.memoryManager.recordDecision({
      projectId: project.id,
      content: 'First decision',
      importance: 0.7,
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = await service.memoryManager.recordDecision({
      projectId: project.id,
      content: 'Second decision',
      importance: 0.9,
    });
    const decisions = await service.memoryManager.getDecisions(project.id);
    expect(decisions[0].id).toBe(second.id);
  });

  it('search finds memories across sources', async () => {
    const { project } = await service.detectAndRegister(workspace);
    await service.memoryManager.saveMemory({
      projectId: project.id,
      type: 'requirement',
      content: 'Employees must be able to request leave online',
      importance: 0.8,
    });
    await service.memoryManager.createTask({
      projectId: project.id,
      title: 'Leave approval UI',
    });

    const results = await service.searcher.search({ query: 'leave', projectId: project.id });
    expect(results.length).toBeGreaterThanOrEqual(2);
    const sources = new Set(results.map((r) => r.source));
    expect(sources.has('memory')).toBe(true);
    expect(sources.has('task')).toBe(true);
  });

  it('search respects type and importance filters', async () => {
    const { project } = await service.detectAndRegister(workspace);
    const results = await service.searcher.search({
      query: 'decision',
      projectId: project.id,
      types: ['decision'],
    });
    for (const r of results.filter((r) => r.source === 'memory')) {
      expect((r.record as Memory).type).toBe('decision');
    }
  });
});
