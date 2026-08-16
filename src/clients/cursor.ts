/**
 * Cursor registry — registers the memory server into Cursor's user-level
 * MCP configuration at ~/.cursor/mcp.json (all platforms).
 *
 * Cursor uses the `mcpServers` top-level key (same as Claude).
 * Project-level configuration lives at .cursor/mcp.json in the project root.
 *
 * @see https://docs.cursor.com/context/model-context-protocol
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

export function getCursorMcpConfigPath(): string {
  return path.join(homeDir(), ".cursor", "mcp.json");
}

function spec(): JsonClientSpec {
  return {
    id: "cursor",
    name: "Cursor",
    configFiles: [getCursorMcpConfigPath()],
    rootKey: "mcpServers",
    installed: pathExists(path.join(homeDir(), ".cursor")),
  };
}

export async function registerCursorMcp(
  options: RegisterOptions = {},
): Promise<ClientResult> {
  return registerJsonClient(spec(), options);
}

export async function unregisterCursorMcp(): Promise<ClientResult> {
  return unregisterJsonClient(spec());
}

export async function isCursorMcpRegistered(): Promise<boolean> {
  return isJsonRegistered([getCursorMcpConfigPath()], "mcpServers");
}
