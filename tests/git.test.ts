import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { initGitRepo, initPlainWorkspace } from "./helpers.js";
import {
  getGitInfo,
  isGitAvailable,
  findRepoRoot,
} from "../src/git/gitService.js";

const cleanups: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const cleanup of cleanups) await cleanup();
});

describe("git service", () => {
  it("reports git availability", async () => {
    expect(await isGitAvailable()).toBe(true);
  });

  it("detects repository, branch, remote and HEAD", async () => {
    const repo = await initGitRepo({
      remoteUrl: "https://github.com/company/GitTest.git",
      branch: "develop",
    });
    cleanups.push(repo.cleanup);

    const info = await getGitInfo(repo.dir);
    expect(info.isRepo).toBe(true);
    expect(info.branch).toBe("develop");
    expect(info.remoteUrl).toBe("https://github.com/company/GitTest.git");
    expect(info.headCommit).toBeTruthy();
    expect(info.repoRoot).toBeTruthy();
    expect(info.recentCommits?.length).toBeGreaterThan(0);
    expect(info.recentCommits?.[0].subject).toBe("initial commit");
    expect(info.hasUncommittedChanges).toBe(false);
  });

  it("detects changed files in the working tree", async () => {
    const repo = await initGitRepo({});
    cleanups.push(repo.cleanup);

    await fs.writeFile(path.join(repo.dir, "new-file.txt"), "hello", "utf8");
    await fs.writeFile(path.join(repo.dir, "README.md"), "# changed\n", "utf8");

    const info = await getGitInfo(repo.dir);
    expect(info.hasUncommittedChanges).toBe(true);
    expect(info.changedFiles).toContain("new-file.txt");
    expect(info.changedFiles).toContain("README.md");
  });

  it("finds repo root from a nested subdirectory", async () => {
    const repo = await initGitRepo({ files: { "src/deep/file.txt": "x" } });
    cleanups.push(repo.cleanup);

    const nested = path.join(repo.dir, "src", "deep");
    const root = await findRepoRoot(nested);
    expect(root).toBeTruthy();
    expect(path.resolve(root!)).toBe(path.resolve(repo.dir));

    const info = await getGitInfo(nested);
    expect(info.isRepo).toBe(true);
  });

  it("returns isRepo=false for non-git directories", async () => {
    const ws = await initPlainWorkspace();
    cleanups.push(ws.cleanup);
    const info = await getGitInfo(ws.dir);
    expect(info.isRepo).toBe(false);
    expect(await findRepoRoot(ws.dir)).toBeNull();
  });

  it("handles repositories without a remote", async () => {
    const repo = await initGitRepo({ remoteUrl: undefined });
    cleanups.push(repo.cleanup);
    const info = await getGitInfo(repo.dir);
    expect(info.isRepo).toBe(true);
    expect(info.remoteUrl).toBeUndefined();
  });
});
