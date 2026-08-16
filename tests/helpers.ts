/**
 * Shared test helpers: temp directories, isolated memory homes and real git
 * repositories.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

export function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

export async function rmDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Point AGENT_MEMORY_HOME at a fresh temp directory and return it.
 * Each test file runs in its own forked process, so mutating process.env is
 * safe.
 */
export async function useTempMemoryHome(prefix = "memhome"): Promise<string> {
  const home = await makeTempDir(prefix);
  process.env.AGENT_MEMORY_HOME = home;
  return home;
}

export interface GitRepoOptions {
  remoteUrl?: string;
  branch?: string;
  files?: Record<string, string>;
  commit?: boolean;
}

/** Create a real git repository in a fresh temp directory. */
export async function initGitRepo(options: GitRepoOptions = {}): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await makeTempDir("gitrepo");
  await git(["init", "-b", options.branch ?? "main"], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "Test User"], dir);
  if (options.remoteUrl) {
    await git(["remote", "add", "origin", options.remoteUrl], dir);
  }
  const files = options.files ?? { "README.md": "# test\n" };
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }
  if (options.commit !== false) {
    await git(["add", "-A"], dir);
    await git(["commit", "-m", "initial commit"], dir);
  }
  return { dir, cleanup: () => rmDir(dir) };
}

/** Create a plain (non-git) workspace directory. */
export async function initPlainWorkspace(
  files?: Record<string, string>,
): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await makeTempDir("workspace");
  for (const [name, content] of Object.entries(files ?? {})) {
    const filePath = path.join(dir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }
  return { dir, cleanup: () => rmDir(dir) };
}
