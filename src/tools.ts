/**
 * MCP tool layer.
 *
 * A deliberately small, clean tool surface:
 *
 *   initialize_project_context  — the main entry point for a new agent
 *   get_project_context         — refresh the briefing
 *   search_memory / get_memory / save_memory
 *   get_current_task / update_task
 *   record_decision / get_decisions
 *   create_handoff / get_latest_handoff
 *   start_session / finish_session
 *   delete_project_memory / clear_memory
 *
 * Every tool accepts an optional `workspacePath`; when omitted the server
 * falls back to AGENT_MEMORY_WORKSPACE or the process cwd.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryService } from './service.js';
import { MEMORY_TYPES, TASK_STATUSES } from './types.js';
import { getGitInfo } from './git/gitService.js';

type ToolResult = { content: Array<{ type: 'text'; text: string }> };

function text(value: unknown): ToolResult {
  const rendered = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text: rendered }] };
}

function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: `Error: ${message}` }] };
}

const workspaceArg = z
  .string()
  .optional()
  .describe('Workspace directory of the project. Defaults to the server working directory.');

const agentIdArg = z
  .string()
  .optional()
  .describe('Identifier of the calling agent/client, e.g. "cursor", "vscode", "claude-cli".');

export function registerTools(server: McpServer, service: MemoryService): void {
  // ---------------------------------------------------------------------
  // initialize_project_context
  // ---------------------------------------------------------------------
  server.registerTool(
    'initialize_project_context',
    {
      title: 'Initialize project context',
      description:
        'Call this FIRST when starting work. Detects the current project (via git remote, .agent-memory.json or path), auto-registers it, and returns a compact briefing: current task, latest handoff, completed/remaining work, known problems, important decisions and recommended next action. Use it to continue work started by another agent or IDE.',
      inputSchema: {
        workspacePath: workspaceArg,
        agentId: agentIdArg,
        focus: z.string().optional().describe('Optional focus topic to bias memory selection.'),
      },
    },
    async ({ workspacePath, agentId, focus }) => {
      try {
        const result = await service.initializeContext(workspacePath, { focus });
        if (agentId) {
          await service.memoryManager.updateContext({
            projectId: result.project.id,
            lastAgent: agentId,
          });
        }
        const parts = [result.briefing];
        if (result.isNew) {
          parts.push(
            '\n(This project was just registered — no previous memory exists yet. Save important decisions and create a handoff before finishing.)',
          );
        }
        parts.push(`\n[projectId: ${result.project.id}]`);
        return text(parts.join('\n'));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // get_project_context
  // ---------------------------------------------------------------------
  server.registerTool(
    'get_project_context',
    {
      title: 'Get project context',
      description:
        'Returns the stored compact project context (name, technology, current task, status, summary, last agent). Lighter than initialize_project_context.',
      inputSchema: { workspacePath: workspaceArg },
    },
    async ({ workspacePath }) => {
      try {
        const { project } = await service.detectAndRegister(workspacePath);
        const context = await service.memoryManager.getContext(project.id);
        return text(context ?? { projectId: project.id, note: 'No context stored yet.' });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // save_memory
  // ---------------------------------------------------------------------
  server.registerTool(
    'save_memory',
    {
      title: 'Save memory',
      description:
        'Save a curated memory for the current project. Use for decisions, requirements, architecture, tasks, problems, solutions, progress, facts, preferences, constraints and discoveries. Do NOT save raw conversation text — save distilled, useful information.',
      inputSchema: {
        workspacePath: workspaceArg,
        type: z.enum(MEMORY_TYPES).describe('Memory type.'),
        content: z.string().describe('The distilled information to remember.'),
        importance: z.number().min(0).max(1).optional().describe('0..1, default 0.5.'),
        confidence: z.number().min(0).max(1).optional().describe('0..1, default 0.7.'),
        source: z.string().optional().describe('Where this came from, e.g. "user", "debugging".'),
        agentId: agentIdArg,
        sessionId: z.string().optional(),
        tags: z.array(z.string()).optional(),
        id: z.string().optional().describe('Provide to update an existing memory.'),
      },
    },
    async (args) => {
      try {
        const { project } = await service.detectAndRegister(args.workspacePath);
        const memory = await service.memoryManager.saveMemory({
          ...args,
          projectId: project.id,
        });
        return text({ saved: true, id: memory.id, type: memory.type, projectId: project.id });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // get_memory
  // ---------------------------------------------------------------------
  server.registerTool(
    'get_memory',
    {
      title: 'Get memory',
      description: 'Retrieve a single memory by id.',
      inputSchema: {
        workspacePath: workspaceArg,
        memoryId: z.string().describe('Memory id (mem_...).'),
      },
    },
    async ({ workspacePath, memoryId }) => {
      try {
        const { project } = await service.detectAndRegister(workspacePath);
        const memory = await service.memoryManager.getMemory(project.id, memoryId);
        return text(memory ?? { found: false });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // search_memory
  // ---------------------------------------------------------------------
  server.registerTool(
    'search_memory',
    {
      title: 'Search memory',
      description:
        'Keyword search across memories, tasks, decisions, handoffs, session summaries and project context. Returns ranked results with scores.',
      inputSchema: {
        workspacePath: workspaceArg,
        query: z.string().describe('Search query, e.g. "employee permission".'),
        types: z.array(z.enum(MEMORY_TYPES)).optional().describe('Restrict to memory types.'),
        minImportance: z.number().min(0).max(1).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async (args) => {
      try {
        const { project } = await service.detectAndRegister(args.workspacePath);
        const { config } = await service.getConfig();
        const results = await service.searcher.search({
          query: args.query,
          projectId: project.id,
          types: args.types,
          minImportance: args.minImportance,
          limit: args.limit ?? config.search.maxResults,
        });
        return text(
          results.map((r) => ({
            source: r.source,
            id: r.id,
            label: r.label,
            score: Number(r.score.toFixed(3)),
            snippet: r.snippet,
          })),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // get_current_task
  // ---------------------------------------------------------------------
  server.registerTool(
    'get_current_task',
    {
      title: 'Get current task',
      description: 'Returns the most relevant open task for the project, plus other open tasks.',
      inputSchema: { workspacePath: workspaceArg },
    },
    async ({ workspacePath }) => {
      try {
        const { project } = await service.detectAndRegister(workspacePath);
        const current = await service.memoryManager.getCurrentTask(project.id);
        const all = await service.memoryManager.getTasks(project.id);
        const open = all.filter((t) => ['active', 'in_progress', 'blocked'].includes(t.status));
        return text({ currentTask: current, openTasks: open });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // update_task
  // ---------------------------------------------------------------------
  server.registerTool(
    'update_task',
    {
      title: 'Update or create task',
      description:
        'Create a task (omit taskId) or update an existing one (title, description, status, priority, related files). Statuses: active, in_progress, completed, blocked, abandoned.',
      inputSchema: {
        workspacePath: workspaceArg,
        taskId: z.string().optional().describe('Omit to create a new task.'),
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(TASK_STATUSES).optional(),
        priority: z.number().min(0).max(1).optional(),
        relatedFiles: z.array(z.string()).optional(),
        agentId: agentIdArg,
      },
    },
    async (args) => {
      try {
        const { project } = await service.detectAndRegister(args.workspacePath);
        if (args.taskId) {
          const task = await service.memoryManager.updateTask({
            projectId: project.id,
            taskId: args.taskId,
            title: args.title,
            description: args.description,
            status: args.status,
            priority: args.priority,
            relatedFiles: args.relatedFiles,
            agentId: args.agentId,
          });
          return text(task);
        }
        if (!args.title) return fail(new Error('title is required when creating a task'));
        const task = await service.memoryManager.createTask({
          projectId: project.id,
          title: args.title,
          description: args.description,
          status: args.status,
          priority: args.priority,
          relatedFiles: args.relatedFiles,
          agentId: args.agentId,
        });
        return text(task);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // record_decision
  // ---------------------------------------------------------------------
  server.registerTool(
    'record_decision',
    {
      title: 'Record decision',
      description:
        'Record an important project decision (optionally with rationale and rejected alternatives). Decisions stay relevant for a long time.',
      inputSchema: {
        workspacePath: workspaceArg,
        content: z.string().describe('The decision, e.g. "Use RBAC for employee permissions."'),
        rationale: z.string().optional(),
        alternatives: z.array(z.string()).optional(),
        importance: z.number().min(0).max(1).optional(),
        confidence: z.number().min(0).max(1).optional(),
        agentId: agentIdArg,
        sessionId: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const { project } = await service.detectAndRegister(args.workspacePath);
        const decision = await service.memoryManager.recordDecision({
          ...args,
          projectId: project.id,
        });
        return text(decision);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // get_decisions
  // ---------------------------------------------------------------------
  server.registerTool(
    'get_decisions',
    {
      title: 'Get decisions',
      description: 'List recorded decisions for the project (newest first).',
      inputSchema: {
        workspacePath: workspaceArg,
        activeOnly: z.boolean().optional().describe('Exclude superseded decisions.'),
      },
    },
    async ({ workspacePath, activeOnly }) => {
      try {
        const { project } = await service.detectAndRegister(workspacePath);
        const decisions = await service.memoryManager.getDecisions(project.id, activeOnly ?? true);
        return text(decisions);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // create_handoff
  // ---------------------------------------------------------------------
  server.registerTool(
    'create_handoff',
    {
      title: 'Create handoff',
      description:
        'Create a structured handoff BEFORE ending or pausing work, so the next agent (possibly in another IDE) can continue seamlessly. Include what was completed, what remains, known problems, changed files and the recommended next action.',
      inputSchema: {
        workspacePath: workspaceArg,
        agentId: agentIdArg,
        sessionId: z.string().optional(),
        task: z.string().describe('The task being handed off.'),
        completed: z.array(z.string()).optional(),
        remaining: z.array(z.string()).optional(),
        problems: z.array(z.string()).optional(),
        changedFiles: z.array(z.string()).optional(),
        nextAction: z.string().describe('Recommended next action for the next agent.'),
        notes: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const { project } = await service.detectAndRegister(args.workspacePath);
        const handoff = await service.handoffManager.createHandoff({
          ...args,
          agentId: args.agentId ?? 'unknown',
          projectId: project.id,
        });
        // Keep context in sync.
        await service.memoryManager.updateContext({
          projectId: project.id,
          currentTask: handoff.task,
          lastAgent: handoff.agentId,
          lastSession: handoff.sessionId,
          status: handoff.remaining.length > 0 ? 'in_progress' : 'completed',
        });
        return text(handoff);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // get_latest_handoff
  // ---------------------------------------------------------------------
  server.registerTool(
    'get_latest_handoff',
    {
      title: 'Get latest handoff',
      description: 'Retrieve the most recent handoff for the project.',
      inputSchema: {
        workspacePath: workspaceArg,
        history: z.boolean().optional().describe('Also include recent handoff history.'),
      },
    },
    async ({ workspacePath, history }) => {
      try {
        const { project } = await service.detectAndRegister(workspacePath);
        const latest = await service.handoffManager.getLatestHandoff(project.id);
        if (!latest) return text({ found: false, note: 'No handoff exists for this project yet.' });
        if (history) {
          const items = await service.handoffManager.getHistory(project.id, 5);
          return text({ latest, history: items });
        }
        return text(latest);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // start_session
  // ---------------------------------------------------------------------
  server.registerTool(
    'start_session',
    {
      title: 'Start session',
      description:
        'Start tracking an agent working session for the project. Call when beginning work; call finish_session when done.',
      inputSchema: {
        workspacePath: workspaceArg,
        agentId: agentIdArg,
        agentName: z.string().optional().describe('Human-friendly client name, e.g. "Cursor".'),
      },
    },
    async ({ workspacePath, agentId, agentName }) => {
      try {
        const { detection, project } = await service.detectAndRegister(workspacePath);
        const git = detection.git ?? (await getGitInfo(detection.workspacePath, { includeCommits: false }));
        const session = await service.sessionManager.startSession({
          projectId: project.id,
          agentId: agentId ?? 'unknown',
          agentName,
          branch: git?.branch,
          workingDirectory: detection.workspacePath,
        });
        await service.memoryManager.updateContext({
          projectId: project.id,
          lastAgent: session.agentId,
          lastSession: session.sessionId,
        });
        return text(session);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // finish_session
  // ---------------------------------------------------------------------
  server.registerTool(
    'finish_session',
    {
      title: 'Finish session',
      description:
        'Mark a session as finished. Statuses: completed, interrupted, abandoned. Include a short summary of what happened.',
      inputSchema: {
        workspacePath: workspaceArg,
        sessionId: z.string(),
        status: z
          .enum(['completed', 'interrupted', 'abandoned'])
          .optional()
          .describe('Final session status. Defaults to "completed".'),
        summary: z.string().optional(),
      },
    },
    async ({ workspacePath, sessionId, status, summary }) => {
      try {
        const { project } = await service.detectAndRegister(workspacePath);
        const session = await service.sessionManager.finishSession({
          projectId: project.id,
          sessionId,
          status: status ?? 'completed',
          summary,
        });
        return text(session);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // delete_project_memory
  // ---------------------------------------------------------------------
  server.registerTool(
    'delete_project_memory',
    {
      title: 'Delete project memory',
      description:
        'PERMANENTLY delete all stored memory for the current project. Requires confirm=true.',
      inputSchema: {
        workspacePath: workspaceArg,
        confirm: z.boolean().describe('Must be true to actually delete.'),
      },
    },
    async ({ workspacePath, confirm }) => {
      try {
        if (!confirm) {
          return text({
            deleted: false,
            note: 'Set confirm=true to permanently delete all memory for this project.',
          });
        }
        const { project } = await service.detectAndRegister(workspacePath);
        await service.deleteProjectMemory(project.id);
        return text({ deleted: true, projectId: project.id });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // clear_memory
  // ---------------------------------------------------------------------
  server.registerTool(
    'clear_memory',
    {
      title: 'Clear all memory',
      description:
        'PERMANENTLY delete ALL memory for ALL projects. Requires confirm=true and the phrase "delete everything" in confirmPhrase.',
      inputSchema: {
        confirm: z.boolean().describe('Must be true to actually delete.'),
        confirmPhrase: z
          .string()
          .describe('Must be exactly "delete everything" to proceed.'),
      },
    },
    async ({ confirm, confirmPhrase }) => {
      try {
        if (!confirm || confirmPhrase.trim().toLowerCase() !== 'delete everything') {
          return text({
            cleared: false,
            note: 'Requires confirm=true and confirmPhrase="delete everything".',
          });
        }
        await service.clearAllMemory();
        return text({ cleared: true });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

/** Human-readable footer used by the server instructions. */
export function agentGuidanceFooter(): string {
  return [
    'Recommended agent workflow:',
    '1. On start: call initialize_project_context.',
    '2. Continue existing work when appropriate (check latest handoff + current task).',
    '3. Save important decisions and discoveries with save_memory / record_decision.',
    '4. Track tasks with update_task.',
    '5. Before ending: create a handoff with create_handoff and finish_session.',
  ].join('\n');
}
