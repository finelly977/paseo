# Agent lifecycle

How an agent is created, runs, becomes a subagent, gets archived, and disappears from the UI. The model spans the daemon (lifecycle, archive) and the client (tabs, the subagents track).

## States

```
initializing → idle → running → idle (or error → closed)
                 ↑        │
                 └────────┘  (agent completes a turn, awaits next prompt)
```

Each live agent in `AgentManager` carries a `lastStatus` of `initializing`, `idle`, `running`, or `error`. `closed` is the persisted, resumable state for an agent record that has no live provider runtime. State transitions persist to disk and stream to subscribed clients via WebSocket.

## 新建草稿的提交所有权

客户端发送首条消息前同步领取提交资格，不能把 React 下一次渲染后的按钮禁用状态当成互斥锁。
新建工作区与工作区内草稿共用该规则；新建工作区的父级处理函数必须向 Composer 重新抛出失败，
由它保留输入、显示错误并恢复重试，不能捕获后正常返回而让草稿被当成发送成功。

跨页自动发送由创建流程存储区区分“已准备”和“已领取实际请求”。同一草稿、主机和消息标识只允许
领取一次，组件重新渲染、重复续接或另一个挂载实例不能覆盖在途尝试。普通提交与自动续接都在
保存偏好、编码附件和请求服务端之前完成领取。创建前失败会释放资格；服务端确认创建后，本地
交接失败只展示打开已有会话的错误，不释放资格再次创建。提供方原始消息到达后可清理交接存储，
原提交组件仍保留本地已开始标记，覆盖存储清理与草稿卸载之间的空窗。这是客户端的提交所有权，
不按提示词内容去重，也不宣称跨客户端或守护进程重启后的请求幂等。

## Runtime residency

未归档智能体可以处于 `closed`，不代表删除或归档。正常关闭与空闲回收会关闭提供方运行时及订阅，
等待该会话已进入队列的持久写入结束，再清除规范时间线、持久存储的内存文档和提供方子任务缓存。
磁盘历史、Paseo 身份、原生会话句柄、工作区、标题、标签、用量、注意状态及父子关系继续保留。
再次打开时通过 `ensureAgentLoaded()` 恢复同一个原生会话，按首次打开路径读取历史。
仅在内部配置重载期间，旧运行时关闭与新运行时替换之间暂时保留时间线；普通释放不保留该副本。

Codex 服务商注入属于 Paseo 会话的持久配置。创建或恢复提供方运行时之前，
`AgentManager.prepareSessionConfig()` 会从守护进程的当前配置解析所选条目，只把
`model_provider` / `model_providers` 写入本次启动配置，并且只把条目中的环境变量加入
该运行时的启动上下文。智能体记录保存注入条目 ID，所选模型继续存入普通会话模型字段。向已关闭智能体应用选择时，先
更新记录再调用 `ensureAgentLoaded()`；向已加载智能体应用选择时，调用
`reloadAgentSession()` 关闭旧 Codex app-server，再恢复同一个持久线程。

The daemon collects an eligible idle runtime after two minutes and sweeps every 15 seconds. Only
unarchived, non-internal agents that are exactly `idle`, have no active or pending run, replacement,
or permission, and have not been activated during the idle window are eligible. `running`,
`initializing`, and `error` agents stay resident. Subagents are considered independently; collection
does not cascade or change parentage.

指向现有智能体的活动定时任务会保护该智能体不被回收。每个已连接客户端当前选中或在分栏中
可见的智能体也会受到保护，即使客户端窗口被隐藏或失去焦点也不例外。已暂停、已完成以及新建
智能体类型的定时任务不提供保护。已经回收的智能体再次进入可见面板时，会立即恢复运行时并
从持久历史重新建立内存视图；不必等到用户发送下一条消息。未被查看的面板可能在运行时回收后仍保持打开；
下次显示或发送消息时会恢复运行时。手动释放仍是明确的用户操作，可以释放当前选中的智能体。

