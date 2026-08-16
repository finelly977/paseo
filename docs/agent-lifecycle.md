# Agent lifecycle

How an agent is created, runs, becomes a subagent, gets archived, and disappears from the UI. The model spans the daemon (lifecycle, archive) and the client (tabs, the subagents track).

## States

```
initializing → idle → running → idle (or error → closed)
                 ↑        │
                 └────────┘  (agent completes a turn, awaits next prompt)
```

Each live agent in `AgentManager` carries a `lastStatus` of `initializing`, `idle`, `running`, or `error`. `closed` is the persisted, resumable state for an agent record that has no live provider runtime. State transitions persist to disk and stream to subscribed clients via WebSocket.

## Runtime residency

An unarchived agent may be `closed` without being deleted or archived. Closing releases its provider
processes and subscriptions while retaining its Paseo identity, persistence handle, timeline,
workspace, labels, title, usage, attention, timestamps, and parent relationship. Opening or prompting
the agent runs through `ensureAgentLoaded()`, which resumes the durable provider session under the
same Paseo agent ID. Provider history is not appended again when the canonical timeline is already
primed.

The daemon collects an eligible idle runtime after two minutes and sweeps every 15 seconds. Only
unarchived, non-internal agents that are exactly `idle`, have no active or pending run, replacement,
or permission, and have not been activated during the idle window are eligible. `running`,
`initializing`, and `error` agents stay resident. Subagents are considered independently; collection
does not cascade or change parentage.

Active schedules targeting an existing agent protect that agent from collection. Paused, completed,
and new-agent schedules do not. A pane may remain open after collection; its next prompt resumes the
runtime.

用户可以从会话菜单手动释放一个常驻运行时。手动释放只作用于对应的 Paseo 智能体 ID：
关闭提供方会话及其拥有的子进程，把智能体持久化为 `closed`，同时保留对话、原生会话句柄、
工作区、标题、标签、注意状态和错误详情。该操作不会归档或移除智能体，不会级联关闭受管
子智能体或同级会话。共享提供方服务继续遵循原有引用计数，只在最后一个使用它的会话释放后
退出。之后再次发送消息时，会恢复同一个原生会话和时间线。

提供方运行时仍可能因崩溃、内存不足或主机休眠而自行退出。驻留在进程内的工作也会随之终止：
Claude Code 的后台 Bash、`Monitor` 和工作流都运行在 CLI 进程中，原本用于唤醒智能体的完成
通知也不会再到达。运行时在回合中退出时，读取事件流的逻辑会报告错误；但运行时在回合之间
退出时原先没有观察者，智能体会继续显示为健康的 `idle` 状态，后台工作却已经丢失。现在会把
这种退出报告为回合失败，让智能体进入 `error` 状态并写入时间线。目前只有 Claude 提供方实现
了该行为，其他提供方仍只在回合正在执行时报告运行时退出。

### Cancellation

Cancellation changes lifecycle state only after the provider acknowledges the interrupt or emits a terminal turn event. If the interrupt is rejected or times out, the agent remains `running` with its active foreground turn intact. Follow-up actions such as replacement, reload, rewind, and Stop must report that failure instead of accepting work they cannot perform. Synthesizing a local cancellation without provider acknowledgment creates a split-brain session: Paseo accepts a new prompt while the provider still owns the previous foreground turn.

## Relationships

Agents can launch other agents via the agent-scoped `create_agent` MCP tool. Agent-scoped creation is always asynchronous and always stamps `paseo.parent-agent-id`, pointing back at the caller. Omit `workspaceId` to use the caller's workspace, or pass an existing workspace ID returned by `create_workspace`. Placement never changes parentage.

- **Subagents** — exist as part of the creating agent's work, appear in that agent's subagent track, and are archived with it.
- **Detached agents** — stand on their own after an explicit detach transition, do not appear in the former parent's subagent track, and are not archived with it.

Runtime ownership is resolved from explicit workspace ID and caller context, never from `cwd`. Workspace creation is a separate operation with `local | worktree` isolation; agent creation only selects an existing workspace.

Users can also detach an existing subagent from the subagents track. Detach is deliberately a manual lifecycle gesture, not an agent-facing MCP tool. It removes the `paseo.parent-agent-id` label only: it does not stop, archive, move, or restart the agent. The agent keeps its current `cwd` and `workspaceId`, leaves the former parent's track, and behaves like a root agent for tab close, workspace activity, and future parent archive.

