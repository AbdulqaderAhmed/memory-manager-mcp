/**
 * Claude Desktop registry — registers the memory server into the Claude
 * Desktop GUI app's claude_desktop_config.json.
 *
 * Config locations:
 *   Windows (standard installer): %APPDATA%/Claude/claude_desktop_config.json
 *   Windows (Store / MSIX):       %LOCALAPPDATA%/Packages/Claude_*
 *                                 /LocalCache/Roaming/Claude/claude_desktop_config.json
 *   macOS:  ~/Library/Application Support/Claude/claude_desktop_config.json
 *   Linux:  ~/.config/Claude/claude_desktop_config.json
 *
 * GUI apps on Windows do not inherit terminal PATH, so the entry uses the
 * absolute path of the current Node executable.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  homeDir,
  pathExists,
  dirExists,
  registerJsonClient,
  unregisterJsonClient,
  isJsonRegistered,
  type ClientResult,
  type JsonClientSpec,
  type RegisterOptions,
} from "./core.js";

/** All candidate Claude Desktop config paths (incl. Windows Store installs). */
export async function getClaudeDesktopMcpConfigPaths(): Promise<string[]> {
  const home = homeDir();

  if (process.platform === "win32") {
    const paths: string[] = [];
    const appData =
      process.env.APPDATA || path.join(home, "AppData", "Roaming");
    const standardPath = path.join(
      appData,
      "Claude",
      "claude_desktop_config.json",
    );

    // Windows Store / MSIX packaged Claude (e.g. Claude_pzs8sxrjxfjjc).
    const localAppData =
      process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const packagesDir = path.join(localAppData, "Packages");
    try {
      const entries = await fs.readdir(packagesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          entry.name.toLowerCase().startsWith("claude_")
        ) {
          paths.push(
            path.join(
              packagesDir,
              entry.name,
              "LocalCache",
              "Roaming",
              "Claude",
              "claude_desktop_config.json",
            ),
          );
        }
      }
    } catch {
      // Packages directory missing or unreadable.
    }

    paths.push(standardPath);
    return paths;
  }

  if (process.platform === "darwin") {
    return [
      path.join(
        home,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      ),
    ];
  }

  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return [path.join(configHome, "Claude", "claude_desktop_config.json")];
}

async function spec(): Promise<JsonClientSpec> {
  const configFiles = await getClaudeDesktopMcpConfigPaths();
  // Installed if any config file or its parent directory exists.
  let installed = false;
  for (const f of configFiles) {
    if (pathExists(f) || (await dirExists(path.dirname(f)))) {
      installed = true;
      break;
    }
  }
  return {
    id: "claude-desktop",
    name: "Claude Desktop",
    configFiles,
    rootKey: "mcpServers",
    installed,
  };
}

export async function registerClaudeDesktopMcp(
  options: RegisterOptions = {},
): Promise<ClientResult> {
  return registerJsonClient(await spec(), options);
}

export async function unregisterClaudeDesktopMcp(): Promise<ClientResult> {
  return unregisterJsonClient(await spec());
}

export async function isClaudeDesktopMcpRegistered(): Promise<boolean> {
  return isJsonRegistered(await getClaudeDesktopMcpConfigPaths(), "mcpServers");
}