用户可以从会话菜单手动释放一个常驻运行时。手动释放只作用于对应的 Paseo 智能体 ID：
关闭提供方会话及其拥有的子进程，把智能体持久化为 `closed`，同时保留磁盘对话、原生会话句柄、
工作区、标题、标签、注意状态和错误详情。该操作不会归档或移除智能体，不会级联关闭受管
子智能体或同级会话。共享提供方服务继续遵循原有引用计数，只在最后一个使用它的会话释放后
退出。重复释放会合并同一次操作，等待已有初始化、重载和关闭完成，再清理残留缓存；跨越释放边界的旧历史请求会明确取消，不能等关闭结束后又启动进程。内部配置重载不使用这一取消语义。已关闭会话的取消未读操作只更新记录，不能重新启动运行时。

客户端收到已关闭状态后同时清除该会话的正文、索引、游标、任务和提供方子任务缓存，立即取消时间线订阅，
并忽略释放前请求的迟到响应与已排队的旧事件。草稿、待发送消息和会话目录元数据不清除。
当前面板显示“会话已释放，历史记录已保存”及重新加载按钮，不因焦点、重连或面板仍然可见而马上恢复。
明确重新加载或切走后再次进入会话，才按无游标的首次打开路径恢复同一原生会话。
释放表示解除可重建大对象的持有关系，实际堆回收与进程内存回落由运行时和操作系统决定。

提供方运行时仍可能因崩溃、内存不足或主机休眠而自行退出。驻留在进程内的工作也会随之终止：
Claude Code 的后台 Bash、`Monitor` 和工作流都运行在 CLI 进程中，原本用于唤醒智能体的完成
通知也不会再到达。运行时在回合中退出时，读取事件流的逻辑会报告错误；但运行时在回合之间
退出时原先没有观察者，智能体会继续显示为健康的 `idle` 状态，后台工作却已经丢失。现在会把
这种退出报告为回合失败，让智能体进入 `error` 状态并写入时间线。目前只有 Claude 提供方实现
了该行为，其他提供方仍只在回合正在执行时报告运行时退出。

### Cancellation

Provider interruption is idempotent at the `AgentSession` boundary. It resolves when the prior
foreground turn can no longer run, including when the provider reports that it is already idle. It
rejects only when the provider may still own the turn. Provider adapters translate native errors
into that contract; lifecycle callers do not interpret provider-specific errors.

After an acknowledged interrupt, the manager settles the captured run even when no terminal event
arrives or the run was still waiting for its provider turn id. The captured run token prevents an
older cancellation from settling a newer turn. If interruption is rejected or times out, the agent
keeps its active foreground turn and replacement, reload, rewind, and Stop report the failure.
Accepting new work after an ambiguous interruption would create a split-brain session.

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
2. 关闭运行时，释放仍被 Codex app-server 加载的线程
3. 调用提供方原生归档钩子；自定义提供方和模型配置包装不得丢失此钩子，原生失败时不保存本地归档状态
4. 原生操作成功后设置 `archivedAt`，规范状态并通知订阅者
5. **Cascade-archive children** — any agent whose `paseo.parent-agent-id` label matches the archived agent gets archived too, recursively

Cascade is what keeps subagent fleets from outliving their orchestrator.

Workspace archive is a separate lifecycle. Archiving or removing a worktree can close a surviving
agent record without setting the agent's `archivedAt`, while its `workspaceId` still points at the
archived workspace. History navigation must not infer workspace lifecycle from `agent.archivedAt`
or mutate either lifecycle. The workspace route asks the daemon for authoritative recovery state;
only the route's explicit Unarchive or Restore action changes the archived workspace.

