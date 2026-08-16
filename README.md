# memory-manage-mcp

> **Your project remembers, no matter which AI agent you use.**

`memory-manage-mcp` is a **local-first, database-free** persistent memory server for AI coding agents, exposed over the [Model Context Protocol](https://modelcontextprotocol.io) (MCP).

Start a task in VS Code with GitHub Copilot, continue it in Cursor, finish it with Claude Code or Gemini CLI — the next agent automatically recognizes that it is working on the same project and continues from where the previous agent stopped.

- 🗂️ **Local-first** — everything is stored as plain files under `~/.agent-memory/`. No cloud, no API keys, no external database, no network calls.
- 🤝 **Agent & IDE independent** — any MCP client works: VS Code, Cursor, Claude Desktop, Claude Code, Gemini CLI, Windsurf, …
- 🔍 **Project-aware** — projects are identified by git remote URL (or `.agent-memory.json`, or path), so the same repo cloned to different machines/paths shares one memory.
- 🧠 **Curated memory, not chat logs** — decisions, requirements, architecture, tasks, problems, solutions and progress are stored as distilled, ranked entries.
- 🤜🤛 **Structured handoffs** — before an agent stops, it writes what was done, what remains, known problems and the recommended next action.
- 🛡️ **Crash-safe & concurrency-safe** — atomic writes (temp → fsync → rename), append-only logs, file locks.
- 🩺 **CLI + doctor** — inspect projects, search memory, and diagnose your setup.

---

## Requirements

- Node.js **>= 18**
- (Optional) `git` on your PATH — used read-only for project detection and unfinished-work signals.

## Install

```bash
# from the repository
git clone <this-repo> memory-manager-mcp
cd memory-manager-mcp
pnpm install
pnpm run build

# or install globally
pnpm add -g memory-manage-mcp   # once published
```

Verify the installation:

```bash
node dist/cli/index.js doctor
# Memory MCP is ready.
```

## Auto-configure your IDEs (recommended)

One command detects every supported AI client installed on your machine and registers the memory server in each client's MCP config:

```bash
memory-manage-mcp setup            # or: node dist/cli/index.js setup
```

Supported clients (one dedicated registry per client):

| Client                | Config file(s) written                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **VS Code (Copilot)** | `%APPDATA%/Code/User/mcp.json` — plus **Code - Insiders** and **VSCodium** variants (`servers` key, `type: "stdio"`)                     |
| **Cursor**            | `~/.cursor/mcp.json`                                                                                                                     |
| **Claude Desktop**    | `%APPDATA%/Claude/claude_desktop_config.json` — plus **Windows Store/MSIX** installs (`%LOCALAPPDATA%/Packages/Claude_*/LocalCache/...`) |
| **Claude Code**       | `~/.claude.json`                                                                                                                         |
| **Antigravity**       | `~/.gemini/config/mcp_config.json` **and** `~/.gemini/antigravity-ide/mcp.json`                                                          |
| **Gemini CLI**        | `~/.gemini/settings.json`                                                                                                                |
| **Windsurf**          | `~/.codeium/windsurf/mcp_config.json`                                                                                                    |
| **Codex CLI**         | `~/.codex/config.toml` (TOML `[mcp_servers.manager-mcp]` table)                                                                          |

- Only clients that are actually installed are touched; others are skipped.
- Existing config files are preserved (a `.bak` backup is created first) and written atomically — other MCP servers you configured stay intact.
- The server is registered under the name **`manager-mcp`** — that is the prefix you will see on its tools in your IDE (e.g. `manager-mcp_save_memory`). Entries left under the old `memory` key by earlier versions are migrated automatically on the next `setup`.
- **Self-registering:** the MCP server also registers itself silently the first time it starts, so even a bare `node dist/index.js` launch ends up configured everywhere. Disable with `AGENT_MEMORY_NO_AUTO_SETUP=1`.

Useful flags:

```bash
memory-manage-mcp setup --dry-run          # show what would change, write nothing
memory-manage-mcp setup --client cursor    # configure a single client
memory-manage-mcp setup --force            # configure even if not detected as installed
memory-manage-mcp setup --json             # machine-readable report
memory-manage-mcp uninstall                # remove the memory entry from all client configs
memory-manage-mcp uninstall --client vscode
```

After setup, restart your IDE/client and the 15 memory tools are available. Prefer manual configuration? See the next section.

### How do I know it is working?

1. **`memory-manage-mcp doctor`** — the `Client registration` check lists every client where the server is registered as `manager-mcp`:

   ```
   ✓ Client registration   registered as "manager-mcp" in: vscode, cursor
   ```

2. **In your IDE** — after restarting, the MCP tool list should show the 15 tools prefixed with `manager-mcp_` (e.g. `manager-mcp_initialize_project_context`, `manager-mcp_save_memory`).
3. **Ask your agent** — tell it to call `initialize_project_context`; a successful briefing response means the server is live and the project is registered.

## Connect your AI client manually

The server speaks MCP over **stdio**. Point any MCP client at `node <path-to>/dist/index.js` (or `memory-manage-mcp` if installed globally).

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json` (workspace) or your user MCP settings:

```json
{
  "servers": {
    "manager-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/memory-manager-mcp/dist/index.js"]
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "manager-mcp": {
      "command": "node",
      "args": ["C:/path/to/memory-manager-mcp/dist/index.js"]
    }
  }
}
```

### Claude Desktop / Claude Code

`claude_desktop_config.json` (or `claude mcp add`):

```json
{
  "mcpServers": {
    "manager-mcp": {
      "command": "node",
      "args": ["C:/path/to/memory-manager-mcp/dist/index.js"]
    }
  }
}
```

```bash
claude mcp add manager-mcp -- node C:/path/to/memory-manager-mcp/dist/index.js
```

### Gemini CLI

```bash
gemini mcp add manager-mcp -- node C:/path/to/memory-manager-mcp/dist/index.js
```

### Any other MCP client

```json
{
  "manager-mcp": {
    "command": "node",
    "args": ["/absolute/path/to/memory-manager-mcp/dist/index.js"]
  }
}
```

> **Tip:** run `pnpm run dev` during development — it starts the server from TypeScript sources via `tsx`.

## How project detection works

When a tool receives a `workspacePath` (or falls back to the current directory), the project identity is derived with this priority:

1. **Git remote URL** — `https://github.com/company/pms.git`, `git@github.com:company/pms.git` and `ssh://…` all normalize to `github.com/company/pms`, then hash to a stable `proj_…` id. Same repo, any machine, any clone path → same memory.
2. **`.agent-memory.json`** — drop this file in a project root to force an identity (for non-git projects or monorepos):
   ```json
   { "projectId": "my-project", "name": "My Project" }
   ```