`notifyOnFinish` defaults to `true` for agent-scoped creation and background prompt follow-ups because most delegated work needs to report back to the creating agent. Set it to `false` only for truly fire-and-forget agents or prompts.
权限请求只是通知检查点，不会结束订阅。权限响应后，如果子智能体完成、出错或再次请求权限，
调用方仍会收到后续通知。权限通知包含规范化请求、子智能体标识和请求标识，调用方无需额外
读取智能体状态即可检查并响应。

## Provider-managed child agents

Some providers can create their own child sessions inside one provider runtime. OMP's task tool reports these with `child_session` events; `AgentManager` imports the live provider handle, stamps `paseo.parent-agent-id`, and surfaces the result as a normal subagent in the parent's subagents track.

The provider still owns the underlying runtime. Paseo keeps an agent record so the child can be opened, tracked, archived, and cascaded with the parent, but prompts and history hydration route through the provider adapter for that native child handle.

## Archive

Archive is a **soft delete**: the agent record stays on disk with `archivedAt` set, the runtime is closed, and the agent disappears from active lists. Archive is **global** — it lives on the server and propagates to every connected client.

Archive is distinct from runtime collection. Archive sets `archivedAt`, invokes the provider's native
archive hook, and cascades to managed children. Runtime collection does none of those things; it only
releases the live runtime and writes `lastStatus: closed` on the still-active record.

`create_agent_request` can opt an agent into `autoArchive`. In that mode the daemon archives the agent after the first terminal turn event (`turn_completed`, `turn_failed`, or `turn_canceled`). When the agent owns an isolated workspace, auto-archive archives that workspace too; the managed worktree is removed when its final workspace reference is gone.

Archiving runs through `AgentManager.archiveAgent` (`packages/server/src/server/agent/agent-manager.ts`):

1. Snapshot the current session into the registry
2. Set `archivedAt` and normalize `lastStatus` away from `running`/`initializing`
3. Notify subscribers
4. Close the runtime (kills the process if still running)
5. **Cascade-archive children** — any agent whose `paseo.parent-agent-id` label matches the archived agent gets archived too, recursively

Cascade is what keeps subagent fleets from outliving their orchestrator.

Workspace archive is a separate lifecycle. Archiving or removing a worktree can close a surviving
agent record without setting the agent's `archivedAt`, while its `workspaceId` still points at the
archived workspace. History navigation must not infer workspace lifecycle from `agent.archivedAt`
or mutate either lifecycle. The workspace route asks the daemon for authoritative recovery state;
only the route's explicit Unarchive or Restore action changes the archived workspace.

History navigation preserves the selected agent as an explicit recovery target. If both that agent
and its workspace are archived, the workspace recovery action restores the workspace and unarchives
the selected agent as one user action. Other archived agents in the restored workspace remain
recoverable from History. Opening one pins its tab and renders the archived-agent callout. Authoritative
timeline catch-up may load provider history with a runtime-only `history` resume purpose, which must
leave both Paseo's `archivedAt` and the provider's native archive state unchanged. **Unarchive** remains
the only transition back to an interactive runtime: it runs the provider's native unarchive hook
(including Codex `thread/unarchive`) before the normal agent resume and timeline hydration flow.

Provider session connection owns every process it spawns until the session is registered with
`AgentManager`. If initialization, persisted-session resume, or initial history hydration fails,
`connect()` must dispose that process before rethrowing; the manager cannot clean up a session it never
received.

## Tabs vs archive

These are two distinct concepts that used to be conflated:

| Concept                    | Scope      | Triggers                   |
| -------------------------- | ---------- | -------------------------- |
| **Tab** (workspace layout) | Per-client | User opens/closes a view   |
| **Archive** (lifecycle)    | Global     | Explicit lifecycle gesture |

Closing a tab on any agent (root or subagent) is **layout-only**. The agent stays unarchived; the client unpins/hides the tab so reconcile does not immediately re-open it. Re-open from History, the agent list, or the subagents track. Explicit archive remains a separate lifecycle gesture (list actions / Archive menu). Implemented in `handleCloseAgentTab` (`packages/app/src/screens/workspace/workspace-screen.tsx`) via `resolveCloseAgentTabPolicy` + `hideAgent`.

Same-workspace subagents are not auto-opened as tabs; the user opens one from that track when needed. A cross-workspace subagent is also auto-opened as a tab in its own workspace so opening that workspace does not appear empty. It remains in the parent's track until it is actually detached.

