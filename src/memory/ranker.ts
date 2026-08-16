/**
 * Memory ranking.
 *
 * Relevance is NOT "newest first". The score blends:
 *
 *   text relevance, importance, confidence, recency, memory type
 *
 * Different memory types decay at different rates: architectural decisions
 * and constraints stay relevant for a very long time, while transient
 * debugging observations decay quickly.
 */
import type { Memory, MemoryType } from '../types.js';

/** Half-life (days) of a memory type's recency contribution. */
export const TYPE_HALF_LIFE_DAYS: Record<MemoryType, number> = {
  decision: 365,
  architecture: 365,
  constraint: 365,
  requirement: 270,
  fact: 180,
  preference: 180,
  task: 60,
  solution: 90,
  progress: 45,
  problem: 30,
  discovery: 30,
};

/** Small boost for types that are structurally important to future work. */
export const TYPE_WEIGHT: Record<MemoryType, number> = {
  decision: 1.0,
  architecture: 1.0,
  constraint: 0.95,
  requirement: 0.9,
  solution: 0.8,
  task: 0.75,
  fact: 0.7,
  preference: 0.65,
  progress: 0.6,
  problem: 0.7,
  discovery: 0.6,
};

const MS_PER_DAY = 86_400_000;

/** Exponential recency decay: 1.0 now, 0.5 after one half-life. */
export function recencyScore(updatedAt: string, now: Date = new Date()): number {
  const then = new Date(updatedAt).getTime();
  if (Number.isNaN(then)) return 0;
  const ageDays = Math.max(0, (now.getTime() - then) / MS_PER_DAY);
  // Default half-life when type unknown.
  return Math.pow(0.5, ageDays / 90);
}

export function typeRecencyScore(memory: Memory, now: Date = new Date()): number {
  const then = new Date(memory.updatedAt).getTime();
  if (Number.isNaN(then)) return 0;
  const ageDays = Math.max(0, (now.getTime() - then) / MS_PER_DAY);
  const halfLife = TYPE_HALF_LIFE_DAYS[memory.type] ?? 90;
  return Math.pow(0.5, ageDays / halfLife);
}

export interface RankWeights {
  textRelevance?: number;
  importance?: number;
  confidence?: number;
  recency?: number;
  type?: number;
}

const DEFAULT_WEIGHTS: Required<RankWeights> = {
  textRelevance: 0.35,
  importance: 0.25,
  confidence: 0.1,
  recency: 0.2,
  type: 0.1,
};

/**
 * Compute a blended relevance score in [0, 1] for a memory.
 *
 * @param textRelevance normalized text-match score in [0, 1]; pass 1 when
 *                      ranking without a query (e.g. "top memories").
 */
export function rankMemory(
  memory: Memory,
  textRelevance: number,
  weights: RankWeights = {},
  now: Date = new Date(),
): number {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const total = w.textRelevance + w.importance + w.confidence + w.recency + w.type;
  const score =
    (w.textRelevance * clamp01Local(textRelevance) +
      w.importance * clamp01Local(memory.importance) +
      w.confidence * clamp01Local(memory.confidence) +
      w.recency * typeRecencyScore(memory, now) +
      w.type * (TYPE_WEIGHT[memory.type] ?? 0.6)) /
    (total || 1);
  return clamp01Local(score);
}

/** Rank a list of memories, highest score first. */
export function rankMemories(
  memories: Memory[],
  textRelevanceOf: (m: Memory) => number,
  weights?: RankWeights,
  now: Date = new Date(),
): Array<{ memory: Memory; score: number }> {
  return memories
    .map((memory) => ({ memory, score: rankMemory(memory, textRelevanceOf(memory), weights, now) }))
    .sort((a, b) => b.score - a.score);
}

function clamp01Local(v: number): number {
  return Math.min(1, Math.max(0, v));
}
