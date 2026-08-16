import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { makeTempDir, rmDir } from "./helpers.js";
import {
  registerJsonClient,
  unregisterJsonClient,
  isJsonRegistered,
  runSetup,
  supportedClientIds,
  defaultServerEntry,
  SERVER_KEY,
  type JsonClientSpec,
} from "../src/clients/index.js";
import { registerCodexMcp, unregisterCodexMcp } from "../src/clients/codex.js";

describe("client registries", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await makeTempDir("setup-test");
  });

  afterAll(async () => {
    await rmDir(tmp);
  });

  function spec(
    name: string,
    rootKey: "servers" | "mcpServers" = "mcpServers",
  ): JsonClientSpec {
    return {
      id: name,
      name,
      configFiles: [path.join(tmp, name, "mcp.json")],
      rootKey,
      installed: true,
    };
  }

  it("supports all expected client ids", () => {
    const ids = supportedClientIds();
    for (const expected of [
      "vscode",
      "cursor",
      "claude-desktop",
      "claude-code",
      "antigravity",
      "gemini-cli",
      "windsurf",
      "codex",
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it("writes a new config file with the memory server entry", async () => {
    const s = spec("fresh");
    const result = await registerJsonClient(s);
    expect(result.status).toBe("configured");

    const doc = JSON.parse(await fs.readFile(s.configFiles[0], "utf8"));
    expect(doc.mcpServers[SERVER_KEY]).toEqual(defaultServerEntry());
    expect(await isJsonRegistered(s.configFiles, "mcpServers")).toBe(true);
  });

  it("preserves existing config content and backs up the file", async () => {
    const s = spec("existing");
    await fs.mkdir(path.dirname(s.configFiles[0]), { recursive: true });
    await fs.writeFile(
      s.configFiles[0],
      JSON.stringify({
        mcpServers: { other: { command: "other-server", args: [] } },
        unrelatedKey: { keep: true },
      }),
      "utf8",
    );

    const result = await registerJsonClient(s);
    expect(result.status).toBe("configured");

    const doc = JSON.parse(await fs.readFile(s.configFiles[0], "utf8"));
    expect(doc.mcpServers.other).toEqual({ command: "other-server", args: [] });
    expect(doc.unrelatedKey).toEqual({ keep: true });
    expect(doc.mcpServers[SERVER_KEY]).toEqual(defaultServerEntry());

    // Backup of the original was created.
    const bak = JSON.parse(
      await fs.readFile(`${s.configFiles[0]}.bak`, "utf8"),
    );
    expect(bak.mcpServers[SERVER_KEY]).toBeUndefined();
  });

  it("is idempotent when already configured", async () => {
    const s = spec("idempotent");
    await registerJsonClient(s);
    const second = await registerJsonClient(s);
    expect(second.status).toBe("already-configured");
  });

  it("skips clients that are not installed unless forced", async () => {
    const s = { ...spec("absent"), installed: false };
    const skipped = await registerJsonClient(s);
    expect(skipped.status).toBe("skipped-not-installed");
    await expect(fs.access(s.configFiles[0])).rejects.toThrow();

    const forced = await registerJsonClient(s, { force: true });
    expect(forced.status).toBe("configured");
  });

  it("dry run reports without writing", async () => {
    const s = spec("dryrun");
    const result = await registerJsonClient(s, { dryRun: true });
    expect(result.status).toBe("skipped-dry-run");
    await expect(fs.access(s.configFiles[0])).rejects.toThrow();
  });

  it('uses the "servers" root key and stdio type for VS Code', async () => {
    const s = {
      ...spec("vscode-style", "servers"),
      entryExtras: { type: "stdio" },
    };
    await registerJsonClient(s);
    const doc = JSON.parse(await fs.readFile(s.configFiles[0], "utf8"));
    expect(doc.servers[SERVER_KEY].type).toBe("stdio");
    expect(doc.servers[SERVER_KEY].command).toBe(defaultServerEntry().command);
    expect(doc.mcpServers).toBeUndefined();
  });

  it("registers into every config file of a multi-file client", async () => {
    const s: JsonClientSpec = {
      id: "multi",
      name: "multi",
      configFiles: [
        path.join(tmp, "multi", "a.json"),
        path.join(tmp, "multi", "b.json"),
      ],
      rootKey: "mcpServers",
      installed: true,
    };
    const result = await registerJsonClient(s);
    expect(result.status).toBe("configured");
    for (const f of s.configFiles) {
      const doc = JSON.parse(await fs.readFile(f, "utf8"));
      expect(doc.mcpServers[SERVER_KEY]).toBeDefined();
    }
  });

  it("unregister removes only the memory entry", async () => {
    const s = spec("unreg");
    await registerJsonClient(s);
    const result = await unregisterJsonClient(s);
    expect(result.detail).toBe("entry removed");

    const doc = JSON.parse(await fs.readFile(s.configFiles[0], "utf8"));
    expect(doc.mcpServers[SERVER_KEY]).toBeUndefined();
    expect(await isJsonRegistered(s.configFiles, "mcpServers")).toBe(false);

    // Unregistering again is a no-op.
    const again = await unregisterJsonClient(s);
    expect(again.detail).toBe("no entry present");
  });

  it("runSetup rejects unknown client ids", async () => {
    await expect(runSetup({ client: "nope" })).rejects.toThrow(
      /Unknown client/,
    );
  });
});

describe("codex registry (TOML)", () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await makeTempDir("codex-test");
  });

  afterAll(async () => {
    await rmDir(tmp);
  });

  it("writes a TOML entry into an empty config", async () => {
    const configPath = path.join(tmp, "fresh", "config.toml");
    const result = await registerCodexMcp({ customConfigPath: configPath });
    expect(result.status).toBe("configured");

    const content = await fs.readFile(configPath, "utf8");
    expect(content).toContain("[mcp_servers.memory]");
    expect(content).toContain('command = "');
    expect(content).toContain("args = [");
  });

  it("preserves existing TOML content and is idempotent", async () => {
    const configPath = path.join(tmp, "existing", "config.toml");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      '[mcp_servers.other]\ncommand = "other"\nargs = []\n',
      "utf8",
    );

    const first = await registerCodexMcp({ customConfigPath: configPath });
    expect(first.status).toBe("configured");
    const second = await registerCodexMcp({ customConfigPath: configPath });
    expect(second.status).toBe("already-configured");

    const content = await fs.readFile(configPath, "utf8");
    expect(content).toContain("[mcp_servers.other]");
    expect(content.match(/\[mcp_servers\.memory\]/g)).toHaveLength(1);
  });

  it("unregister removes the TOML section only", async () => {
    const configPath = path.join(tmp, "unreg", "config.toml");
    await registerCodexMcp({ customConfigPath: configPath });
    const result = await unregisterCodexMcp(configPath);
    expect(result.detail).toBe("entry removed");

    const content = await fs.readFile(configPath, "utf8");
    expect(content).not.toContain("[mcp_servers.memory]");
  });
});