3. **Absolute path** — last resort; memory is tied to that exact path.

Projects are **auto-registered** on first use — no setup step required.

## Storage layout

Everything lives under `~/.agent-memory/` (override with the `AGENT_MEMORY_HOME` environment variable):

```
~/.agent-memory/
├── config.json                  # server configuration
├── projects.json                # project registry
└── projects/
    └── proj_<hash>/
        ├── project.json         # project metadata
        ├── context.json         # compact project context
        ├── memories.jsonl       # append-only memory log (versioned + tombstones)
        ├── tasks.json           # task list
        ├── decisions.json       # decision log
        ├── sessions.jsonl       # agent working sessions
        └── handoffs/
            ├── latest.json      # most recent handoff
            └── history/         # all previous handoffs
```

All writes are atomic (temp file → fsync → rename) or append-only with fsync; list mutations happen under a per-project lock file. Corrupt or partially-written lines are skipped gracefully on read.

## Configuration

`~/.agent-memory/config.json` is created with defaults on first run:

```json
{
  "maxContextItems": 20,
  "enableRawSessions": true,
  "search": { "maxResults": 20 }
}
```

| Key                 | Meaning                                              |
| ------------------- | ---------------------------------------------------- |
| `maxContextItems`   | Max items per section in the generated briefing      |
| `enableRawSessions` | Keep raw session records (summaries are always kept) |
| `search.maxResults` | Default result limit for `search_memory`             |

## The MCP tools (16)

