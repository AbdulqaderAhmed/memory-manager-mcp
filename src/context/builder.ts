/**
 * ContextBuilder — assembles a compact, prioritized briefing for an agent
 * that just opened a project.
 *
 * Priority order:
 *   1. Current task
 *   2. Latest handoff
 *   3. Active problems
 *   4. Important decisions
 *   5. Architecture
 *   6. Recent progress
 *   7. Relevant historical memories
 *
 * Raw conversation history is never included by default.
 */
import type { MemoryStore } from "../storage/interface.js";
import type {
  Decision,
  Handoff,
  Memory,
  Project,
  ProjectContext,
  Task,
  UnfinishedWorkSignal,
} from "../types.js";
import type { MemoryManager } from "../memory/manager.js";
import type { SessionManager } from "../session/manager.js";
import type { HandoffManager } from "../handoff/manager.js";
import { rankMemories } from "../memory/ranker.js";
import { detectUnfinishedWork } from "./unfinished.js";
import { compressItem, fitBudget, type BudgetOptions } from "./compressor.js";
import { relativeTime } from "../util.js";

export interface BuiltContext {
  project: Project;
  context: ProjectContext | null;
  currentTask: Task | null;
  latestHandoff: Handoff | null;
  activeProblems: Memory[];
  importantDecisions: Decision[];
  architecture: Memory[];
  recentProgress: Memory[];
  relevantMemories: Memory[];
  unfinishedWork: UnfinishedWorkSignal | null;
  /** Human-readable compact briefing. */
  briefing: string;
}

export interface BuildContextOptions {
  workspacePath?: string;
  /** Optional focus query used to rank "relevant memories". */
  focus?: string;
  maxItems?: number;
  budget?: BudgetOptions;
}

export class ContextBuilder {
  constructor(
    private readonly store: MemoryStore,
    private readonly memoryManager: MemoryManager,
    private readonly sessionManager: SessionManager,
    private readonly handoffManager: HandoffManager,
  ) {}

  async build(
    project: Project,
    options?: BuildContextOptions,
  ): Promise<BuiltContext> {
    const projectId = project.id;
    const maxItems = options?.maxItems ?? 20;

    const [
      context,
      currentTask,
      latestHandoff,
      memories,
      decisions,
      unfinishedWork,
    ] = await Promise.all([
      this.store.getContext(projectId),
      this.memoryManager.getCurrentTask(projectId),
      this.handoffManager.getLatestHandoff(projectId),
      this.store.getMemories(projectId),
      this.memoryManager.getDecisions(projectId, true),
      detectUnfinishedWork(
        projectId,
        {
          store: this.store,
          memoryManager: this.memoryManager,
          sessionManager: this.sessionManager,
          handoffManager: this.handoffManager,
        },
        { workspacePath: options?.workspacePath },
      ),
    ]);

    const activeProblems = memories
      .filter((m) => m.type === "problem")
      .sort((a, b) => b.importance - a.importance)
      .slice(0, Math.min(5, maxItems));

    const architecture = memories
      .filter((m) => m.type === "architecture")
      .sort((a, b) => b.importance - a.importance)
      .slice(0, Math.min(5, maxItems));

    const recentProgress = memories
      .filter((m) => m.type === "progress")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.min(5, maxItems));

    const importantDecisions = decisions
      .filter((d) => d.importance >= 0.6)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, Math.min(5, maxItems));

    // Relevant historical memories: rank everything not already surfaced.
    const surfaced = new Set<string>([
      ...activeProblems.map((m) => m.id),
      ...architecture.map((m) => m.id),
      ...recentProgress.map((m) => m.id),
    ]);
    const candidates = memories.filter((m) => !surfaced.has(m.id));
    const ranked = rankMemories(candidates, () => 1);
    const relevantMemories = ranked
      .map((r) => r.memory)
      .slice(0, Math.min(maxItems, 10));

    const briefing = renderBriefing({
      project,
      context,
      currentTask,
      latestHandoff,
      activeProblems,
      importantDecisions,
      architecture,
      recentProgress,
      relevantMemories,
      unfinishedWork,
      budget: options?.budget,
    });

    return {
      project,
      context,
      currentTask,
      latestHandoff,
      activeProblems,
      importantDecisions,
      architecture,
      recentProgress,
      relevantMemories,
      unfinishedWork,
      briefing,
    };
  }
}

// ---------------------------------------------------------------------------
// Briefing rendering
// ---------------------------------------------------------------------------

interface RenderInput {
  project: Project;
  context: ProjectContext | null;
  currentTask: Task | null;
  latestHandoff: Handoff | null;
  activeProblems: Memory[];
  importantDecisions: Decision[];
  architecture: Memory[];
  recentProgress: Memory[];
  relevantMemories: Memory[];
  unfinishedWork: UnfinishedWorkSignal | null;
  budget?: BudgetOptions;
}

