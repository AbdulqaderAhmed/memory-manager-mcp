/**
 * Claude Code registry — registers the memory server into the Claude Code
 * terminal CLI's user-level configuration at ~/.claude.json.
 *
 * Claude Code stores user-level MCP servers under a top-level `mcpServers`
 * key, alongside `preferences` and other settings.
 *
 * NOTE: This is Claude Code (the terminal agent), NOT Claude Desktop (the GUI
 * app) — see claudeDesktop.ts for that.
 */
import path from "node:path";
import {
  homeDir,
  pathExists,
  registerJsonClient,
  unregisterJsonClient,
  isJsonRegistered,
  type ClientResult,
  type JsonClientSpec,
  type RegisterOptions,
} from "./core.js";

export function getClaudeCodeMcpConfigPath(): string {
  return path.join(homeDir(), ".claude.json");
}

function spec(): JsonClientSpec {
  const home = homeDir();
  return {
    id: "claude-code",
    name: "Claude Code",
    configFiles: [getClaudeCodeMcpConfigPath()],
    rootKey: "mcpServers",
    installed:
      pathExists(path.join(home, ".claude.json")) ||
      pathExists(path.join(home, ".claude")),
  };
}

export async function registerClaudeCodeMcp(
  options: RegisterOptions = {},
): Promise<ClientResult> {
  return registerJsonClient(spec(), options);
}

export async function unregisterClaudeCodeMcp(): Promise<ClientResult> {
  return unregisterJsonClient(spec());
}

export async function isClaudeCodeMcpRegistered(): Promise<boolean> {
  return isJsonRegistered([getClaudeCodeMcpConfigPath()], "mcpServers");
}