| Tool                         | Purpose                                                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize_project_context` | **Call first.** Detects/registers the project and returns a compact briefing: current task, latest handoff, previous conversation digest, completed/remaining work, problems, decisions, recommended next action. |
| `get_project_context`        | Lightweight fetch of the stored project context.                                                                                                                                    |
| `save_memory`                | Save a curated memory (`decision`, `requirement`, `architecture`, `task`, `problem`, `solution`, `progress`, `fact`, `preference`, `constraint`, `discovery`). Pass `id` to update. |
| `get_memory`                 | Retrieve one memory by id.                                                                                                                                                          |
| `search_memory`              | Ranked keyword search across memories, tasks, decisions, handoffs, session summaries, conversation digests and context.                                                             |
| `get_current_task`           | Most relevant open task + other open tasks.                                                                                                                                         |
| `update_task`                | Create or update a task (`active`, `in_progress`, `completed`, `blocked`, `abandoned`).                                                                                             |
| `record_decision`            | Record an important decision (long-lived in ranking).                                                                                                                               |
| `get_decisions`              | List decisions, newest first.                                                                                                                                                       |
| `create_handoff`             | **Call before stopping.** Structured handoff: completed, remaining, problems, changed files, next action.                                                                           |
| `get_latest_handoff`         | Fetch the most recent handoff (optionally with history).                                                                                                                            |
| `start_session`              | Begin tracking an agent working session.                                                                                                                                            |
| `save_session_digest`        | **Call before stopping.** Compress the ENTIRE conversation into one detailed digest (max 4000 chars); injected into the next chat's briefing.                                       |
| `finish_session`             | End a session with status + summary.                                                                                                                                                |
| `delete_project_memory`      | Permanently delete one project's memory (`confirm: true`).                                                                                                                          |
| `clear_memory`               | Permanently delete **all** memory (`confirm: true` + phrase `"delete everything"`).                                                                                                 |

### Recommended agent workflow (zero-touch for the user)

The user never types memory commands — everything happens automatically behind the scenes:

1. **On start** → the agent calls `initialize_project_context` by itself. The briefing includes the **previous conversation's digest**, so the agent understands the last chat from first message to last. If unfinished work is detected, it asks the user once: _"Would you like to continue where you left off? (yes/no)"_ — **yes** resumes from the recommended next action, **no** starts fresh.
2. **While working** → the agent silently saves decisions, requirements, problems and progress with `save_memory`, and tracks work with `update_task`.
3. **Before stopping** → the agent silently calls `save_session_digest` (compresses the whole conversation into a compact digest), then `create_handoff` + `finish_session`, so the next chat (even in another IDE) can pick up seamlessly.

A machine-readable version of this guidance lives in [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) — you can reference it from your client's rules/instructions file.

## CLI

```bash
memory-manage-mcp <command> [--workspace <path>] [--json]

  projects                  List known projects
  project current           Detect the project for the current directory
  project inspect [id]      Inspect a project's stored memory
  memory search <query>     Search memory across a project
  handoff latest            Show the most recent handoff
  sessions                  List agent sessions
  doctor                    Diagnose the installation
  setup [--client <id>] [--force] [--dry-run]
                            Auto-configure installed AI clients
  uninstall [--client <id>] Remove the memory entry from client configs
  clear --all --yes         Permanently delete ALL memory
```

Every command has built-in help — use `-h` / `--help` after the command, or `help <command>`:

```bash
memory-manage-mcp --help              # overview of all commands
memory-manage-mcp help setup          # detailed help for one command
memory-manage-mcp setup --help        # same thing
memory-manage-mcp doctor -h           # short flag works too
```

Examples:

```bash
memory-manage-mcp doctor
memory-manage-mcp project current --workspace ./my-app
memory-manage-mcp memory search "employee permission"
memory-manage-mcp handoff latest --json
```

> When developing from source, prefix commands with `node dist/cli/index.js` instead of `memory-manage-mcp`.

## Privacy

- All data stays on your machine in `~/.agent-memory/`. Nothing is ever sent anywhere.
- Raw conversation transcripts are **never** stored by default; only distilled memories you explicitly save.
- Delete a single project with `delete_project_memory`, or everything with `memory-manage-mcp clear --all --yes`.

## Troubleshooting

| Symptom                                 | Fix                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Client can't see the tools              | Make sure `command` is an absolute path to `node` and `args[0]` is the absolute path to `dist/index.js`. Run `pnpm run build` first. |
| Wrong project detected                  | Check `memory-manage-mcp project current`. Add a `.agent-memory.json` to pin an identity, or add a git remote.                       |
| Same repo, different memory per machine | Ensure the git remote URL is set (`git remote -v`) — it is the primary identity.                                                     |
| Anything else                           | Run `memory-manage-mcp doctor` (or `pnpm run doctor`) and read the check list.                                                       |

## Development

```bash
pnpm install
pnpm run build        # compile TypeScript → dist/
pnpm run dev          # run the MCP server from sources (tsx)
pnpm run typecheck    # strict type check
pnpm test             # vitest suite (61 tests: unit + CLI + MCP stdio integration)
pnpm run test:watch
```

### Architecture

```
types ─► storage (MemoryStore interface ─► FileSystemMemoryStore)
              │
git service ─►│
              ▼
project (identity / detector / registry)
              ▼
memory manager + ranker ─► search ─► context (compressor / unfinished / builder)
              ▼
service facade ─► MCP tools ─► stdio server
              └──────────────► CLI + doctor
```

The `MemoryStore` interface (`src/storage/interface.ts`) is the only place that touches persistence — swap in SQLite, Postgres or a cloud backend later without changing any business logic.

## License

MIT — see [LICENSE](LICENSE).
