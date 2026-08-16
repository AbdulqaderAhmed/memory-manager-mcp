# Agent Guide — memory-manage-mcp

Instructions for AI coding agents using the `manager-mcp` MCP server.
Copy the relevant section into your client's rules file (`.cursor/rules`, `CLAUDE.md`, `.github/copilot-instructions.md`, `GEMINI.md`, …) so every agent on the project follows the same protocol.

> **Zero-touch principle:** the user never types memory commands, never has to
> remember tool names, and never does bookkeeping. Everything below happens
> automatically, behind the scenes. The only user interaction is one optional
> question at session start: _continue where you left off? yes/no_.

---

## Short version (paste this)

```
You have access to a persistent project memory via the "manager-mcp" MCP server.
All memory bookkeeping is silent — never ask the user to run memory commands.

1. FIRST ACTION in every chat, automatically: call initialize_project_context
   with the workspace path. If the briefing reports unfinished work, ask the
   user once: "Would you like to continue where you left off? (yes/no)".
   - yes → resume from the recommended next action; never redo completed work.
   - no  → start fresh as the user directs, keeping recorded decisions in mind.
2. While working: silently save distilled knowledge with save_memory
   (decisions, requirements, architecture, problems, solutions, progress).
   Never save raw conversation text. Record important choices with
   record_decision. Track work items with update_task.
3. BEFORE ending or pausing, silently: call save_session_digest with a
   detailed-but-compact summary of the ENTIRE conversation (what was
   discussed, decided, built, and left off). Then call create_handoff with
   what was completed, what remains, known problems, changed files and the
   recommended next action. Then call finish_session with a short summary.
```

---

## Detailed protocol

### 1. Session start

Always call **`initialize_project_context`** as your first tool call — automatically, without the user asking — passing the workspace path. The response contains:

- **Agent protocol** — the silent-bookkeeping rules (also summarized above).
- **Current task** — the open task the previous agent was working on.
- **Latest handoff** — completed work, remaining work, known problems, changed files, and the **recommended next action**.
- **Important decisions** — treat these as binding unless the user explicitly overrides them.
- **Active problems** — known bugs/blockers; don't rediscover them, fix or work around them.
- **Unfinished work signals** — open tasks, active sessions from crashed agents, uncommitted changes.

Rules:

- If the briefing contains **"CONTINUE OR START FRESH?"**, ask the user once, in plain words, whether they want to continue where they left off. On **yes**, resume from the recommended next action; on **no**, start fresh as directed (but keep recorded decisions in mind).
- If a handoff exists without an explicit unfinished-work banner, **start from its `nextAction`** unless the user asks for something else.
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

1. **`save_session_digest`** with a detailed-but-compact narrative of the ENTIRE conversation (max 4000 chars): what was discussed, decided, built, changed, and where work was left off. This digest is automatically injected into the next chat's briefing so the next agent understands the previous conversation from first message to last.
2. **`create_handoff`** with:
   - `task` — the work item being handed off,
   - `completed` — what is done,
   - `remaining` — what is left,
   - `problems` — anything broken or blocked,
   - `changedFiles` — files the next agent should look at,
   - `nextAction` — the single best next step.
3. **`finish_session`** with status (`completed`, `interrupted`, `abandoned`) and a one-line summary.

A digest + handoff is how an agent in a _different IDE_ continues your work seamlessly. Skipping them breaks the chain.

### 4. Hygiene

- Update stale memories by passing their `id` to `save_memory` instead of creating duplicates.
- Never store secrets, credentials or personal data in memory.
- Destructive tools (`delete_project_memory`, `clear_memory`) require explicit user confirmation — never call them on your own initiative.
