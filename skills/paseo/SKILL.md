---
name: paseo
description: Paseo reference for managing workspaces, workspace scripts, agents, schedules, and heartbeats.
---

Paseo is a remote daemon that manages coding agents, terminals. Control it through MCP tools or the CLI.

## Workspaces

**`create_workspace`** — create a workspace independently of any agent. Required: `isolation` (`local` or `worktree`). Worktree isolation supports `mode: "branch-off" | "checkout-branch" | "checkout-pr"`: use `branchName`/`baseBranch` for a new branch, `branch` for an existing branch, or `prNumber` plus optional `forge`/`projectPath` for a change request. `worktreeSlug` controls the managed path. Returns the workspace descriptor centered on `workspaceId`.

**`list_workspaces`** — list active workspaces.

**`archive_workspace`** — `{ workspaceId }`. Archives the workspace, its agents, and its terminals. Local directories remain; Paseo removes an owned worktree only after its final active workspace reference is archived.

**`rename_workspace`** — `{ workspaceId, name }`. Rename workspace.

## Workspace scripts

Configured `paseo.json` scripts use the same supervised lifecycle from tools and the CLI.

**`list_workspace_scripts`** — `{ workspaceId }`. Lists configured scripts with lifecycle, service port, proxy URLs, health, exit code, and terminal ID.

**`start_workspace_script`** — `{ workspaceId, scriptName }`. Starts one configured script through Paseo's managed workspace-script launcher and returns its status metadata.

**`stop_workspace_script`** — `{ workspaceId, scriptName }`. Stops a running script through its supervised terminal and returns the stopped status metadata.

The matching CLI surface accepts either an explicit workspace ID or resolves the current directory:

```bash
paseo script ls [--cwd <path> | --workspace <workspace-id>]
paseo script start <name> [--cwd <path> | --workspace <workspace-id>]
paseo script stop <name> [--cwd <path> | --workspace <workspace-id>]
```

## Agents

Inside a Paseo-managed agent session (`PASEO_AGENT_ID` / Paseo MCP tools present), prefer Paseo MCP tools to create or contact other agents/Codex sessions instead of shelling out to external delegation wrappers (such as `codexhost` or `codex exec resume`), unless the user explicitly asks for those tools.

**`create_agent`** — required: `title`, `initialPrompt`, plus either `provider` (`claude/opus`, `codex/gpt-5.4`, …) or `profile` (saved profile id/name from `list_profiles`). Optional: `workspaceId`, `notifyOnFinish`, `settings`, `labels`. The server validates provider availability, `model`, `modeId`, and `thinkingOptionId` upfront and returns `{ agentId, workspaceId, sessionId, model, thinkingOptionId, effectiveThinkingOptionId, currentModeId, features, … }`. Read the effective settings straight from the `create_agent` response rather than following up with `get_agent_status`.

Initial runtime settings live under `settings`: `modeId`, `thinkingOptionId`, and provider-specific `features`. Explicit `provider` or `settings` fields override values from `profile`. For Codex fast mode, pass `settings: { features: { "fast_mode": true } }` when creating the agent.

Agent-scoped creation always creates your subagent. Omit `workspaceId` to use your current workspace; pass a workspace returned by `create_workspace` for isolated delegation. Placement never changes parentage.

Detach is an explicit user action in the subagents track, not an agent tool. A cross-workspace child remains your subagent even though it also appears as a normal tab in its workspace.

Agent-scoped `create_agent` defaults `notifyOnFinish` to true. Set it to `false` only for truly fire-and-forget agents.

**`send_agent_prompt`** — `{ agentId, prompt }`. Use for follow-ups to an existing agent. `agentId` accepts a Paseo `agentId`, a unique `shortId`/prefix (>= 4 chars), or a provider native `sessionId`/`threadId` (such as a Codex session UUID) across workspaces — call `send_agent_prompt` directly when you already have any of these IDs instead of probing `list_agents` or local session files first. Agent-scoped prompt calls default to `background: true` and `notifyOnFinish: true`; top-level calls default to blocking with no callback. Keep the default `background: true` for normal agent-to-agent follow-ups — if you have nothing else to do, end your turn and let Paseo wake you via the finish notification. Only pass `background: false` when you expect a quick turn under 30s and genuinely need the reply in the same turn (if it times out while still running and `notifyOnFinish` is true, Paseo automatically arms a finish notification).

**`get_agent_status` / `get_agent_activity` / `cancel_agent` / `kill_agent` / `set_agent_mode` / `respond_to_permission`** — also accept Paseo `agentId`, unique `shortId`/prefix, or provider native `sessionId`.

**`update_agent`** — `{ agentId, name?, labels?, settings? }`. Use `settings` for runtime changes on an existing agent: `modeId`, `model`, `thinkingOptionId`, and provider-specific `features`. For Codex fast mode, pass `settings: { features: { "fast_mode": true } }`.

**`list_agents`** — returns compact metadata including `workspaceId` and `sessionId`. Filter by `cwd`, `allWorkspaces`, `sessionId`, `query`, `statuses`, `sinceHours`, `includeArchived`.

**`archive_agent`** — `{ agentId }`. Interrupts if running, removes from active list.

## Agent profiles and provider discovery

