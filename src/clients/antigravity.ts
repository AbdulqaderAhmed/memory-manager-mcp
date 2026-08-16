/**
 * Antigravity registry — registers the memory server into Google Antigravity's
 * MCP configuration files. Both known locations are covered:
 *
 *   ~/.gemini/config/mcp_config.json          (global Antigravity MCP config)
 *   ~/.gemini/antigravity-ide/mcp.json        (Antigravity IDE config)
 *
 * Antigravity uses the standard `mcpServers` top-level key with
 * command/args/env/cwd/disabled fields.
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

/** All Antigravity MCP config paths. */
export function getAntigravityMcpConfigPaths(): string[] {
  const home = homeDir();
  return [
    path.join(home, ".gemini", "config", "mcp_config.json"),
    path.join(home, ".gemini", "antigravity-ide", "mcp.json"),
  ];
}

/** Primary config path, for display. */
export function getAntigravityMcpConfigPath(): string {
  return getAntigravityMcpConfigPaths()[0];
}

function spec(): JsonClientSpec {
  return {
    id: "antigravity",
    name: "Antigravity",
    configFiles: getAntigravityMcpConfigPaths(),
    rootKey: "mcpServers",
    installed: pathExists(path.join(homeDir(), ".gemini")),
  };
}

export async function registerAntigravityMcp(
  options: RegisterOptions = {},
): Promise<ClientResult> {
  return registerJsonClient(spec(), options);
}

export async function unregisterAntigravityMcp(): Promise<ClientResult> {
  return unregisterJsonClient(spec());
}

export async function isAntigravityMcpRegistered(): Promise<boolean> {
  return isJsonRegistered(getAntigravityMcpConfigPaths(), "mcpServers");
}
