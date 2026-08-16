/**
 * Windsurf registry — registers the memory server into Windsurf's MCP
 * configuration at ~/.codeium/windsurf/mcp_config.json (`mcpServers` key).
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

export function getWindsurfMcpConfigPath(): string {
  return path.join(homeDir(), ".codeium", "windsurf", "mcp_config.json");
}

function spec(): JsonClientSpec {
  return {
    id: "windsurf",
    name: "Windsurf",
    configFiles: [getWindsurfMcpConfigPath()],
    rootKey: "mcpServers",
    installed: pathExists(path.join(homeDir(), ".codeium", "windsurf")),
  };
}

export async function registerWindsurfMcp(
  options: RegisterOptions = {},
): Promise<ClientResult> {
  return registerJsonClient(spec(), options);
}

export async function unregisterWindsurfMcp(): Promise<ClientResult> {
  return unregisterJsonClient(spec());
}

export async function isWindsurfMcpRegistered(): Promise<boolean> {
  return isJsonRegistered([getWindsurfMcpConfigPath()], "mcpServers");
}
