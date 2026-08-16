#!/usr/bin/env node
/**
 * memory-manage-mcp CLI — management and debugging utilities.
 *
 *   memory-manage-mcp projects                 list known projects
 *   memory-manage-mcp project current          detect project for the current dir
 *   memory-manage-mcp project inspect [id]     inspect a project's memory
 *   memory-manage-mcp memory search <query>    search memories
 *   memory-manage-mcp handoff latest           show latest handoff (current project)
 *   memory-manage-mcp sessions                 list sessions (current project)
 *   memory-manage-mcp doctor                   run diagnostics
 *   memory-manage-mcp setup                    auto-configure installed AI clients
 *   memory-manage-mcp uninstall                remove the server from client configs
 *   memory-manage-mcp clear --all --yes        delete ALL memory (dangerous)
 *
 * Options:
 *   --workspace <dir>   workspace to operate on (default: cwd)
 *   --json              machine-readable output
 */
import { MemoryService } from "../service.js";
import { detectProject } from "../project/detector.js";
import { runDoctor, formatDoctorReport } from "./doctor.js";
import {
  runSetup,
  runUninstall,
  formatSetupReport,
  formatUninstallReport,
} from "./setup.js";
import { relativeTime } from "../util.js";

interface ParsedArgs {
  command: string[];
  flags: Map<string, string | boolean>;
  positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  const command: string[] = [];

  let i = 0;
  // Collect command words until first flag or quoted argument.
  while (i < argv.length && !argv[i].startsWith("-") && command.length < 2) {
    command.push(argv[i]);
    i += 1;
  }
  for (; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      // Short flags, e.g. -h.
      flags.set(arg.slice(1), true);
    } else {
      positional.push(arg);
    }
  }
  return { command, flags, positional };
}

function print(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
  } else if (typeof value === "string") {
    console.log(value);
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
}

