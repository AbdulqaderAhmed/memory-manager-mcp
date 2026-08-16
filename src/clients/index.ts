/**
 * Client registry orchestrator — runs registration/unregistration across all
 * supported AI clients, or a single one.
 */
import {
  registerVsCodeMcp,
  unregisterVsCodeMcp,
  isVsCodeMcpRegistered,
} from "./vscode.js";
import {
  registerCursorMcp,
  unregisterCursorMcp,
  isCursorMcpRegistered,
} from "./cursor.js";
import {
  registerClaudeDesktopMcp,
  unregisterClaudeDesktopMcp,
  isClaudeDesktopMcpRegistered,
} from "./claudeDesktop.js";
import {
  registerClaudeCodeMcp,
  unregisterClaudeCodeMcp,
  isClaudeCodeMcpRegistered,
} from "./claudeCode.js";
import {
  registerAntigravityMcp,
  unregisterAntigravityMcp,
  isAntigravityMcpRegistered,
} from "./antigravity.js";
import {
  registerGeminiCliMcp,
  unregisterGeminiCliMcp,
  isGeminiCliMcpRegistered,
} from "./geminiCli.js";
import {
  registerWindsurfMcp,
  unregisterWindsurfMcp,
  isWindsurfMcpRegistered,
} from "./windsurf.js";
import {
  registerCodexMcp,
  unregisterCodexMcp,
  isCodexMcpRegistered,
} from "./codex.js";
import type { ClientResult, RegisterOptions } from "./core.js";

export * from "./core.js";

interface ClientRegistry {
  id: string;
  register: (options?: RegisterOptions) => Promise<ClientResult>;
  unregister: () => Promise<ClientResult>;
  isRegistered: () => Promise<boolean>;
}

const REGISTRIES: ClientRegistry[] = [
  {
    id: "vscode",
    register: registerVsCodeMcp,
    unregister: unregisterVsCodeMcp,
    isRegistered: isVsCodeMcpRegistered,
  },
  {
    id: "cursor",
    register: registerCursorMcp,
    unregister: unregisterCursorMcp,
    isRegistered: isCursorMcpRegistered,
  },
  {
    id: "claude-desktop",
    register: registerClaudeDesktopMcp,
    unregister: unregisterClaudeDesktopMcp,
    isRegistered: isClaudeDesktopMcpRegistered,
  },
  {
    id: "claude-code",
    register: registerClaudeCodeMcp,
    unregister: unregisterClaudeCodeMcp,
    isRegistered: isClaudeCodeMcpRegistered,
  },
  {
    id: "antigravity",
    register: registerAntigravityMcp,
    unregister: unregisterAntigravityMcp,
    isRegistered: isAntigravityMcpRegistered,
  },
  {
    id: "gemini-cli",
    register: registerGeminiCliMcp,
    unregister: unregisterGeminiCliMcp,
    isRegistered: isGeminiCliMcpRegistered,
  },
  {
    id: "windsurf",
    register: registerWindsurfMcp,
    unregister: unregisterWindsurfMcp,
    isRegistered: isWindsurfMcpRegistered,
  },
  {
    id: "codex",
    register: registerCodexMcp,
    unregister: unregisterCodexMcp,
    isRegistered: isCodexMcpRegistered,
  },
];

/** All supported client ids, in registration order. */
export function supportedClientIds(): string[] {
  return REGISTRIES.map((r) => r.id);
}

export interface SetupOptions extends RegisterOptions {
  /** Restrict to one client id. */
  client?: string;
}

/** Register the memory server into all (or one) supported client. */
export async function runSetup(
  options: SetupOptions = {},
): Promise<ClientResult[]> {
  let registries = REGISTRIES;
  if (options.client) {
    registries = REGISTRIES.filter((r) => r.id === options.client);
    if (registries.length === 0) {
      throw new Error(
        `Unknown client "${options.client}". Valid ids: ${supportedClientIds().join(", ")}`,
      );
    }
  }
  const results: ClientResult[] = [];
  for (const registry of registries) {
    results.push(await registry.register(options));
  }
  return results;
}

/** Remove the memory server entry from all (or one) supported client. */
export async function runUninstall(client?: string): Promise<ClientResult[]> {
  let registries = REGISTRIES;
  if (client) {
    registries = REGISTRIES.filter((r) => r.id === client);
    if (registries.length === 0) {
      throw new Error(
        `Unknown client "${client}". Valid ids: ${supportedClientIds().join(", ")}`,
      );
    }
  }
  const results: ClientResult[] = [];
  for (const registry of registries) {
    results.push(await registry.unregister());
  }
  return results;
}

/** Map of client id -> whether the memory server is registered there. */
export async function registrationStatus(): Promise<Record<string, boolean>> {
  const status: Record<string, boolean> = {};
  for (const registry of REGISTRIES) {
    status[registry.id] = await registry.isRegistered();
  }
  return status;
}

/**
 * Silently ensure the memory server is registered in every installed client.
 * Called automatically when the MCP server starts (like skills-manager-mcp's
 * ensureInitialized), so the server configures itself on first run.
 *
 * Never throws and never logs to stdout (stdout is reserved for the MCP
 * protocol). Disable with AGENT_MEMORY_NO_AUTO_SETUP=1.
 */
export async function ensureRegisteredSilently(): Promise<void> {
  if (process.env.AGENT_MEMORY_NO_AUTO_SETUP === "1") return;
  try {
    await runSetup();
  } catch {
    // Auto-registration is best-effort; the server must still start.
  }
}
