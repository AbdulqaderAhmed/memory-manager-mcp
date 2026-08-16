/**
 * Read-only Git integration.
 *
 * Collects lightweight repository information (branch, HEAD, remote, recent
 * commits, changed files) by shelling out to the `git` binary. The Memory MCP
 * never modifies Git state.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import type { GitCommitInfo, GitInfo } from "../types.js";

const GIT_TIMEOUT_MS = 10_000;

export function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
  });
}

export async function isGitAvailable(): Promise<boolean> {
  try {
    await runGit(["--version"], process.cwd());
    return true;
  } catch {
    return false;
  }
}

/** Returns the repository root for `cwd`, or null when not inside a repo. */
export async function findRepoRoot(cwd: string): Promise<string | null> {
  try {
    const out = await runGit(["rev-parse", "--show-toplevel"], cwd);
    const root = out.trim();
    return root ? path.resolve(root) : null;
  } catch {
    return null;
  }
}

async function getRemoteUrl(cwd: string): Promise<string | undefined> {
  try {
    const out = await runGit(["remote", "get-url", "origin"], cwd);
    const url = out.trim();
    return url || undefined;
  } catch {
    // Fall back to any remote.
    try {
      const remotes = (await runGit(["remote"], cwd)).trim();
      const first = remotes.split("\n").filter(Boolean)[0];
      if (!first) return undefined;
      const url = (await runGit(["remote", "get-url", first], cwd)).trim();
      return url || undefined;
    } catch {
      return undefined;
    }
  }
}

async function getBranch(cwd: string): Promise<string | undefined> {
  try {
    const out = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    const branch = out.trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

async function getHeadCommit(cwd: string): Promise<string | undefined> {
  try {
    const out = await runGit(["rev-parse", "--short", "HEAD"], cwd);
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function getRecentCommits(
  cwd: string,
  count = 5,
): Promise<GitCommitInfo[]> {
  try {
    const out = await runGit(
      ["log", `-${count}`, "--pretty=format:%h%x1f%s%x1f%an%x1f%aI"],
      cwd,
    );
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [hash, subject, author, date] = line.split("\x1f");
        return {
          hash: hash ?? "",
          subject: subject ?? "",
          author: author ?? "",
          date: date ?? "",
        };
      })
      .filter((c) => c.hash);
  } catch {
    return [];
  }
}

async function getChangedFiles(cwd: string): Promise<string[]> {
  try {
    const out = await runGit(["status", "--porcelain"], cwd);
    const files = new Set<string>();
    for (const rawLine of out.split("\n")) {
      if (!rawLine.trim()) continue;
      // porcelain format: XY <path> or XY orig -> new (path starts at index 3).
      // Do NOT trim the line first — the X status column can be a space.
      const filePath = rawLine.slice(3).trim();
      if (!filePath) continue;
      const arrow = filePath.indexOf(" -> ");
      files.add(arrow >= 0 ? filePath.slice(arrow + 4) : filePath);
    }
    return [...files];
  } catch {
    return [];
  }
}

/**
 * Collect lightweight git information for a directory.
 * Never throws — returns `{ isRepo: false }` when git is missing or the
 * directory is not a repository.
 */
export async function getGitInfo(
  cwd: string,
  options?: { includeCommits?: boolean },
): Promise<GitInfo> {
  const repoRoot = await findRepoRoot(cwd);
  if (!repoRoot) return { isRepo: false };

  const [remoteUrl, branch, headCommit, changedFiles] = await Promise.all([
    getRemoteUrl(repoRoot),
    getBranch(repoRoot),
    getHeadCommit(repoRoot),
    getChangedFiles(repoRoot),
  ]);

  const info: GitInfo = {
    isRepo: true,
    repoRoot,
    remoteUrl,
    branch,
    headCommit,
    changedFiles,
    hasUncommittedChanges: changedFiles.length > 0,
  };

  if (options?.includeCommits !== false) {
    info.recentCommits = await getRecentCommits(repoRoot);
  }
  return info;
}
