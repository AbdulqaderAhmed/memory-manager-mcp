#!/usr/bin/env node
/**
 * memory-mcp CLI — management and debugging utilities.
 *
 *   memory-mcp projects                 list known projects
 *   memory-mcp project current          detect project for the current dir
 *   memory-mcp project inspect [id]     inspect a project's memory
 *   memory-mcp memory search <query>    search memories
 *   memory-mcp handoff latest           show latest handoff (current project)
 *   memory-mcp sessions                 list sessions (current project)
 *   memory-mcp doctor                   run diagnostics
 *   memory-mcp clear --all --yes        delete ALL memory (dangerous)
 *
 * Options:
 *   --workspace <dir>   workspace to operate on (default: cwd)
 *   --json              machine-readable output
 */
import { MemoryService } from "../service.js";
import { detectProject } from "../project/detector.js";
import { runDoctor, formatDoctorReport } from "./doctor.js";
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
  const service = new MemoryService();
  const [cmd, sub] = args.command;

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
          console.error("Usage: memory-mcp memory search <query>");
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

    case "clear": {
      const all = args.flags.get("all") === true;
      const yes = args.flags.get("yes") === true;
      if (!all || !yes) {
        console.error("This deletes ALL memory for ALL projects.");
        console.error("Run: memory-mcp clear --all --yes");
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

const USAGE = `memory-mcp — local-first memory for AI coding agents

Usage:
  memory-mcp projects                     List known projects
  memory-mcp project current              Detect project for the current directory
  memory-mcp project inspect [id]         Inspect a project's stored memory
  memory-mcp memory search <query>        Search memories of the current project
  memory-mcp handoff latest               Show the latest handoff
  memory-mcp sessions                     List sessions of the current project
  memory-mcp doctor                       Run installation diagnostics
  memory-mcp clear --all --yes            Delete ALL memory (dangerous)

Options:
  --workspace <dir>   Operate on a specific workspace (default: cwd)
  --json              Machine-readable JSON output
`;

main().catch((err) => {
  console.error("memory-mcp CLI error:", err);
  process.exit(1);
});
