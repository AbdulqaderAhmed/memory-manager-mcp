/**
 * Codex CLI registry — registers the memory server into OpenAI Codex CLI's
 * TOML configuration at ~/.codex/config.toml.
 *
 * Codex uses TOML `[mcp_servers.<name>]` tables:
 *
 *   [mcp_servers.memory]
 *   command = "node"
 *   args = ["/path/to/dist/index.js"]
 *
 * Ported from skills-manager-mcp's codexRegistry, with crash-safe atomic
 * writes and .bak backups.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  SERVER_KEY,
  LEGACY_SERVER_KEY,
  SERVER_ENTRY,
  homeDir,
  pathExists,
  atomicWriteFileSafe,
  type ClientResult,
  type RegisterOptions,
  type ServerEntry,
} from "./core.js";

export function getCodexMcpConfigPath(): string {
  return path.join(homeDir(), ".codex", "config.toml");
}

function tomlEscapeString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function tomlFormatArray(values: string[]): string {
  const escaped = values.map((v) => `"${tomlEscapeString(v)}"`);
  return `[${escaped.join(", ")}]`;
}

function generateMemoryToml(entry: ServerEntry): string {
  return [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = "${tomlEscapeString(entry.command)}"`,
    `args = ${tomlFormatArray(entry.args)}`,
  ].join("\n");
}

const SECTION_HEADER = `[mcp_servers.${SERVER_KEY}]`;

/** All registration keys to look for (current + legacy, for migration). */
const ALL_KEYS =
  SERVER_KEY === LEGACY_SERVER_KEY
    ? [SERVER_KEY]
    : [SERVER_KEY, LEGACY_SERVER_KEY];

function hasKeyEntry(tomlContent: string, key: string): boolean {
  return new RegExp(`^\\[mcp_servers\\.${key}\\]`, "m").test(tomlContent);
}

function hasMemoryEntry(tomlContent: string): boolean {
  return ALL_KEYS.some((key) => hasKeyEntry(tomlContent, key));
}

/** Extract the first arg of an existing entry under any known key, or null. */
function extractExistingArgs(tomlContent: string): string | null {
  for (const key of ALL_KEYS) {
    const match = tomlContent.match(
      new RegExp(
        `\\[mcp_servers\\.${key}\\][^[]*?args\\s*=\\s*\\["([^"]+)"\\]`,
        "s",
      ),
    );
    if (match) return match[1].replace(/\\\\/g, "\\");
  }
  return null;
}

/** Remove the [mcp_servers.<key>] section(s) for all known keys. */
function removeMemorySection(tomlContent: string): string {
  let result = tomlContent;
  for (const key of ALL_KEYS) {
    const pattern = new RegExp(
      `\\n?\\[mcp_servers\\.${key}\\]\\n(?:(?!\\n\\[)[^\\n]*\\n?)*`,
      "g",
    );
    result = result.replace(pattern, "");
    const startPattern = new RegExp(
      `^\\[mcp_servers\\.${key}\\]\\n(?:(?!\\n\\[)[^\\n]*\\n?)*`,
    );
    result = result.replace(startPattern, "");
  }
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

export interface CodexRegisterOptions extends RegisterOptions {
  /** Override the config.toml path (for testing). */
  customConfigPath?: string;
}

export async function registerCodexMcp(
  options: CodexRegisterOptions = {},
): Promise<ClientResult> {
  const configPath = options.customConfigPath ?? getCodexMcpConfigPath();
  const entry = options.entry ?? {
    command: process.execPath,
    args: [SERVER_ENTRY],
  };
  const base = {
    clientId: "codex",
    clientName: "Codex CLI",
    configFiles: [configPath],
  };

  const installed =
    Boolean(options.customConfigPath) ||
    pathExists(path.join(homeDir(), ".codex"));
  if (!installed && !options.force) {
    return { ...base, status: "skipped-not-installed" };
  }

  try {
    let existingContent = "";
    try {
      existingContent = await fs.readFile(configPath, "utf-8");
    } catch {
      // File doesn't exist yet.
    }

    const upToDate =
      hasKeyEntry(existingContent, SERVER_KEY) &&
      !hasKeyEntry(existingContent, LEGACY_SERVER_KEY) &&
      extractExistingArgs(existingContent) === entry.args[0];

    if (upToDate) {
      return { ...base, status: "already-configured" };
    }
    if (options.dryRun) {
      return {
        ...base,
        status: "skipped-dry-run",
        detail: hasMemoryEntry(existingContent)
          ? "would update existing entry"
          : "would add entry",
      };
    }

    const serverBlock = generateMemoryToml(entry);
    let newContent: string;
    if (hasMemoryEntry(existingContent)) {
      const cleaned = removeMemorySection(existingContent);
      newContent = cleaned
        ? `${cleaned}\n\n${serverBlock}\n`
        : `${serverBlock}\n`;
    } else {
      const separator = existingContent.trim() ? "\n\n" : "";
      newContent = `${existingContent.trim()}${separator}${serverBlock}\n`;
    }

    if (pathExists(configPath)) {
      await fs.copyFile(configPath, `${configPath}.bak`);
    }
    await atomicWriteFileSafe(configPath, newContent);
    return {
      ...base,
      status: "configured",
      detail: hasMemoryEntry(existingContent)
        ? "updated existing entry"
        : "added entry",
    };
  } catch (err) {
    return { ...base, status: "failed", detail: String(err) };
  }
}

export async function unregisterCodexMcp(
  customConfigPath?: string,
): Promise<ClientResult> {
  const configPath = customConfigPath ?? getCodexMcpConfigPath();
  const base = {
    clientId: "codex",
    clientName: "Codex CLI",
    configFiles: [configPath],
  };
  try {
    const content = await fs.readFile(configPath, "utf-8");
    if (hasMemoryEntry(content)) {
      await fs.copyFile(configPath, `${configPath}.bak`);
      const cleaned = removeMemorySection(content);
      await atomicWriteFileSafe(configPath, cleaned ? `${cleaned}\n` : "");
      return { ...base, status: "configured", detail: "entry removed" };
    }
  } catch {
    // File missing — nothing to remove.
  }
  return { ...base, status: "already-configured", detail: "no entry present" };
}

export async function isCodexMcpRegistered(): Promise<boolean> {
  try {
    const content = await fs.readFile(getCodexMcpConfigPath(), "utf-8");
    return hasMemoryEntry(content);
  } catch {
    return false;
  }
}
