# Agent Guide — memory-mcp

Instructions for AI coding agents using the `memory` MCP server.
Copy the relevant section into your client's rules file (`.cursor/rules`, `CLAUDE.md`, `.github/copilot-instructions.md`, `GEMINI.md`, …) so every agent on the project follows the same protocol.

---

## Short version (paste this)

```
You have access to a persistent project memory via the "memory" MCP server.

1. FIRST ACTION in any session: call initialize_project_context with the
   workspace path. Read the briefing and CONTINUE existing work — do not
   restart completed work or contradict recorded decisions.
2. While working: save distilled knowledge with save_memory (decisions,
   requirements, architecture, problems, solutions, progress). Never save
   raw conversation text. Record important choices with record_decision.
   Track work items with update_task.
3. BEFORE ending or pausing: call create_handoff with what was completed,
   what remains, known problems, changed files and the recommended next
   action. Then call finish_session with a short summary.
```

---

## Detailed protocol

### 1. Session start

Always call **`initialize_project_context`** as your first tool call, passing the workspace path. The response contains:

- **Current task** — the open task the previous agent was working on.
- **Latest handoff** — completed work, remaining work, known problems, changed files, and the **recommended next action**.
- **Important decisions** — treat these as binding unless the user explicitly overrides them.
- **Active problems** — known bugs/blockers; don't rediscover them, fix or work around them.
- **Unfinished work signals** — open tasks, active sessions from crashed agents, uncommitted changes.

Rules:

- If a handoff exists, **start from its `nextAction`** unless the user asks for something else.
- If the briefing says "no previous memory exists", you are the first agent — work normally and establish memory as you go.
- Never redo work listed under "completed".

### 2. During the session

- Call **`start_session`** when beginning substantial work (optional but recommended).
- Save memories as you learn things the next agent will need:
  - `save_memory` with types: `requirement`, `decision`, `architecture`, `task`, `problem`, `solution`, `progress`, `fact`, `preference`, `constraint`, `discovery`.
  - Write **distilled, self-contained** content. Good: "Leave approval requires manager role (RBAC)." Bad: "the user said something about permissions".
  - Set `importance` honestly: 0.9+ for things that would break the project if forgotten, ~0.5 for routine notes.
- Use **`record_decision`** for significant choices (with rationale/alternatives when known) — decisions stay relevant in ranking much longer than other memory types.
- Use **`update_task`** to create/track work items; mark tasks `completed` when done.
- Use **`search_memory`** before asking the user something that may already be known, and before re-investigating a problem.

### 3. Session end

Before stopping — even for a short pause — always:

1. **`create_handoff`** with:
   - `task` — the work item being handed off,
   - `completed` — what is done,
   - `remaining` — what is left,
   - `problems` — anything broken or blocked,
   - `changedFiles` — files the next agent should look at,
   - `nextAction` — the single best next step.
2. **`finish_session`** with status (`completed`, `interrupted`, `abandoned`) and a one-line summary.

A handoff is how an agent in a _different IDE_ continues your work seamlessly. Skipping it breaks the chain.

### 4. Hygiene

- Update stale memories by passing their `id` to `save_memory` instead of creating duplicates.
- Never store secrets, credentials or personal data in memory.
- Destructive tools (`delete_project_memory`, `clear_memory`) require explicit user confirmation — never call them on your own initiative.
