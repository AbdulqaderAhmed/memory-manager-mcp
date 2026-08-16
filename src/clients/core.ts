/**
 * Client registry core — shared types and helpers for registering the memory
 * MCP server into AI client configuration files.
 *
 * Architecture ported from skills-manager-mcp: one registry module per client
 * (VS Code, Cursor, Claude Desktop, Claude Code, Antigravity, Gemini CLI,
 * Windsurf, Codex), each exposing register/unregister/isRegistered against the
 * client's real config file location(s).
 *
 * Improvements kept from the original memory-manager implementation:
 *   - crash-safe atomic writes (write tmp -> fsync -> rename)
 *   - .bak backup of the original file before every modification
 *   - dry-run support and installed-client detection
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteFile, readJsonOrNull } from "../storage/fsutil.js";

/** Re-exported for non-JSON registries (e.g. Codex TOML). */
export const atomicWriteFileSafe = atomicWriteFile;

/** Name under which the server is registered in each client config. */
export const SERVER_KEY = "memory";

/** Absolute path of the compiled MCP server entry point (dist/index.js). */
export const SERVER_ENTRY = fileURLToPath(
  new URL("../index.js", import.meta.url),
);

export interface ServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** VS Code mcp.json entries carry an explicit transport type. */
  type?: "stdio";
}

/**
 * Default server entry: run the compiled server with the current Node binary.
 * GUI apps (Claude Desktop, Antigravity) do not inherit terminal PATH on
 * Windows, so an absolute node path is required there.
 */
export function defaultServerEntry(): ServerEntry {
  return { command: process.execPath, args: [SERVER_ENTRY] };
}

// ---------------------------------------------------------------------------
// Platform path helpers
// ---------------------------------------------------------------------------

export function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** Roaming application-data / config directory for the current platform. */
export function appDataDir(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(homeDir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(homeDir(), "Library", "Application Support");
  }
  return process.env.XDG_CONFIG_HOME || path.join(homeDir(), ".config");
}