## Workspace activity

Agent lifecycle status stays literal: a parent agent is `idle` when its own turn is idle, even if a child is running.

Workspace status is an aggregate activity signal computed **per `workspaceId`**. Ownership is never derived from `cwd` — many workspaces may share one directory, and same-`cwd` siblings do not clump under one status. Root agents and cross-workspace subagents contribute their normal state bucket to their own workspace. Same-workspace descendants contribute `running` to the nearest ancestor in that workspace; their non-running attention, permission, and error states stay in the parent's subagents track. This makes a cross-workspace subagent behave like a detached agent for workspace visibility and status without removing its parent relationship.

## The subagents track

The collapsible track above the composer in an agent's pane (`packages/app/src/subagents/track.tsx`) combines two kinds of children:

- **Paseo subagents** are full managed agents. Their membership rule (`packages/app/src/subagents/select.ts`) is:

```
parentAgentId === thisAgent.id  AND  !archivedAt
```

- **Provider subagents** are child executions owned by Claude, Codex, or OpenCode. They are not inserted into `AgentManager` as managed agents. Providers emit a separate descriptor and timeline stream through `agent.provider_subagents.*`; the client keeps that state outside the normal agent store and merges only the presentation rows into the track.

Clicking either kind opens a workspace tab. A Paseo subagent tab is a normal interactive agent pane. A provider subagent tab is a read-only timeline pane with no composer, archive, detach, rewind, or fork actions. Both panes use `AgentStreamView`, so message, reasoning, tool-call, and layout rendering stay identical.

Provider timelines use the same structural timeline item format but deliberately have a separate lifecycle and transport. A provider thread/session identifier is not a Paseo agent identifier, and closing its tab is always layout-only.

Archived Paseo subagents disappear from the track, by design. To remove one from the track without closing its tab, use the **archive button** on the row — it opens a confirm dialog and archives the subagent on confirm. Provider-owned rows have no individual Paseo lifecycle controls.

The track header's **Archive finished** action hides finished provider-owned rows in the current app session. Their native sessions and timelines are untouched, and managed Paseo subagents are not archived by this bulk action. If a hidden provider child starts running again, the app brings it back to the track.

To keep the agent alive but remove it from the parent's track, use **detach**. The daemon clears the parent label, emits the normal agent update, and every client reclassifies the agent from subagent to root/sibling from that updated snapshot.

## Why this shape

The decision was to **decouple "close tab" from "archive" only for subagents**, rather than universally:

- **Closing a tab on a root agent still archives** — preserves the existing UX users are trained on
- **Closing a tab on a subagent is layout-only** — fixes the lossy "click to read, close to dismiss view, lose the row" flow
- **Archive button on track rows** — gives subagents an explicit lifecycle gesture in their home surface
- **Detach button on track rows** — lets a subagent continue independently without killing its work
- **Cascade archive on parent** — keeps subagents from leaking when the parent is archived

We considered universal decoupling (no tab close ever archives, archive is always explicit) but rejected it: it changes a behavior root-agent users rely on.

## Limitations

### Subagent accumulation under long-lived parents

A parent that spawns many subagents will see the track grow. Managed Paseo subagents can be archived individually. Finished provider-owned rows can be hidden together with **Archive finished**; this is app-local presentation state and resets when the app restarts.

### Cross-client tab dismissal

Closing a subagent's tab on one client doesn't affect other clients' layouts. This is the expected behavior of decoupled tabs and is consistent with how layouts have always worked. Archive remains the global gesture for cross-client cleanup.

## Storage

```
$PASEO_HOME/agents/{cwd-with-dashes}/{agent-id}.json
```

`{cwd-with-dashes}` is derived from the agent's filesystem `cwd`. It is not the workspace id; agent storage stays cwd-keyed while workspace identity is the opaque workspace id.

Each agent is a single JSON file. Fields relevant to this doc:

| Field                             | Type          | Meaning                                                                            |
| --------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `id`                              | `string`      | Stable identifier                                                                  |
| `archivedAt`                      | `string?`     | Soft-delete timestamp (ISO 8601)                                                   |
| `labels["paseo.parent-agent-id"]` | `string?`     | Parent agent ID, set automatically for agent-scoped creation and removed by detach |
| `lastStatus`                      | `AgentStatus` | `initializing` / `idle` / `running` / `error` / `closed`                           |

See [`docs/data-model.md`](./data-model.md) for the full agent record.
