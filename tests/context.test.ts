import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  useTempMemoryHome,
  rmDir,
  initPlainWorkspace,
  initGitRepo,
  git,
} from "./helpers.js";
import { MemoryService } from "../src/service.js";

describe("sessions and handoffs", () => {
  let home: string;
  let service: MemoryService;
  let workspace: string;
  let cleanupWs: () => Promise<void>;

  beforeAll(async () => {
    home = await useTempMemoryHome("memhome-handoff");
    service = new MemoryService();
    const ws = await initPlainWorkspace();
    workspace = ws.dir;
    cleanupWs = ws.cleanup;
  });

  afterAll(async () => {
    await cleanupWs();
    await rmDir(home);
  });

  it("starts and finishes sessions", async () => {
    const { project } = await service.detectAndRegister(workspace);
    const session = await service.sessionManager.startSession({
      projectId: project.id,
      agentId: "vscode",
      agentName: "VS Code",
    });
    expect(session.status).toBe("active");
    expect(
      (await service.sessionManager.getActiveSessions(project.id)).length,
    ).toBe(1);

    const finished = await service.sessionManager.finishSession({
      projectId: project.id,
      sessionId: session.sessionId,
      status: "completed",
      summary: "Implemented leave API",
    });
    expect(finished.status).toBe("completed");
    expect(finished.endedAt).toBeTruthy();
    expect(finished.summary).toBe("Implemented leave API");
    expect(
      (await service.sessionManager.getActiveSessions(project.id)).length,
    ).toBe(0);
  });

  it("creates handoffs with latest + history", async () => {
    const { project } = await service.detectAndRegister(workspace);

    const first = await service.handoffManager.createHandoff({
      projectId: project.id,
      agentId: "vscode",
      task: "Employee Leave Management",
      completed: ["Leave API implemented"],
      remaining: ["Finish approval UI", "Add tests"],
      problems: ["Approval modal does not refresh correctly"],
      changedFiles: ["app/leave/page.tsx"],
      nextAction: "Fix approval modal state refresh",
    });
    await new Promise((r) => setTimeout(r, 10));
    const second = await service.handoffManager.createHandoff({
      projectId: project.id,
      agentId: "cursor",
      task: "Employee Leave Management",
      completed: ["Approval UI finished"],
      remaining: ["Add tests"],
      problems: [],
      changedFiles: ["app/leave/page.tsx"],
      nextAction: "Add integration tests",
    });

    const latest = await service.handoffManager.getLatestHandoff(project.id);
    expect(latest?.id).toBe(second.id);
    expect(latest?.agentId).toBe("cursor");

    const history = await service.handoffManager.getHistory(project.id);
    expect(history.length).toBe(2);
    expect(history[0].id).toBe(second.id);
    expect(history[1].id).toBe(first.id);
  });

  it("rejects handoffs without task or nextAction", async () => {
    const { project } = await service.detectAndRegister(workspace);
    await expect(
      service.handoffManager.createHandoff({
        projectId: project.id,
        agentId: "x",
        task: "",
        nextAction: "do something",
      }),
    ).rejects.toThrow();
    await expect(
      service.handoffManager.createHandoff({
        projectId: project.id,
        agentId: "x",
        task: "task",
        nextAction: "",
      }),
    ).rejects.toThrow();
  });
});

