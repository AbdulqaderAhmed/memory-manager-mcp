/**
 * Gemini CLI registry — registers the memory server into Gemini CLI's
 * settings file at ~/.gemini/settings.json (`mcpServers` top-level key).
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

export function getGeminiCliMcpConfigPath(): string {
  return path.join(homeDir(), ".gemini", "settings.json");
}

function spec(): JsonClientSpec {
  return {
    id: "gemini-cli",
    name: "Gemini CLI",
    configFiles: [getGeminiCliMcpConfigPath()],
    rootKey: "mcpServers",
    installed: pathExists(getGeminiCliMcpConfigPath()),
  };
}

export async function registerGeminiCliMcp(
  options: RegisterOptions = {},
): Promise<ClientResult> {
  return registerJsonClient(spec(), options);
}

export async function unregisterGeminiCliMcp(): Promise<ClientResult> {
  return unregisterJsonClient(spec());
}

export async function isGeminiCliMcpRegistered(): Promise<boolean> {
  return isJsonRegistered([getGeminiCliMcpConfigPath()], "mcpServers");
}
