import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { useTempMemoryHome, rmDir } from "./helpers.js";
import { FileSystemMemoryStore } from "../src/storage/filesystem.js";
import { getMemoryRoot, getContextFile } from "../src/storage/paths.js";
import { atomicWriteFile, readJsonl, withLock } from "../src/storage/fsutil.js";
import type { Memory, Project, Handoff, Session } from "../src/types.js";

function makeProject(id: string): Project {
  const now = new Date().toISOString();
  return {
    id,
    name: id,
    identity: { kind: "path", canonical: `path:/tmp/${id}` },
    localPaths: [`/tmp/${id}`],
    createdAt: now,
    lastActivityAt: now,
    memoryVersion: 1,
  };
}

function makeMemory(projectId: string, id: string, content: string): Memory {
  const now = new Date().toISOString();
  return {
    id,
    projectId,
    type: "fact",
    content,
    importance: 0.5,
    confidence: 0.5,
    createdAt: now,
    updatedAt: now,
  };
}

describe("FileSystemMemoryStore", () => {
  let home: string;
  let store: FileSystemMemoryStore;

  beforeAll(async () => {
    home = await useTempMemoryHome();
    store = new FileSystemMemoryStore(getMemoryRoot());
  });

  afterAll(async () => {
    await rmDir(home);
  });

  it("creates, reads, updates and deletes projects", async () => {
    const project = makeProject("proj_crud");
    await store.saveProject(project);
    expect(await store.getProject("proj_crud")).toMatchObject({
      id: "proj_crud",
    });

    project.name = "renamed";
    await store.saveProject(project);
    expect((await store.getProject("proj_crud"))?.name).toBe("renamed");

    expect((await store.listProjects()).some((p) => p.id === "proj_crud")).toBe(
      true,
    );
    await store.deleteProject("proj_crud");
    expect(await store.getProject("proj_crud")).toBeNull();
  });

  it("saves and retrieves memories, updating by id", async () => {
    const project = makeProject("proj_mem");
    await store.saveProject(project);

    const m1 = makeMemory("proj_mem", "mem_1", "first");
    await store.saveMemory(m1);
    expect((await store.getMemories("proj_mem")).map((m) => m.content)).toEqual(
      ["first"],
    );

    // Update same id -> single memory with new content.
    const m1b = {
      ...m1,
      content: "first-updated",
      updatedAt: new Date().toISOString(),
    };
    await store.saveMemory(m1b);
    const memories = await store.getMemories("proj_mem");
    expect(memories.length).toBe(1);
    expect(memories[0].content).toBe("first-updated");

    // Delete via tombstone.
    expect(await store.deleteMemory("proj_mem", "mem_1")).toBe(true);
    expect(await store.getMemories("proj_mem")).toHaveLength(0);
    expect(await store.deleteMemory("proj_mem", "mem_missing")).toBe(false);
  });

  it("filters memories by type, importance and since", async () => {
    const project = makeProject("proj_filter");
    await store.saveProject(project);
    const base = makeMemory("proj_filter", "mem_a", "a");
    await store.saveMemory({
      ...base,
      id: "mem_a",
      type: "decision",
      importance: 0.9,
    });
    await store.saveMemory({
      ...base,
      id: "mem_b",
      type: "fact",
      importance: 0.2,
    });

    const decisions = await store.getMemories("proj_filter", {
      types: ["decision"],
    });
    expect(decisions).toHaveLength(1);
    const important = await store.getMemories("proj_filter", {
      minImportance: 0.5,
    });
    expect(important).toHaveLength(1);
    expect(important[0].id).toBe("mem_a");
  });

  it("saves tasks with read-modify-write semantics", async () => {
    const project = makeProject("proj_task");
    await store.saveProject(project);
    const now = new Date().toISOString();
    await store.saveTask({
      id: "task_1",
      projectId: "proj_task",
      title: "one",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await store.saveTask({
      id: "task_2",
      projectId: "proj_task",
      title: "two",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    expect(await store.getTasks("proj_task")).toHaveLength(2);

    await store.saveTask({
      id: "task_1",
      projectId: "proj_task",
      title: "one-updated",
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    const tasks = await store.getTasks("proj_task");
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.id === "task_1")?.title).toBe("one-updated");

    expect(await store.deleteTask("proj_task", "task_2")).toBe(true);
    expect(await store.getTasks("proj_task")).toHaveLength(1);
  });

  it("saves decisions and sessions", async () => {
    const project = makeProject("proj_ds");
    await store.saveProject(project);
    const now = new Date().toISOString();

    await store.saveDecision({
      id: "dec_1",
      projectId: "proj_ds",
      content: "use RBAC",
      importance: 0.9,
      confidence: 0.9,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    expect(await store.getDecisions("proj_ds")).toHaveLength(1);

    const session: Session = {
      sessionId: "sess_1",
      projectId: "proj_ds",
      agentId: "test",
      startedAt: now,
      status: "active",
    };
    await store.saveSession(session);
    expect((await store.getSession("proj_ds", "sess_1"))?.agentId).toBe("test");
    expect(await store.listSessions("proj_ds")).toHaveLength(1);
  });

  it("saves handoffs to latest and history", async () => {
    const project = makeProject("proj_ho");
    await store.saveProject(project);
    const mk = (id: string, createdAt: string): Handoff => ({
      id,
      projectId: "proj_ho",
      agentId: "test",
      task: "task",
      completed: [],
      remaining: ["x"],
      problems: [],
      changedFiles: [],
      nextAction: "do it",
      createdAt,
    });
    await store.saveHandoff(mk("ho_1", "2026-01-01T00:00:00.000Z"));
    await store.saveHandoff(mk("ho_2", "2026-01-02T00:00:00.000Z"));

    expect((await store.getLatestHandoff("proj_ho"))?.id).toBe("ho_2");
    const history = await store.getHandoffHistory("proj_ho");
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe("ho_2"); // newest first
  });

  it("clearMemories removes only the memory log", async () => {
    const project = makeProject("proj_clear");
    await store.saveProject(project);
    await store.saveMemory(makeMemory("proj_clear", "mem_x", "x"));
    await store.saveContext({
      projectId: "proj_clear",
      name: "clear",
      technology: [],
      status: "unknown",
      lastUpdated: new Date().toISOString(),
    });
    await store.clearMemories("proj_clear");
    expect(await store.getMemories("proj_clear")).toHaveLength(0);
    expect(await store.getContext("proj_clear")).not.toBeNull();
  });
});

describe("crash safety and concurrency primitives", () => {
  let home: string;

  beforeAll(async () => {
    home = await useTempMemoryHome("memhome-fsutil");
  });

  afterAll(async () => {
    await rmDir(home);
  });

  it("atomicWriteFile leaves no temp files and writes content", async () => {
    const target = path.join(home, "atomic", "file.json");
    await atomicWriteFile(target, '{"ok":true}');
    const content = await fs.readFile(target, "utf8");
    expect(content).toBe('{"ok":true}');
    const leftovers = (await fs.readdir(path.dirname(target))).filter((f) =>
      f.endsWith(".tmp"),
    );
    expect(leftovers).toHaveLength(0);
  });

  it("readJsonl skips corrupt/partial trailing lines", async () => {
    const file = path.join(home, "partial.jsonl");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      `${JSON.stringify({ id: 1 })}\n${JSON.stringify({ id: 2 })}\n{"id":3,"trunc`,
      "utf8",
    );
    const entries = await readJsonl<{ id: number }>(file);
    expect(entries.map((e) => e.id)).toEqual([1, 2]);
  });

  it("withLock serializes concurrent read-modify-write updates", async () => {
    const lockPath = path.join(home, "lock", ".lock");
    const counterPath = path.join(home, "lock", "counter.json");
    await fs.mkdir(path.dirname(counterPath), { recursive: true });
    await fs.writeFile(counterPath, "0", "utf8");

    const increment = () =>
      withLock(lockPath, async () => {
        const value = Number(await fs.readFile(counterPath, "utf8"));
        await new Promise((r) => setTimeout(r, 5));
        await fs.writeFile(counterPath, String(value + 1), "utf8");
      });

    await Promise.all(Array.from({ length: 10 }, increment));
    expect(Number(await fs.readFile(counterPath, "utf8"))).toBe(10);
  });

  it("concurrent memory appends do not lose entries", async () => {
    const store = new FileSystemMemoryStore(getMemoryRoot());
    const project = makeProject("proj_conc");
    await store.saveProject(project);

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.saveMemory(makeMemory("proj_conc", `mem_c${i}`, `content ${i}`)),
      ),
    );
    const memories = await store.getMemories("proj_conc");
    expect(memories).toHaveLength(20);
  });

  it("recovers gracefully from a corrupt JSON document", async () => {
    const store = new FileSystemMemoryStore(getMemoryRoot());
    const project = makeProject("proj_corrupt");
    await store.saveProject(project);
    const contextFile = getContextFile("proj_corrupt", getMemoryRoot());
    await fs.writeFile(contextFile, "{not valid json", "utf8");
    expect(await store.getContext("proj_corrupt")).toBeNull();
    // Store remains usable.
    await store.saveMemory(makeMemory("proj_corrupt", "mem_ok", "still works"));
    expect(await store.getMemories("proj_corrupt")).toHaveLength(1);
  });
});
