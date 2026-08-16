/**
 * Project identity derivation.
 *
 * Priority:
 *   1. Git remote URL (normalized) — same repo == same project regardless of
 *      where it is cloned locally.
 *   2. `.agent-memory.json` identity file in the workspace root.
 *   3. Normalized workspace path.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import type { ProjectIdentity } from '../types.js';

/**
 * Normalize a git remote URL into a canonical project key.
 *
 * Handles:
 *   https://github.com/company/PMS.git
 *   git@github.com:company/PMS.git
 *   ssh://git@github.com/company/PMS
 *   github.com/company/PMS
 *
 * All of the above normalize to "github.com/company/pms".
 */
export function normalizeGitRemoteUrl(remoteUrl: string): string {
  let url = remoteUrl.trim();

  // SCP-like syntax: git@host:owner/repo.git
  const scpMatch = url.match(/^(?:[\w.-]+@)?([\w.-]+):(.+)$/);
  if (scpMatch && !url.includes('://')) {
    url = `https://${scpMatch[1]}/${scpMatch[2]}`;
  }

  // Strip credentials and scheme.
  url = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  url = url.replace(/^[^@/]+@/, '');

  // Strip trailing ".git", slashes, fragments and query strings.
  url = url.replace(/[?#].*$/, '');
  url = url.replace(/\/+$/, '');
  url = url.replace(/\.git$/i, '');

  // Lowercase host + path for case-insensitive hosts like GitHub.
  return url.toLowerCase();
}

/** Derive a human-friendly repository name from a normalized remote. */
export function repoNameFromRemote(normalized: string): string {
  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

/** Stable project id derived from a canonical identity string. */
export function projectIdFromCanonical(canonical: string): string {
  const hash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return `proj_${hash}`;
}

/** Normalize a filesystem path for identity purposes. */
export function normalizeWorkspacePath(workspacePath: string): string {
  const resolved = path.resolve(workspacePath);
  // Lowercase drive letter on Windows; keep POSIX casing sensitivity.
  if (process.platform === 'win32') {
    return resolved.toLowerCase().replace(/\\/g, '/');
  }
  return resolved.replace(/\\/g, '/');
}

export interface IdentityInput {
  workspacePath: string;
  gitRemoteUrl?: string;
  gitRepoName?: string;
  identityFileProjectId?: string;
}

/**
 * Derive the project identity for a workspace using the priority chain.
 */
export function deriveIdentity(input: IdentityInput): ProjectIdentity {
  if (input.gitRemoteUrl) {
    const canonical = normalizeGitRemoteUrl(input.gitRemoteUrl);
    return {
      kind: 'git',
      canonical,
      repoName: input.gitRepoName ?? repoNameFromRemote(canonical),
      remoteUrl: input.gitRemoteUrl,
    };
  }

  if (input.identityFileProjectId) {
    return {
      kind: 'identity-file',
      canonical: `file:${input.identityFileProjectId}`,
      repoName: input.identityFileProjectId,
    };
  }

  const normalized = normalizeWorkspacePath(input.workspacePath);
  return {
    kind: 'path',
    canonical: `path:${normalized}`,
    repoName: path.basename(path.resolve(input.workspacePath)),
  };
}
