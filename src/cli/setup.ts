/**
 * setup — CLI front-end for auto-configuring the memory MCP server in
 * installed AI clients.
 *
 * The actual per-client registration logic lives in src/clients/ (one registry
 * module per client, architecture ported from skills-manager-mcp). This module
 * only formats reports for the CLI.
 *
 * Supported clients:
 *   vscode          VS Code / Copilot   (user mcp.json, all editor variants)
 *   cursor          Cursor              (~/.cursor/mcp.json)
 *   claude-desktop  Claude Desktop      (claude_desktop_config.json, incl. MSIX)
 *   claude-code     Claude Code CLI     (~/.claude.json)
 *   antigravity     Google Antigravity  (~/.gemini/config + antigravity-ide)
 *   gemini-cli      Gemini CLI          (~/.gemini/settings.json)
 *   windsurf        Windsurf            (~/.codeium/windsurf/mcp_config.json)
 *   codex           OpenAI Codex CLI    (~/.codex/config.toml)
 */
import {
  runSetup,
  runUninstall,
  defaultServerEntry,
  type ClientResult,
  type SetupOptions,
  type SetupStatus,
} from "../clients/index.js";

export { runSetup, runUninstall };
export type { ClientResult, SetupOptions };

const STATUS_MARK: Record<SetupStatus, string> = {
  configured: "✓",
  "already-configured": "✓",
  "skipped-not-installed": "-",
  "skipped-dry-run": "~",
  failed: "✗",
};

export function formatSetupReport(
  results: ClientResult[],
  dryRun: boolean,
): string {
  const entry = defaultServerEntry();
  const lines: string[] = [];
  lines.push(
    dryRun ? "memory-manage-mcp setup (dry run)" : "memory-manage-mcp setup",
  );
  lines.push(`Server entry: ${entry.command} ${entry.args.join(" ")}`);
  lines.push("");
  for (const r of results) {
    const mark = STATUS_MARK[r.status];
    const name = r.clientName.padEnd(20);
    let detail: string;
    switch (r.status) {
      case "configured":
        detail = `${r.detail ?? "configured"} → ${r.configFiles.join(", ")}`;
        break;
      case "already-configured":
        detail = `already configured → ${r.configFiles[0]}`;
        break;
      case "skipped-not-installed":
        detail = "not installed (use --force to configure anyway)";
        break;
      case "skipped-dry-run":
        detail = `${r.detail} → ${r.configFiles.join(", ")}`;
        break;
      case "failed":
        detail = `failed: ${r.detail}`;
        break;
    }
    lines.push(`${mark} ${name} ${detail}`);
  }
  const configured = results.filter(
    (r) => r.status === "configured" || r.status === "already-configured",
  ).length;
  const wouldAffect = results.filter(
    (r) => r.status === "skipped-dry-run",
  ).length;
  lines.push("");
  lines.push(
    dryRun
      ? `Dry run complete. ${wouldAffect} client(s) would be affected.`
      : configured > 0
        ? `Done. ${configured} client(s) configured — restart them to load the memory server.`
        : "No clients were configured.",
  );
  return lines.join("\n");
}

export function formatUninstallReport(results: ClientResult[]): string {
  const lines: string[] = ["memory-manage-mcp uninstall", ""];
  for (const r of results) {
    const mark = r.detail === "entry removed" ? "✓" : "-";
    lines.push(
      `${mark} ${r.clientName.padEnd(20)} ${r.detail} (${r.configFiles[0]})`,
    );
  }
  lines.push("");
  lines.push("Done. Restart affected clients to apply the change.");
  return lines.join("\n");
}