export function pathExists(p: string): boolean {
  return existsSync(p);
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

export async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Registration results
// ---------------------------------------------------------------------------

export type SetupStatus =
  | "configured"
  | "already-configured"
  | "skipped-not-installed"
  | "skipped-dry-run"
  | "failed";

export interface ClientResult {
  clientId: string;
  clientName: string;
  /** Every config file this client uses. */
  configFiles: string[];
  status: SetupStatus;
  detail?: string;
}

export interface RegisterOptions {
  /** Configure even when the client does not appear installed. */
  force?: boolean;
  /** Report what would change without writing anything. */
  dryRun?: boolean;
  /** Server entry to write (defaults to node + dist/index.js). */
  entry?: ServerEntry;
}

// ---------------------------------------------------------------------------
// JSON config merge (shared by all JSON-based clients)
// ---------------------------------------------------------------------------

export interface JsonClientSpec {
  id: string;
  name: string;
  /** All candidate config file paths for this client. */
  configFiles: string[];
  /** Top-level key holding the server map ("servers" for VS Code, else "mcpServers"). */
  rootKey: "servers" | "mcpServers";
  /** Whether the client appears to be installed. */
  installed: boolean;
  /** Extra fields merged into the entry (e.g. VS Code's `type: "stdio"`). */
  entryExtras?: Record<string, unknown>;
}

function entriesEqual(a: unknown, b: ServerEntry): boolean {
  if (!a || typeof a !== "object") return false;
  const e = a as Record<string, unknown>;
  return (
    e.command === b.command && JSON.stringify(e.args) === JSON.stringify(b.args)
  );
}

/**
 * Merge the memory server entry into one JSON config file. Preserves all
 * existing content; backs the file up (.bak) before writing; atomic write.
 *
 * @returns "configured" | "already-configured"
 */
async function mergeIntoJsonFile(
  configFile: string,
  rootKey: "servers" | "mcpServers",
  entry: ServerEntry,
  entryExtras?: Record<string, unknown>,
): Promise<"configured" | "already-configured"> {
  const doc = (await readJsonOrNull<Record<string, unknown>>(configFile)) ?? {};
  const root =
    typeof doc[rootKey] === "object" && doc[rootKey] !== null
      ? (doc[rootKey] as Record<string, unknown>)
      : {};

  const existing = root[SERVER_KEY];
  if (existing && entriesEqual(existing, entry)) {
    return "already-configured";
  }

  root[SERVER_KEY] = { ...entry, ...entryExtras };
  doc[rootKey] = root;

  // Back up the original before replacing it.
  if (pathExists(configFile)) {
    await fs.copyFile(configFile, `${configFile}.bak`);
  }
  await atomicWriteFile(configFile, `${JSON.stringify(doc, null, 2)}\n`);
  return "configured";
}

/**
 * Register the memory server into every config file of a JSON-based client.
 * Skips clients that are not installed unless `force` is set.
 */
export async function registerJsonClient(
  spec: JsonClientSpec,
  options: RegisterOptions = {},
): Promise<ClientResult> {
  const entry = options.entry ?? defaultServerEntry();
  const base = {
    clientId: spec.id,
    clientName: spec.name,
    configFiles: spec.configFiles,
  };

  if (!spec.installed && !options.force) {
    return { ...base, status: "skipped-not-installed" };
  }

  if (options.dryRun) {
    return {
      ...base,
      status: "skipped-dry-run",
      detail: "would add/update entry",
    };
  }

  let anyConfigured = false;
  const errors: string[] = [];

  for (const configFile of spec.configFiles) {
    try {
      const outcome = await mergeIntoJsonFile(
        configFile,
        spec.rootKey,
        entry,
        spec.entryExtras,
      );
      if (outcome === "configured") anyConfigured = true;
    } catch (err) {
      // Individual file failures are non-fatal (e.g. permission issues on a
      // variant the user does not actually use).
      errors.push(`${configFile}: ${String(err)}`);
    }
  }

  if (errors.length === spec.configFiles.length) {
    return { ...base, status: "failed", detail: errors.join("; ") };
  }
  return {
    ...base,
    status: anyConfigured ? "configured" : "already-configured",
    detail: errors.length > 0 ? `partial: ${errors.join("; ")}` : undefined,
  };
}

/**
 * Remove the memory server entry from every config file of a JSON-based client.
 * Preserves all other user servers and keys.
 */
export async function unregisterJsonClient(
  spec: Pick<JsonClientSpec, "id" | "name" | "configFiles" | "rootKey">,
): Promise<ClientResult> {
  let anyRemoved = false;
  for (const configFile of spec.configFiles) {
    try {
      const doc = await readJsonOrNull<Record<string, unknown>>(configFile);
      if (!doc) continue;
      const root = doc[spec.rootKey];
      if (
        root &&
        typeof root === "object" &&
        SERVER_KEY in (root as Record<string, unknown>)
      ) {
        delete (root as Record<string, unknown>)[SERVER_KEY];
        await fs.copyFile(configFile, `${configFile}.bak`);
        await atomicWriteFile(configFile, `${JSON.stringify(doc, null, 2)}\n`);
        anyRemoved = true;
      }
    } catch {
      // Missing/unreadable file — nothing to remove.
    }
  }
  return {
    clientId: spec.id,
    clientName: spec.name,
    configFiles: spec.configFiles,
    status: anyRemoved ? "configured" : "already-configured",
    detail: anyRemoved ? "entry removed" : "no entry present",
  };
}

/** Check whether the memory server is registered in any of the given files. */
export async function isJsonRegistered(
  configFiles: string[],
  rootKey: "servers" | "mcpServers",
): Promise<boolean> {
  for (const configFile of configFiles) {
    const doc = await readJsonOrNull<Record<string, unknown>>(configFile);
    const root = doc?.[rootKey];
    if (
      root &&
      typeof root === "object" &&
      SERVER_KEY in (root as Record<string, unknown>)
    ) {
      return true;
    }
  }
  return false;
}