describe("context builder", () => {
  let home: string;
  let service: MemoryService;
  let workspace: string;
  let cleanupWs: () => Promise<void>;

  beforeAll(async () => {
    home = await useTempMemoryHome("memhome-context");
    service = new MemoryService();
    const ws = await initPlainWorkspace();
    workspace = ws.dir;
    cleanupWs = ws.cleanup;
  });

  afterAll(async () => {
    await cleanupWs();
    await rmDir(home);
  });

  it("builds a briefing with task, handoff, decisions and problems in priority order", async () => {
    const { project } = await service.detectAndRegister(workspace);

    await service.memoryManager.updateContext({
      projectId: project.id,
      technology: ["Next.js", "TypeScript"],
      lastAgent: "vscode",
    });
    await service.memoryManager.createTask({
      projectId: project.id,
      title: "Employee Leave Management",
      status: "in_progress",
    });
    await service.memoryManager.recordDecision({
      projectId: project.id,
      content: "Leave approval requires manager role.",
      importance: 0.9,
    });
    await service.memoryManager.saveMemory({
      projectId: project.id,
      type: "problem",
      content: "Approval modal does not refresh after approval.",
      importance: 0.8,
    });
    await service.handoffManager.createHandoff({
      projectId: project.id,
      agentId: "vscode",
      task: "Employee Leave Management",
      completed: ["Leave API", "Leave approval endpoint"],
      remaining: ["Approval UI", "Tests"],
      problems: [],
      changedFiles: [],
      nextAction: "Build approval UI",
    });

    const built = await service.contextBuilder.build(project, {
      workspacePath: workspace,
    });
    const b = built.briefing;

    expect(b).toContain("PROJECT:");
    expect(b).toContain("Employee Leave Management");
    expect(b).toContain("Leave approval requires manager role.");
    expect(b).toContain("Approval modal does not refresh after approval.");
    expect(b).toContain("Recommended next action: Build approval UI");

    // Priority ordering: task before handoff, handoff before decisions.
    const taskIdx = b.indexOf("Current task:");
    const handoffIdx = b.indexOf("Latest handoff");
    const decisionIdx = b.indexOf("Important decisions:");
    expect(taskIdx).toBeLessThan(handoffIdx);
    expect(handoffIdx).toBeLessThan(decisionIdx);
  });

  it("respects the context budget", async () => {
    const { project } = await service.detectAndRegister(workspace);
    for (let i = 0; i < 30; i += 1) {
      await service.memoryManager.saveMemory({
        projectId: project.id,
        type: "fact",
        content: `Fact number ${i} with some padding text to make it longer.`,
        importance: 0.5,
      });
    }
    const built = await service.contextBuilder.build(project, {
      workspacePath: workspace,
      budget: { maxTotalChars: 1500, maxItemChars: 100 },
    });
    expect(built.briefing.length).toBeLessThanOrEqual(1500);
  });

  it("detects unfinished work from open task + active session", async () => {
    const { project } = await service.detectAndRegister(workspace);
    await service.memoryManager.createTask({
      projectId: project.id,
      title: "Payroll module",
      status: "in_progress",
    });
    await service.sessionManager.startSession({
      projectId: project.id,
      agentId: "claude-cli",
    });

    const built = await service.contextBuilder.build(project, {
      workspacePath: workspace,
    });
    expect(built.unfinishedWork).not.toBeNull();
    expect(built.unfinishedWork?.activeTask?.title).toBe("Payroll module");
    expect(built.briefing).toContain("Unfinished work detected.");
    // Zero-touch protocol: ask the user whether to continue.
    expect(built.briefing).toContain("CONTINUE OR START FRESH?");
    expect(built.briefing).toContain("You were stopped at: Payroll module");
    expect(built.briefing).toContain("continue where you left off");
  });

  it("always includes the silent agent protocol in the briefing", async () => {
    const { project } = await service.detectAndRegister(workspace);
    const built = await service.contextBuilder.build(project, {
      workspacePath: workspace,
    });
    expect(built.briefing).toContain("AGENT PROTOCOL");
    expect(built.briefing).toContain("never types memory commands");
    expect(built.briefing).toContain("create_handoff");
  });

  it("injects the previous conversation digest into the next briefing", async () => {
    const { project } = await service.detectAndRegister(workspace);
    const session = await service.sessionManager.startSession({
      projectId: project.id,
      agentId: "vscode",
    });
    await service.sessionManager.saveDigest({
      projectId: project.id,
      sessionId: session.sessionId,
      digest:
        "User asked to rename the registration key to manager-mcp. Implemented legacy migration, updated doctor and README. Left off before publishing v0.3.0 to npm.",
    });

    const built = await service.contextBuilder.build(project, {
      workspacePath: workspace,
    });
    expect(built.latestDigest).not.toBeNull();
    expect(built.briefing).toContain("PREVIOUS CONVERSATION");
    expect(built.briefing).toContain("rename the registration key");
    expect(built.briefing).toContain("publishing v0.3.0");
  });

  it("caps digest size so session files stay small", async () => {
    const { project } = await service.detectAndRegister(workspace);
    const session = await service.sessionManager.startSession({
      projectId: project.id,
      agentId: "vscode",
    });
    const huge = "x".repeat(10_000);
    const updated = await service.sessionManager.saveDigest({
      projectId: project.id,
      sessionId: session.sessionId,
      digest: huge,
    });
    expect(updated.digest?.length).toBeLessThanOrEqual(4000);
  });

  it("rejects an empty digest", async () => {
    const { project } = await service.detectAndRegister(workspace);
    await expect(
      service.sessionManager.saveDigest({
        projectId: project.id,
        digest: "   ",
      }),
    ).rejects.toThrow(/empty/i);
  });

  it("detects uncommitted changes as unfinished work", async () => {
    const repo = await initGitRepo({
      remoteUrl: "https://github.com/company/Dirty.git",
    });
    try {
      const { project } = await service.detectAndRegister(repo.dir);
      // Create an uncommitted change.
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.writeFile(
        path.join(repo.dir, "dirty.txt"),
        "uncommitted",
        "utf8",
      );

      const built = await service.contextBuilder.build(project, {
        workspacePath: repo.dir,
      });
      expect(built.unfinishedWork?.uncommittedChanges?.length).toBeGreaterThan(
        0,
      );
      expect(built.briefing).toContain("Uncommitted changes:");
    } finally {
      await repo.cleanup();
    }
  });
});