async function resolveProject(service: MemoryService, workspace?: string) {
  const detection = await detectProject(workspace);
  const project = await service.store.getProject(detection.projectId);
  return { detection, project };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const json = args.flags.get("json") === true;
  const workspace =
    typeof args.flags.get("workspace") === "string"
      ? (args.flags.get("workspace") as string)
      : undefined;
  const [cmd, sub] = args.command;

  // --help / -h / help — show help for a specific command, or the overview.
  const wantsHelp =
    args.flags.get("help") === true ||
    args.flags.get("h") === true ||
    cmd === "help";
  if (wantsHelp) {
    const topic = cmd === "help" ? (sub ?? args.positional[0]) : cmd;
    console.log(commandHelp(topic));
    return;
  }

  const service = new MemoryService();

  switch (cmd) {
    case "projects": {
      const projects = await service.store.listProjects();
      if (json) return print(projects, true);
      if (projects.length === 0) {
        console.log("No projects registered yet.");
        return;
      }
      for (const p of projects) {
        console.log(
          `${p.name}  [${p.id}]  ${p.identity.kind}  last activity ${relativeTime(p.lastActivityAt)}`,
        );
        console.log(`    canonical: ${p.identity.canonical}`);
        console.log(`    paths: ${p.localPaths.join(", ")}`);
      }
      return;
    }

    case "project": {
      if (sub === "current") {
        const detection = await detectProject(workspace);
        const existing = await service.store.getProject(detection.projectId);
        return print(
          json
            ? { detection, registered: Boolean(existing) }
            : [
                `Workspace:  ${detection.workspacePath}`,
                `Identity:   ${detection.identity.kind}`,
                `Canonical:  ${detection.identity.canonical}`,
                `Project ID: ${detection.projectId}`,
                `Registered: ${existing ? "yes" : "no (will be auto-registered on first use)"}`,
                detection.git
                  ? `Git:        branch=${detection.git.branch ?? "?"} remote=${detection.git.remoteUrl ?? "none"}`
                  : "Git:        not a repository",
              ].join("\n"),
          json,
        );
      }
      if (sub === "inspect") {
        const targetId = args.positional[0];
        const { detection, project } = targetId
          ? {
              detection: null,
              project: await service.store.getProject(targetId),
            }
          : await resolveProject(service, workspace);
        if (!project) {
          console.error(
            targetId
              ? `Project not found: ${targetId}`
              : "No project detected/registered.",
          );
          process.exitCode = 1;
          return;
        }
        const [context, tasks, decisions, memories, sessions, handoff] =
          await Promise.all([
            service.store.getContext(project.id),
            service.store.getTasks(project.id),
            service.store.getDecisions(project.id),
            service.store.getMemories(project.id),
            service.store.listSessions(project.id),
            service.store.getLatestHandoff(project.id),
          ]);
        return print(
          json
            ? {
                project,
                context,
                tasks,
                decisions,
                memories,
                sessions,
                latestHandoff: handoff,
              }
            : [
                `Project: ${project.name} [${project.id}]`,
                `Identity: ${project.identity.kind} — ${project.identity.canonical}`,
                `Created: ${project.createdAt}  Last activity: ${relativeTime(project.lastActivityAt)}`,
                "",
                `Context: ${context ? `${context.status}${context.currentTask ? ` — current task: ${context.currentTask}` : ""}` : "none"}`,
                `Tasks: ${tasks.length} (${tasks.filter((t) => t.status === "in_progress" || t.status === "active").length} open)`,
                `Decisions: ${decisions.length}`,
                `Memories: ${memories.length}`,
                `Sessions: ${sessions.length} (${sessions.filter((s) => s.status === "active").length} active)`,
                `Latest handoff: ${handoff ? `${handoff.task} (${relativeTime(handoff.createdAt)})` : "none"}`,
              ].join("\n"),
          json,
        );
      }
      break;
    }

    case "memory": {
      if (sub === "search") {
        const query = args.positional.join(" ");
        if (!query) {
          console.error("Usage: memory-manage-mcp memory search <query>");
          process.exitCode = 1;
          return;
        }
        const { project } = await resolveProject(service, workspace);
        const results = await service.searcher.search({
          query,
          projectId: project?.id,
        });
        if (json) return print(results, true);
        if (results.length === 0) {
          console.log("No results.");
          return;
        }
        for (const r of results) {
          console.log(
            `[${r.score.toFixed(2)}] (${r.source}) ${r.label}: ${r.snippet}`,
          );
        }
        return;
      }
      break;
    }

    case "handoff": {
      if (sub === "latest") {
        const { project } = await resolveProject(service, workspace);
        if (!project) {
          console.error("No registered project for this workspace.");
          process.exitCode = 1;
          return;
        }
        const handoff = await service.store.getLatestHandoff(project.id);
        if (!handoff) {
          console.log("No handoff found.");
          return;
        }
        return print(handoff, json);
      }
      break;
    }

    case "sessions": {
      const { project } = await resolveProject(service, workspace);
      if (!project) {
        console.error("No registered project for this workspace.");
        process.exitCode = 1;
        return;
      }
      const sessions = await service.store.listSessions(project.id);
      if (json) return print(sessions, true);
      if (sessions.length === 0) {
        console.log("No sessions recorded.");
        return;
      }
      for (const s of sessions) {
        console.log(
          `${s.sessionId}  ${s.agentId}  ${s.status}  started ${relativeTime(s.startedAt)}${s.endedAt ? `, ended ${relativeTime(s.endedAt)}` : ""}`,
        );
        if (s.summary) console.log(`    ${s.summary}`);
      }
      return;
    }

    case "doctor": {
      const report = await runDoctor({ workspacePath: workspace });
      if (json) return print(report, true);
      console.log(formatDoctorReport(report));
      if (!report.allOk) process.exitCode = 1;
      return;
    }

    case "setup": {
      const clientFlag = args.flags.get("client");
      const results = await runSetup({
        client: typeof clientFlag === "string" ? clientFlag : undefined,
        force: args.flags.get("force") === true,
        dryRun: args.flags.get("dry-run") === true,
      });
      if (json) return print(results, true);
      console.log(
        formatSetupReport(results, args.flags.get("dry-run") === true),
      );
      if (results.some((r) => r.status === "failed")) process.exitCode = 1;
      return;
    }

    case "uninstall": {
      const clientFlag = args.flags.get("client");
      const results = await runUninstall(
        typeof clientFlag === "string" ? clientFlag : undefined,
      );
      if (json) return print(results, true);
      console.log(formatUninstallReport(results));
      return;
    }

    case "clear": {
      const all = args.flags.get("all") === true;
      const yes = args.flags.get("yes") === true;
      if (!all || !yes) {
        console.error("This deletes ALL memory for ALL projects.");
        console.error("Run: memory-manage-mcp clear --all --yes");
        process.exitCode = 1;
        return;
      }
      await service.clearAllMemory();
      console.log("All memory cleared.");
      return;
    }

    default:
      break;
  }

  console.log(USAGE);
  if (!cmd) process.exitCode = 0;
  else process.exitCode = 1;
}

