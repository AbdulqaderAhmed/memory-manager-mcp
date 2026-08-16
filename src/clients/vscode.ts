/**
 * VS Code registry — registers the memory server into VS Code's user-level
 * mcp.json. All editor variants are covered (stable, Insiders, VSCodium).
 *
 * VS Code uses the `servers` top-level key (not `mcpServers`) and entries
 * carry an explicit `type: "stdio"` field:
 *
 *   %APPDATA%/Code/User/mcp.json            (Windows)
 *   ~/Library/Application Support/Code/User/mcp.json   (macOS)
 *   ~/.config/Code/User/mcp.json            (Linux)
 */
import path from "node:path";
import {
  appDataDir,
  pathExists,
  registerJsonClient,
  unregisterJsonClient,
  isJsonRegistered,
  type ClientResult,
  type JsonClientSpec,
  type RegisterOptions,
} from "./core.js";

const EDITOR_DIRS = ["Code", "Code - Insiders", "VSCodium"];

/** All candidate VS Code user mcp.json paths (one per editor variant). */
export function getVsCodeMcpConfigPaths(): string[] {
  const ad = appDataDir();
  return EDITOR_DIRS.map((dir) => path.join(ad, dir, "User", "mcp.json"));
}

/** Primary (stable) config path, for display. */
export function getVsCodeMcpConfigPath(): string {
  return getVsCodeMcpConfigPaths()[0];
}

function spec(): JsonClientSpec {
  const ad = appDataDir();
  return {
    id: "vscode",
    name: "VS Code (Copilot)",
    configFiles: getVsCodeMcpConfigPaths(),
    rootKey: "servers",
    // Installed if any editor variant's User directory exists.
    installed: EDITOR_DIRS.some((dir) =>
      pathExists(path.join(ad, dir, "User")),
    ),
    entryExtras: { type: "stdio" },
  };
}

export async function registerVsCodeMcp(
  options: RegisterOptions = {},
): Promise<ClientResult> {
  return registerJsonClient(spec(), options);
}

export async function unregisterVsCodeMcp(): Promise<ClientResult> {
  const s = spec();
  return unregisterJsonClient(s);
}

export async function isVsCodeMcpRegistered(): Promise<boolean> {
  return isJsonRegistered(getVsCodeMcpConfigPaths(), "servers");
}
