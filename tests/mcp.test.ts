import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { useTempMemoryHome, rmDir, initPlainWorkspace } from "./helpers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "dist", "index.js");

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

class McpClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private pending = new Map<number, (res: JsonRpcResponse) => void>();
  private nextId = 1;

  constructor(env: Record<string, string>) {
    this.child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            this.pending.get(msg.id)!(msg);
            this.pending.delete(msg.id);
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    });
  }

  request(method: string, params: any = {}): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }, 15_000);
      this.pending.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      this.child.stdin.write(payload + "\n");
    });
  }

  notify(method: string, params: any = {}): void {
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n",
    );
  }

  async close(): Promise<void> {
    this.child.kill();
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("MCP stdio server (integration)", () => {
  let home: string;
  let workspace: string;
  let cleanupWs: () => Promise<void>;
  let client: McpClient;

  beforeAll(async () => {
    home = await useTempMemoryHome("memhome-mcp");
    const ws = await initPlainWorkspace();
    workspace = ws.dir;
    cleanupWs = ws.cleanup;
    client = new McpClient({
      AGENT_MEMORY_HOME: home,
      // Never let the test server write to the real user's client configs.
      AGENT_MEMORY_NO_AUTO_SETUP: "1",
    });

    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1.0.0" },
    });
    expect(init.result.serverInfo.name).toBe("memory-manage-mcp");
    client.notify("notifications/initialized");
  });

  afterAll(async () => {
    await client.close();
    await cleanupWs();
    await rmDir(home);
  });

  it("lists all 16 tools", async () => {
    const res = await client.request("tools/list");
    const names = res.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(
      [
        "clear_memory",
        "create_handoff",
        "delete_project_memory",
        "finish_session",
        "get_current_task",
        "get_decisions",
        "get_latest_handoff",
        "get_memory",
        "get_project_context",
        "initialize_project_context",
        "record_decision",
        "save_memory",
        "save_session_digest",
        "search_memory",
        "start_session",
        "update_task",
      ].sort(),
    );
  });

  it("initialize_project_context returns a briefing and registers the project", async () => {
    const res = await client.request("tools/call", {
      name: "initialize_project_context",
      arguments: { workspacePath: workspace, agentId: "vitest" },
    });
    expect(res.result.isError).toBeFalsy();
    const text = res.result.content[0].text as string;
    expect(text).toContain("PROJECT:");
    expect(text).toContain("[projectId: proj_");
  });

  it("full agent workflow: session -> memory -> decision -> task -> handoff", async () => {
    const call = async (name: string, args: any) => {
      const res = await client.request("tools/call", { name, arguments: args });
      expect(res.result.isError).toBeFalsy();
      return JSON.parse(res.result.content[0].text);
    };

    const session = await call("start_session", {
      workspacePath: workspace,
      agentId: "vitest",
      agentName: "Vitest",
    });
    expect(session.sessionId).toMatch(/^sess_/);

    const memory = await call("save_memory", {
      workspacePath: workspace,
      type: "decision",
      content: "Use PostgreSQL for persistence",
      importance: 0.9,
    });
    expect(memory.id).toMatch(/^mem_/);

    const decision = await call("record_decision", {
      workspacePath: workspace,
      content: "Adopt event sourcing for the audit log",
      importance: 0.85,
    });
    expect(decision.id).toMatch(/^dec_/);

    const task = await call("update_task", {
      workspacePath: workspace,
      title: "Implement audit log",
      status: "in_progress",
    });
    expect(task.id).toMatch(/^task_/);

    const current = await call("get_current_task", {
      workspacePath: workspace,
    });
    expect(current.currentTask.title).toBe("Implement audit log");

    const search = await call("search_memory", {
      workspacePath: workspace,
      query: "audit",
    });
    expect(Array.isArray(search)).toBe(true);
    expect(search.length).toBeGreaterThan(0);

    const handoff = await call("create_handoff", {
      workspacePath: workspace,
      agentId: "vitest",
      task: "Implement audit log",
      completed: ["Schema designed"],
      remaining: ["Write event store"],
      problems: [],
      changedFiles: [],
      nextAction: "Write event store module",
    });
    expect(handoff.id).toMatch(/^ho_/);

    const latest = await call("get_latest_handoff", {
      workspacePath: workspace,
    });
    expect(latest.nextAction).toBe("Write event store module");

    const digest = await call("save_session_digest", {
      workspacePath: workspace,
      sessionId: session.sessionId,
      agentId: "vitest",
      digest:
        "Discussed audit log design. Decided on event sourcing with PostgreSQL. Schema designed; event store module left to write next.",
    });
    expect(digest.saved).toBe(true);

    const finished = await call("finish_session", {
      workspacePath: workspace,
      sessionId: session.sessionId,
      summary: "Designed audit log schema",
    });
    expect(finished.status).toBe("completed");

    // A second "agent" picks up the project and sees the handoff + digest.
    const briefingRes = await client.request("tools/call", {
      name: "initialize_project_context",
      arguments: { workspacePath: workspace, agentId: "other-agent" },
    });
    expect(briefingRes.result.isError).toBeFalsy();
    const briefingText = briefingRes.result.content[0].text as string;
    expect(briefingText).toContain("Write event store module");
    expect(briefingText).toContain("PREVIOUS CONVERSATION");
    expect(briefingText).toContain("event sourcing with PostgreSQL");
  });

  it("rejects invalid tool input", async () => {
    const res = await client.request("tools/call", {
      name: "save_memory",
      arguments: { workspacePath: workspace, type: "not-a-type", content: "x" },
    });
    expect(res.result.isError).toBe(true);
  });
});
