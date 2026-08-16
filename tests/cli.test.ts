import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempMemoryHome, rmDir, initPlainWorkspace } from './helpers.js';
import { MemoryService } from '../src/service.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(root, 'dist', 'cli', 'index.js');

function runCli(args: string[], cwd: string, env: Record<string, string> = {}): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      { cwd, env: { ...process.env, ...env }, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({
          code: error ? (error as any).code ?? 1 : 0,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      },
    );
  });
}

describe('CLI', () => {
  let home: string;
  let workspace: string;
  let cleanupWs: () => Promise<void>;

  beforeAll(async () => {
    home = await useTempMemoryHome('memhome-cli');
    const ws = await initPlainWorkspace();
    workspace = ws.dir;
    cleanupWs = ws.cleanup;

    // Seed some data through the service so the CLI has something to show.
    const service = new MemoryService();
    const { project } = await service.detectAndRegister(workspace);
    await service.memoryManager.saveMemory({
      projectId: project.id,
      type: 'decision',
      content: 'Use JWT for authentication',
      importance: 0.9,
    });
    await service.handoffManager.createHandoff({
      projectId: project.id,
      agentId: 'vscode',
      task: 'Auth module',
      completed: ['Login endpoint'],
      remaining: ['Logout endpoint'],
      problems: [],
      changedFiles: [],
      nextAction: 'Implement logout',
    });
    const session = await service.sessionManager.startSession({
      projectId: project.id,
      agentId: 'vscode',
    });
    await service.sessionManager.finishSession({
      projectId: project.id,
      sessionId: session.sessionId,
      summary: 'Worked on authentication',
    });
  });

  afterAll(async () => {
    await cleanupWs();
    await rmDir(home);
  });

  it('doctor reports ready', async () => {
    const result = await runCli(['doctor'], workspace, { AGENT_MEMORY_HOME: home });
    expect(result.stdout).toContain('Memory MCP Doctor');
    expect(result.stdout).toContain('✓ Node.js');
    expect(result.stdout).toContain('Memory MCP is ready.');
    expect(result.code).toBe(0);
  });

  it('doctor --json emits a machine-readable report', async () => {
    const result = await runCli(['doctor', '--json'], workspace, { AGENT_MEMORY_HOME: home });
    const report = JSON.parse(result.stdout);
    expect(report.allOk).toBe(true);
    expect(Array.isArray(report.checks)).toBe(true);
  });

  it('projects lists registered projects', async () => {
    const result = await runCli(['projects'], workspace, { AGENT_MEMORY_HOME: home });
    expect(result.stdout).toContain('proj_');
  });

  it('project current detects the workspace project', async () => {
    const result = await runCli(['project', 'current'], workspace, { AGENT_MEMORY_HOME: home });
    expect(result.stdout).toContain('Project ID: proj_');
    expect(result.stdout).toContain('Registered: yes');
  });

  it('project inspect shows counts', async () => {
    const result = await runCli(['project', 'inspect'], workspace, { AGENT_MEMORY_HOME: home });
    expect(result.stdout).toContain('Memories:');
    expect(result.stdout).toContain('Decisions:');
    expect(result.stdout).toContain('Latest handoff: Auth module');
  });

  it('memory search finds seeded memory', async () => {
    const result = await runCli(['memory', 'search', 'authentication'], workspace, {
      AGENT_MEMORY_HOME: home,
    });
    expect(result.stdout).toContain('JWT');
  });

  it('handoff latest prints the handoff', async () => {
    const result = await runCli(['handoff', 'latest'], workspace, { AGENT_MEMORY_HOME: home });
    expect(result.stdout).toContain('Auth module');
    expect(result.stdout).toContain('Implement logout');
  });

  it('sessions lists sessions', async () => {
    const result = await runCli(['sessions'], workspace, { AGENT_MEMORY_HOME: home });
    expect(result.stdout).toContain('vscode');
    expect(result.stdout).toContain('completed');
  });

  it('clear requires --all --yes', async () => {
    const refused = await runCli(['clear'], workspace, { AGENT_MEMORY_HOME: home });
    expect(refused.code).not.toBe(0);

    const confirmed = await runCli(['clear', '--all', '--yes'], workspace, {
      AGENT_MEMORY_HOME: home,
    });
    expect(confirmed.stdout).toContain('All memory cleared.');

    const after = await runCli(['projects'], workspace, { AGENT_MEMORY_HOME: home });
    expect(after.stdout).toContain('No projects registered yet.');
  });
});
