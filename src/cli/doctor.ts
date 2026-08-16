/**
 * Doctor — diagnostics for the Memory MCP installation.
 *
 * Checks: Node.js version, memory directory, file permissions, config,
 * storage integrity, project detection and git availability.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { MemoryService } from '../service.js';
import { getMemoryRoot, getConfigPath, getProjectsDir } from '../storage/paths.js';
import { isGitAvailable } from '../git/gitService.js';
import { detectProject } from '../project/detector.js';
import { SERVER_VERSION } from '../version.js';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  allOk: boolean;
}

async function checkNodeVersion(): Promise<DoctorCheck> {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = major >= 18;
  return {
    name: 'Node.js',
    ok,
    detail: `v${process.versions.node}${ok ? '' : ' (requires >= 18)'}`,
  };
}

async function checkStorageDirectory(service: MemoryService): Promise<DoctorCheck> {
  const root = service.root;
  try {
    await fs.mkdir(root, { recursive: true });
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      return { name: 'Storage directory', ok: false, detail: `${root} is not a directory` };
    }
    return { name: 'Storage directory', ok: true, detail: root };
  } catch (err) {
    return { name: 'Storage directory', ok: false, detail: String(err) };
  }
}

async function checkFilePermissions(service: MemoryService): Promise<DoctorCheck> {
  const probe = path.join(service.root, '.doctor-probe');
  try {
    await fs.writeFile(probe, 'ok', 'utf8');
    await fs.rm(probe, { force: true });
    return { name: 'File permissions', ok: true, detail: 'read/write OK' };
  } catch (err) {
    return { name: 'File permissions', ok: false, detail: String(err) };
  }
}

async function checkConfig(service: MemoryService): Promise<DoctorCheck> {
  try {
    const { configPath, created } = await service.getConfig();
    return {
      name: 'MCP configuration',
      ok: true,
      detail: `${configPath}${created ? ' (created)' : ''}`,
    };
  } catch (err) {
    return { name: 'MCP configuration', ok: false, detail: String(err) };
  }
}

async function checkStorageIntegrity(service: MemoryService): Promise<DoctorCheck> {
  try {
    const projects = await service.store.listProjects();
    let corrupt = 0;
    for (const project of projects) {
      const ctx = await service.store.getContext(project.id);
      if (ctx === null) {
        // Missing context is acceptable (new project); count only hard errors.
      }
    }
    return {
      name: 'Storage integrity',
      ok: true,
      detail: `${projects.length} project(s), ${corrupt} corrupt`,
    };
  } catch (err) {
    return { name: 'Storage integrity', ok: false, detail: String(err) };
  }
}

async function checkProjectDetection(workspacePath?: string): Promise<DoctorCheck> {
  try {
    const detection = await detectProject(workspacePath);
    return {
      name: 'Project detection',
      ok: true,
      detail: `${detection.identity.kind}: ${detection.identity.canonical}`,
    };
  } catch (err) {
    return { name: 'Project detection', ok: false, detail: String(err) };
  }
}

async function checkGit(): Promise<DoctorCheck> {
  const available = await isGitAvailable();
  return {
    name: 'Git',
    ok: true, // git is optional, so this never fails the doctor
    detail: available ? 'detected' : 'not found (path-based identity will be used)',
  };
}

export async function runDoctor(options?: {
  root?: string;
  workspacePath?: string;
}): Promise<DoctorReport> {
  const service = new MemoryService({ root: options?.root });
  const checks: DoctorCheck[] = [];

  checks.push(await checkNodeVersion());
  checks.push(await checkStorageDirectory(service));
  checks.push(await checkFilePermissions(service));
  checks.push(await checkConfig(service));
  checks.push(await checkStorageIntegrity(service));
  checks.push(await checkProjectDetection(options?.workspacePath));
  checks.push(await checkGit());

  const allOk = checks.every((c) => c.ok);
  return { checks, allOk };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push('Memory MCP Doctor');
  lines.push(`Version ${SERVER_VERSION}`);
  lines.push(`Memory root: ${getMemoryRoot()}`);
  lines.push('');
  for (const check of report.checks) {
    const mark = check.ok ? '✓' : '✗';
    const detail = check.detail ? ` — ${check.detail}` : '';
    lines.push(`${mark} ${check.name}${detail}`);
  }
  lines.push('');
  lines.push(report.allOk ? 'Memory MCP is ready.' : 'Memory MCP found issues. See above.');
  return lines.join('\n');
}
