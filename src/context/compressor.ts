/**
 * Compressor — small helpers to keep generated context within a token-ish
 * budget. V1 uses character budgets as a cheap proxy for tokens.
 */
import { truncate } from '../util.js';

export interface BudgetOptions {
  /** Max characters for the whole briefing. */
  maxTotalChars?: number;
  /** Max characters for a single item snippet. */
  maxItemChars?: number;
}

export const DEFAULT_BUDGET: Required<BudgetOptions> = {
  maxTotalChars: 6000,
  maxItemChars: 280,
};

export function compressItem(text: string, options?: BudgetOptions): string {
  const max = options?.maxItemChars ?? DEFAULT_BUDGET.maxItemChars;
  return truncate(text.replace(/\s+/g, ' ').trim(), max);
}

/**
 * Join sections and trim the tail so the total stays within budget.
 * Earlier sections have priority (they are kept first).
 */
export function fitBudget(sections: string[], options?: BudgetOptions): string {
  const max = options?.maxTotalChars ?? DEFAULT_BUDGET.maxTotalChars;
  const parts: string[] = [];
  let used = 0;
  for (const section of sections) {
    if (!section) continue;
    const cost = section.length + 2;
    if (used + cost > max) {
      const remaining = max - used - 16;
      if (remaining > 60) parts.push(truncate(section, remaining));
      break;
    }
    parts.push(section);
    used += cost;
  }
  return parts.join('\n\n');
}