const USAGE = `memory-manage-mcp — local-first memory for AI coding agents

Usage:
  memory-manage-mcp projects                     List known projects
  memory-manage-mcp project current              Detect project for the current directory
  memory-manage-mcp project inspect [id]         Inspect a project's stored memory
  memory-manage-mcp memory search <query>        Search memories of the current project
  memory-manage-mcp handoff latest               Show the latest handoff
  memory-manage-mcp sessions                     List sessions of the current project
  memory-manage-mcp doctor                       Run installation diagnostics
  memory-manage-mcp setup [--client <id>] [--force] [--dry-run]
                                                 Auto-configure installed AI clients
  memory-manage-mcp uninstall [--client <id>]    Remove the memory server from client configs
  memory-manage-mcp clear --all --yes            Delete ALL memory (dangerous)

Options:
  --workspace <dir>   Operate on a specific workspace (default: cwd)
  --json              Machine-readable JSON output
  -h, --help          Show help (also: memory-manage-mcp help <command>)
`;

const COMMAND_HELP: Record<string, string> = {
  projects: `memory-manage-mcp projects [--json]

List every project the memory server knows about, with its stable project id,
identity source (git remote / .agent-memory.json / path), canonical identity
string and all local paths that map to it.

Options:
  --json   Machine-readable JSON output`,

  project: `memory-manage-mcp project <subcommand>

Subcommands:
  current            Detect which project the current (or --workspace) directory
                     resolves to: identity kind, canonical string, project id,
                     registration state and git info.
  inspect [id]       Show a summary of a project's stored memory: context,
                     task/decision/memory/session counts and the latest handoff.
                     Without [id], inspects the project of the current directory.

Options:
  --workspace <dir>  Operate on a specific workspace (default: cwd)
  --json             Machine-readable JSON output

Examples:
  memory-manage-mcp project current
  memory-manage-mcp project inspect proj_abc123 --json`,

  memory: `memory-manage-mcp memory search <query> [--workspace <dir>] [--json]

Ranked keyword search across the current project's memories, tasks,
decisions, handoffs, session summaries and context. Each result shows its
score, source and a snippet.

Example:
  memory-manage-mcp memory search "employee permission"`,

  handoff: `memory-manage-mcp handoff latest [--workspace <dir>] [--json]

Print the most recent handoff for the project of the current directory:
what was completed, what remains, known problems, changed files and the
recommended next action.`,

  sessions: `memory-manage-mcp sessions [--workspace <dir>] [--json]

List all agent working sessions recorded for the project of the current
directory, with agent id, status, start/end times and summaries.`,

  doctor: `memory-manage-mcp doctor [--json]

Run installation diagnostics: Node.js version, storage directory and file
permissions, config file, storage integrity, project detection for the
current workspace, git availability, and which AI clients the server is
registered in. Exits non-zero if any check fails.

This is the first thing to run when something seems off, and the way to
confirm the server is functioning (see the "Client registration" check).`,

  setup: `memory-manage-mcp setup [--client <id>] [--force] [--dry-run] [--json]

Detect every supported AI client installed on this machine and register the
memory server (as "manager-mcp") in each client's MCP config. Only installed
clients are touched; existing configs are backed up (.bak) and written
atomically. Entries left under the old "memory" key are migrated automatically.

Supported client ids: vscode, cursor, claude-desktop, claude-code,
antigravity, gemini-cli, windsurf, codex

Options:
  --client <id>   Configure a single client only
  --force         Configure even if the client is not detected as installed
  --dry-run       Show what would change without writing anything
  --json          Machine-readable JSON report

Examples:
  memory-manage-mcp setup
  memory-manage-mcp setup --dry-run
  memory-manage-mcp setup --client cursor --force`,

  uninstall: `memory-manage-mcp uninstall [--client <id>] [--json]

Remove the memory server entry (both "manager-mcp" and the legacy "memory"
key) from all client configs, or from a single client with --client <id>.
Config files are backed up (.bak) before modification. Your stored memory
under ~/.agent-memory/ is NOT deleted — use "clear" for that.`,

  clear: `memory-manage-mcp clear --all --yes

Permanently delete ALL stored memory for ALL projects under ~/.agent-memory/.
Both --all and --yes are required as a safety guard. This cannot be undone.`,
};

function commandHelp(topic: string | undefined): string {
  if (!topic) return USAGE;
  const help = COMMAND_HELP[topic];
  if (help)
    return `${help}\n\nGlobal options:\n  --workspace <dir>   Operate on a specific workspace (default: cwd)\n  --json              Machine-readable JSON output\n  -h, --help          Show help`;
  return `Unknown command: ${topic}\n\n${USAGE}`;
}

main().catch((err) => {
  console.error("memory-manage-mcp CLI error:", err);
  process.exit(1);
});
