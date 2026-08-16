import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  initGitRepo,
  initPlainWorkspace,
  useTempMemoryHome,
  rmDir,
} from "./helpers.js";
import { detectProject } from "../src/project/detector.js";
import {
  normalizeGitRemoteUrl,
  deriveIdentity,
  projectIdFromCanonical,
} from "../src/project/identity.js";
import { ProjectRegistry } from "../src/project/registry.js";
import { FileSystemMemoryStore } from "../src/storage/filesystem.js";
import { getMemoryRoot } from "../src/storage/paths.js";

describe("git remote normalization", () => {
  it("normalizes https, ssh and scp remotes to the same canonical key", () => {
    const variants = [
      "https://github.com/company/PMS.git",
      "git@github.com:company/PMS.git",
      "ssh://git@github.com/company/PMS",
      "https://github.com/company/pms",
    ];
    const normalized = variants.map(normalizeGitRemoteUrl);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("github.com/company/pms");
  });

  it("strips credentials from URLs", () => {
    expect(
      normalizeGitRemoteUrl("https://user:token@github.com/company/repo.git"),
    ).toBe("github.com/company/repo");
  });
});

describe("project detection", () => {
  let home: string;

  beforeAll(async () => {
    home = await useTempMemoryHome();
  });

  afterAll(async () => {
    await rmDir(home);
  });

  it("detects a git project by remote URL", async () => {
    const repo = await initGitRepo({
      remoteUrl: "https://github.com/company/PMS.git",
    });
    try {
      const detection = await detectProject(repo.dir);
      expect(detection.identity.kind).toBe("git");
      expect(detection.identity.canonical).toBe("github.com/company/pms");
      expect(detection.git?.isRepo).toBe(true);
      expect(detection.git?.branch).toBe("main");
    } finally {
      await repo.cleanup();
    }
  });

  it("same git repository resolves to the same project id from different local paths", async () => {
    const remote = "https://github.com/company/SharedRepo.git";
    const repoA = await initGitRepo({ remoteUrl: remote });
    const repoB = await initGitRepo({ remoteUrl: remote });
    try {
      const [a, b] = await Promise.all([
        detectProject(repoA.dir),
        detectProject(repoB.dir),
      ]);
      expect(a.projectId).toBe(b.projectId);
      expect(a.identity.canonical).toBe(b.identity.canonical);
    } finally {
      await repoA.cleanup();
      await repoB.cleanup();
    }
  });

  it("falls back to path identity when git repo has no remote", async () => {
    const repo = await initGitRepo({ remoteUrl: undefined });
    try {
      const detection = await detectProject(repo.dir);
      expect(detection.identity.kind).toBe("path");
      expect(detection.identity.canonical).toContain("path:");
    } finally {
      await repo.cleanup();
    }
  });

  it("detects a non-git project by path", async () => {
    const ws = await initPlainWorkspace();
    try {
      const detection = await detectProject(ws.dir);
      expect(detection.identity.kind).toBe("path");
      expect(detection.git).toBeUndefined();
    } finally {
      await ws.cleanup();
    }
  });

  it("uses .agent-memory.json identity file when present and no git remote", async () => {
    const ws = await initPlainWorkspace({
      ".agent-memory.json": JSON.stringify({
        projectId: "my-custom-project",
        memoryVersion: 1,
      }),
    });
    try {
      const detection = await detectProject(ws.dir);
      expect(detection.identity.kind).toBe("identity-file");
      expect(detection.identity.canonical).toBe("file:my-custom-project");
      expect(detection.identityFile?.projectId).toBe("my-custom-project");
    } finally {
      await ws.cleanup();
    }
  });

  it("git remote takes priority over .agent-memory.json", async () => {
    const repo = await initGitRepo({
      remoteUrl: "https://github.com/company/Priority.git",
      files: {
        ".agent-memory.json": JSON.stringify({ projectId: "ignored-id" }),
      },
    });
    try {
      const detection = await detectProject(repo.dir);
      expect(detection.identity.kind).toBe("git");
      expect(detection.identity.canonical).toBe("github.com/company/priority");
    } finally {
      await repo.cleanup();
    }
  });
});

describe("deriveIdentity", () => {
  it("produces stable project ids", () => {
    const a = deriveIdentity({
      workspacePath: "/x/y",
      gitRemoteUrl: "https://github.com/o/r.git",
    });
    const b = deriveIdentity({
      workspacePath: "/different",
      gitRemoteUrl: "git@github.com:o/r.git",
    });
    expect(projectIdFromCanonical(a.canonical)).toBe(
      projectIdFromCanonical(b.canonical),
    );
  });
});

describe("project registry", () => {
  let home: string;

  beforeAll(async () => {
    home = await useTempMemoryHome();
  });

  afterAll(async () => {
    await rmDir(home);
  });

  it("auto-registers a new project and seeds context", async () => {
    const store = new FileSystemMemoryStore(getMemoryRoot());
    const registry = new ProjectRegistry(store);
    const ws = await initPlainWorkspace();
    try {
      const detection = await detectProject(ws.dir);
      const first = await registry.ensureProject(detection);
      expect(first.isNew).toBe(true);
      expect(first.project.name).toBeTruthy();
      expect(first.project.localPaths).toContain(ws.dir);

      const context = await store.getContext(first.project.id);
      expect(context).not.toBeNull();
      expect(context?.projectId).toBe(first.project.id);

      // Second detection is not new.
      const second = await registry.ensureProject(detection);
      expect(second.isNew).toBe(false);
      expect(second.project.id).toBe(first.project.id);
    } finally {
      await ws.cleanup();
    }
  });

  it("records additional local paths for the same project", async () => {
    const store = new FileSystemMemoryStore(getMemoryRoot());
    const registry = new ProjectRegistry(store);
    const remote = "https://github.com/company/MultiPath.git";
    const repoA = await initGitRepo({ remoteUrl: remote });
    const repoB = await initGitRepo({ remoteUrl: remote });
    try {
      const detA = await detectProject(repoA.dir);
      const detB = await detectProject(repoB.dir);
      await registry.ensureProject(detA);
      const result = await registry.ensureProject(detB);
      expect(result.project.localPaths.length).toBe(2);
      expect(result.project.localPaths).toContain(repoA.dir);
      expect(result.project.localPaths).toContain(repoB.dir);
    } finally {
      await repoA.cleanup();
      await repoB.cleanup();
    }
  });
});