function bulletList(items: string[], budget?: BudgetOptions): string {
  return items.map((i) => `- ${compressItem(i, budget)}`).join("\n");
}

export function renderBriefing(input: RenderInput): string {
  const { budget } = input;
  const sections: string[] = [];

  // Header
  const headerLines = [
    `PROJECT: ${input.project.name}`,
    `Project ID: ${input.project.id}`,
  ];
  if (input.context?.technology?.length) {
    headerLines.push(`Technology: ${input.context.technology.join(", ")}`);
  }
  if (input.context?.lastAgent) {
    headerLines.push(`Previous agent: ${input.context.lastAgent}`);
  }
  if (input.context?.lastUpdated) {
    headerLines.push(
      `Last activity: ${relativeTime(input.context.lastUpdated)}`,
    );
  }
  if (input.context?.status && input.context.status !== "unknown") {
    headerLines.push(`Status: ${input.context.status}`);
  }
  sections.push(headerLines.join("\n"));

  // Unfinished work banner
  const uw = input.unfinishedWork;
  if (uw) {
    const lines = ["Unfinished work detected."];
    if (uw.activeTask) lines.push(`Task: ${uw.activeTask.title}`);
    if (uw.lastAgent) lines.push(`Last agent: ${uw.lastAgent}`);
    if (uw.lastActivityAt)
      lines.push(`Last activity: ${relativeTime(uw.lastActivityAt)}`);
    if (uw.uncommittedChanges?.length) {
      lines.push(
        `Uncommitted changes: ${uw.uncommittedChanges.length} file(s)`,
      );
    }
    if (uw.openSession)
      lines.push(
        `Open session: ${uw.openSession.sessionId} (${uw.openSession.agentId})`,
      );
    sections.push(lines.join("\n"));
  }

  // Current task
  if (input.currentTask) {
    const lines = [`Current task: ${input.currentTask.title}`];
    if (input.currentTask.description) {
      lines.push(compressItem(input.currentTask.description, budget));
    }
    sections.push(lines.join("\n"));
  }

  // Latest handoff
  const ho = input.latestHandoff;
  if (ho) {
    const lines = [
      `Latest handoff (from ${ho.agentId}, ${relativeTime(ho.createdAt)}):`,
    ];
    lines.push(`Task: ${ho.task}`);
    if (ho.completed.length) {
      lines.push("Completed:", bulletList(ho.completed, budget));
    }
    if (ho.remaining.length) {
      lines.push("Remaining:", bulletList(ho.remaining, budget));
    }
    if (ho.problems.length) {
      lines.push("Known problems:", bulletList(ho.problems, budget));
    }
    lines.push(`Recommended next action: ${ho.nextAction}`);
    sections.push(lines.join("\n"));
  }

  // Active problems (not already in handoff)
  const handoffProblems = new Set(ho?.problems ?? []);
  const extraProblems = input.activeProblems.filter(
    (p) => !handoffProblems.has(p.content),
  );
  if (extraProblems.length) {
    sections.push(
      `Active problems:\n${bulletList(
        extraProblems.map((p) => p.content),
        budget,
      )}`,
    );
  }

  // Important decisions
  if (input.importantDecisions.length) {
    sections.push(
      `Important decisions:\n${bulletList(
        input.importantDecisions.map((d) => d.content),
        budget,
      )}`,
    );
  }

  // Architecture
  if (input.architecture.length) {
    sections.push(
      `Architecture notes:\n${bulletList(
        input.architecture.map((a) => a.content),
        budget,
      )}`,
    );
  }

  // Recent progress
  if (input.recentProgress.length) {
    sections.push(
      `Recent progress:\n${bulletList(
        input.recentProgress.map((p) => p.content),
        budget,
      )}`,
    );
  }

  // Other relevant memories
  const seen = new Set<string>([
    ...extraProblems.map((m) => m.id),
    ...input.architecture.map((m) => m.id),
    ...input.recentProgress.map((m) => m.id),
  ]);
  const other = input.relevantMemories
    .filter((m) => !seen.has(m.id))
    .slice(0, 5);
  if (other.length) {
    sections.push(
      `Other relevant memories:\n${bulletList(
        other.map((m) => `[${m.type}] ${m.content}`),
        budget,
      )}`,
    );
  }

  // Context summary last (lowest priority)
  if (input.context?.summary) {
    sections.push(`Summary: ${compressItem(input.context.summary, budget)}`);
  }

  return fitBudget(sections, budget);
}