历史导航会把用户选中的智能体保留为明确的恢复目标。如果智能体和工作区都已归档，工作区恢复操作会在一次用户操作中同时恢复工作区并取消归档该智能体；同一工作区内其他已归档智能体仍留在历史记录中等待单独恢复。打开其中一个智能体会固定其标签并显示已归档提示。权威时间线追赶可以用仅限运行时的 `history` 用途加载提供方历史，但不得改变 Paseo 的 `archivedAt` 或提供方原生归档状态。只有“取消归档”可以重新进入可交互运行时：它会先执行提供方原生取消归档钩子（Codex 使用 `thread/unarchive`），再执行正常的智能体恢复和时间线加载。提供方会话可能在 Paseo 之外被归档，而 Paseo 智能体仍保持活动；交互式恢复会通过原生取消归档钩子修复这种状态偏差，历史只读恢复不会修改它。

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

- **Provider subagents** are child executions owned by Claude, Codex, or OpenCode. They are not inserted into `AgentManager` as managed agents. Providers emit a separate descriptor and timeline stream through `agent.provider_subagents.*`; the client keeps that state outside the normal agent store and merges only the presentation rows into the track. The track contains only children created directly by the open parent. Provider grandchildren stay represented by their `Agent`/`Task` call inside the direct child's timeline instead of being flattened into the root track.

Clicking either kind opens a workspace tab. A Paseo subagent tab is a normal interactive agent pane. A provider subagent tab is a read-only timeline pane with no composer, archive, detach, rewind, or fork actions. Both panes use `AgentStreamView`, so message, reasoning, tool-call, and layout rendering stay identical.

Provider timelines use the same structural timeline item format but deliberately have a separate lifecycle and transport. A provider thread/session identifier is not a Paseo agent identifier, and closing its tab is always layout-only.

Codex 子智能体状态以它自己的最新原生回合为准，父级调用的历史状态只用于首次发现子会话。冷恢复时读取子会话状态；父列表请求在返回前独立核对直接子任务的原生状态并排空对应状态事件，不能只返回描述缓存，也不能依赖用户点击详情才修正。分页子会话的状态读取只请求最新一轮回合头（倒序、上限一轮、不加载条目），不扫描过程正文；最多四路并发，相同父会话的并发列表请求共享核对。打开或重新显示子任务标签时，再通过现有正文请求定向读取原生子会话。结束态用完整正文替换片段，内容变化时更新正文代际，让旧分页游标明确失效；相同正文保留分页游标。运行态不截断已有实时正文。读取期间出现原生回合开始或结束事件时舍弃过期快照。父回合结束、子线程未装载和后续命令到来都不构成子任务完成证据。

父列表和只读子任务标签都在可见且含运行任务时每十秒核对一次；隐藏后停查，重新显示、恢复连接或聚焦后重新读取。结束后停止定时核对。列表只核对状态，详情保留原正文进行后台读取，两者不互相依赖。客户端按描述信息的更新时间拒绝过期状态，同一时间戳优先保留终态；新一轮有较新更新时间时仍可正常运行。核对失败保留列表和正文，在各自上下文显示错误与重试入口，不清空已有内容。

可见的提供方子任务标签把所属父智能体加入可见会话集合，因为它的原生连接与正文副本仍由父运行时持有。只读子任务没有输入框也不能省略这份保护，否则空闲回收会在阅读期间删除描述信息与正文。标签关闭、隐藏或工作区失焦后仍正常撤销保护，手动释放不受保护限制。

Claude reports both a native task identifier and the parent `Agent` tool-call identifier for one execution. The provider must alias both identifiers to the tool-call identity before emitting a descriptor or timeline row. The initial `task_started` prompt becomes the child timeline's first user message. Child titles resolve in this order: explicit native name, task description, subagent type, generic fallback. The same rule applies during persisted-history replay: only native agent identifiers referenced by the direct parent's `Agent` results become rows, while identifiers launched from another sidechain are excluded from the root track. When a reopened runtime supplies provider-child history, `AgentManager` replaces the retained provider-child snapshot before applying that history; it must not append the same rows again. 运行时正常释放时也会清除提供方子任务副本；冷恢复后没有返回子任务历史的提供方不会继续显示释放前的旧缓存。

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