**`list_profiles`** — named launch bundles configured by the human. Call this when choosing an open-ended delegate (advisor, committee, handoff, or unspecified role) and read every profile's `notes` to pick the best fit. Skip `list_profiles` when the user or a dedicated skill already specifies the exact `provider/model` and settings.

Pass the selected profile's id or name directly as `create_agent`'s `profile` parameter (or override individual `provider` / `settings` fields on `create_agent`). Do not remember a selected profile or infer drift later; a profile is only launch configuration.

If no profile fits, or no profiles are configured, use the provider discovery tools below rather than guessing. Tell the user when you fall back because no configured profile fits.

When you already have a concrete `provider/model` and settings (from the user or `orchestration-preferences.json`), call `create_agent` directly — do not run `list_providers`, `list_models`, and `inspect_provider` ritualistically before every dispatch. Call discovery tools only when choosing an unknown target, looking up feature IDs, or diagnosing a `create_agent` validation error.

**`list_providers`** — compact provider availability and modes.

**`list_models`** — full model list for one provider. Use only when you need model IDs or thinking options; the list can be large.

**`inspect_provider`** — compact provider capability and feature inspection. Required: `provider`; pass `cwd` when you are not in an agent-scoped session. Optional: `settings` with draft `model`, `modeId`, `thinkingOptionId`, and `features`.

Only set feature IDs returned by `inspect_provider`. For Codex fast mode, look for `fast_mode` and pass `settings: { features: { "fast_mode": true } }` to `create_agent` or `update_agent`.

## Schedules and heartbeats

**`create_schedule`** — starts a new agent on a cron cadence. Required: `prompt`, `cron`, `provider`. Optional: `timezone`, `name`, `cwd`, `maxRuns`, `expiresIn`. Use when the recurring work should live in fresh agents.

**`create_heartbeat`** — sends you a prompt on a cron cadence. Required: `prompt`, `cron`. Optional: `timezone`, `name`, `maxRuns`, `expiresIn`. Use for reminders, PR/build babysitting, and status checks that should return to this conversation.

**`delete_heartbeat`** stops it. MCP intentionally exposes no heartbeat update tool; delete and recreate when its task or cadence changes.

Schedules have the full list/inspect/update/pause/resume/run-once/log/delete surface. Heartbeats deliberately do not.

## Models

`claude/sonnet` (default), `claude/opus` (harder reasoning), `codex/gpt-5.4` (frontier coding), `claude/haiku` (tests only).

## Orchestration preferences

User-specific configuration at `~/.paseo/orchestration-preferences.json`. **Before any Paseo skill chooses a provider or creates an agent, it must read this file.** Reading means an actual file read, not relying on these examples or defaults. Never hardcode a provider string in another skill — resolve through this file.

Two parts:

- `providers` — map of role categories to provider strings. Pass straight to `create_agent`'s `provider` field.
- `preferences` — freeform string array. Read on startup; weave into agent prompts contextually.

Categories: `impl`, `ui`, `research`, `planning`, `audit`. Skills pick the category that matches the role they're launching.

```json
{
  "providers": {
    "impl": "codex/gpt-5.4",
    "ui": "claude/opus",
    "research": "codex/gpt-5.4",
    "planning": "codex/gpt-5.4",
    "audit": "codex/gpt-5.4"
  },
  "preferences": [
    "Claude Opus is the right choice for anything artistic or human-skill-oriented: copywriting, naming, UX copy, visual design, styling. Codex is the workhorse for mechanical work."
  ]
}
```

If the file is missing, use sensible defaults and tell the user once.

## Waiting

Agents take time — 10–30+ minutes is routine. Favor asynchronous workflows.

For agent-scoped `create_agent` and `send_agent_prompt`, leave `notifyOnFinish` omitted or set it to `true` unless the work is truly fire-and-forget. You will get notified automatically in a new turn when the target agent finishes, errors, or needs permission.

- If you have other independent work to do, continue doing it.
- If you have nothing else to do while waiting, briefly tell the user you are waiting for the delegated agent(s) and **end your turn** (go idle). Paseo will wake you automatically when the notification arrives.
- **Never** run `sleep` / `Start-Sleep` or poll `list_agents` / `get_agent_status` / `get_agent_activity` in a loop to wait for a running agent.

## CLI semantics

The CLI and tools use the same ownership semantics even where their syntax differs:

```bash
paseo workspace create --isolation worktree --mode branch-off --new-branch fix-x --base main
paseo workspace create --isolation worktree --mode checkout-branch --branch existing-work
paseo workspace create --isolation worktree --mode checkout-pr --pr-number 42
paseo run --provider codex/gpt-5.4 --mode full-access --workspace <workspace-id> "<prompt>"
paseo run --provider codex/gpt-5.4 --mode full-access --new-workspace worktree --worktree-mode branch-off --new-branch fix-x --base main "<prompt>"
paseo send <agent-id> "<follow-up>"
paseo ls
paseo schedule create --cron "*/15 * * * *" "ping main build"
paseo heartbeat create --cron "*/15 * * * *" "check the build"
```

Discover with `paseo --help` and `paseo <cmd> --help`.

For product questions, setup, logs, version problems, or troubleshooting, use the **paseo-help** skill.
