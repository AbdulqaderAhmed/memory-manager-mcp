# memory-mcp

> **Your project remembers, no matter which AI agent you use.**

`memory-mcp` is a **local-first, database-free** persistent memory server for AI coding agents, exposed over the [Model Context Protocol](https://modelcontextprotocol.io) (MCP).

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
pnpm add -g memory-mcp   # once published
```

Verify the installation:

```bash
node dist/cli/index.js doctor
# Memory MCP is ready.
```

## Connect your AI client

The server speaks MCP over **stdio**. Point any MCP client at `node <path-to>/dist/index.js` (or `memory-mcp` if installed globally).

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json` (workspace) or your user MCP settings:

```json
{
  "servers": {
    "memory": {
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
    "memory": {
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
    "memory": {
      "command": "node",
      "args": ["C:/path/to/memory-manager-mcp/dist/index.js"]
    }
  }
}
```

```bash
claude mcp add memory -- node C:/path/to/memory-manager-mcp/dist/index.js
```

### Gemini CLI

```bash
gemini mcp add memory -- node C:/path/to/memory-manager-mcp/dist/index.js
```

### Any other MCP client

```json
{
  "memory": {
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

| Key | Meaning |
| --- | --- |
| `maxContextItems` | Max items per section in the generated briefing |
| `enableRawSessions` | Keep raw session records (summaries are always kept) |
| `search.maxResults` | Default result limit for `search_memory` |

## The MCP tools (15)

| Tool | Purpose |
| --- | --- |
| `initialize_project_context` | **Call first.** Detects/registers the project and returns a compact briefing: current task, latest handoff, completed/remaining work, problems, decisions, recommended next action. |
| `get_project_context` | Lightweight fetch of the stored project context. |
| `save_memory` | Save a curated memory (`decision`, `requirement`, `architecture`, `task`, `problem`, `solution`, `progress`, `fact`, `preference`, `constraint`, `discovery`). Pass `id` to update. |
| `get_memory` | Retrieve one memory by id. |
| `search_memory` | Ranked keyword search across memories, tasks, decisions, handoffs, session summaries and context. |
| `get_current_task` | Most relevant open task + other open tasks. |
| `update_task` | Create or update a task (`active`, `in_progress`, `completed`, `blocked`, `abandoned`). |
| `record_decision` | Record an important decision (long-lived in ranking). |
| `get_decisions` | List decisions, newest first. |
| `create_handoff` | **Call before stopping.** Structured handoff: completed, remaining, problems, changed files, next action. |
| `get_latest_handoff` | Fetch the most recent handoff (optionally with history). |
| `start_session` | Begin tracking an agent working session. |
| `finish_session` | End a session with status + summary. |
| `delete_project_memory` | Permanently delete one project's memory (`confirm: true`). |
| `clear_memory` | Permanently delete **all** memory (`confirm: true` + phrase `"delete everything"`). |

### Recommended agent workflow

1. **On start** → `initialize_project_context`. Read the briefing; continue existing work instead of restarting it.
2. **While working** → `save_memory` for distilled insights, `record_decision` for choices, `update_task` for progress.
3. **Before stopping** → `create_handoff` + `finish_session`, so the next agent (possibly in another IDE) can continue seamlessly.

A machine-readable version of this guidance lives in [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) — you can reference it from your client's rules/instructions file.

## CLI

```bash
node dist/cli/index.js <command> [--workspace <path>] [--json]

  projects                  List known projects
  project current           Detect the project for the current directory
  project inspect [id]      Inspect a project's stored memory
  memory search <query>     Search memory across a project
  handoff latest            Show the most recent handoff
  sessions                  List agent sessions
  doctor                    Diagnose the installation
  clear --all --yes         Permanently delete ALL memory
```

Examples:

```bash
node dist/cli/index.js doctor
node dist/cli/index.js project current --workspace ./my-app
node dist/cli/index.js memory search "employee permission"
node dist/cli/index.js handoff latest --json
```

## Privacy

- All data stays on your machine in `~/.agent-memory/`. Nothing is ever sent anywhere.
- Raw conversation transcripts are **never** stored by default; only distilled memories you explicitly save.
- Delete a single project with `delete_project_memory`, or everything with `memory-mcp clear --all --yes`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Client can't see the tools | Make sure `command` is an absolute path to `node` and `args[0]` is the absolute path to `dist/index.js`. Run `pnpm run build` first. |
| Wrong project detected | Check `memory-mcp project current`. Add a `.agent-memory.json` to pin an identity, or add a git remote. |
| Same repo, different memory per machine | Ensure the git remote URL is set (`git remote -v`) — it is the primary identity. |
| Anything else | Run `memory-mcp doctor` (or `pnpm run doctor`) and read the check list. |

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
