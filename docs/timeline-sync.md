# Timeline sync

Agent chat delivery has two paths:

1. **Live stream** — `agent_stream` WebSocket messages for immediacy. These may be delta-shaped lifecycle updates.
2. **Authoritative history** — `fetch_agent_timeline_request` for correctness. This always returns full projected timeline items, never lifecycle deltas.

The invariant is:

> If the daemon has committed timeline rows for an agent, any connected client that opens or resumes that agent eventually displays every row through the daemon's current tail.

Tool output is bounded before it enters either delivery path. Canonical shell tool output is sliced
to 64 KiB, and the same bounded item is used for durable timeline rows and live stream events.
Provider history hydration applies the same rule so reopening an agent cannot restore an oversized
tool payload.

## Presence is not delivery

Client heartbeat reports presence:

- device type
- app visibility
- focused agent
- last activity time

Heartbeat is used for notification routing. It must not be used as a correctness gate for `agent_stream` delivery. A stale mobile focus heartbeat may affect whether the user gets notified; it must not make timeline rows disappear from the live stream.

## Catch-up is paged but complete

Large unbounded timeline responses can exceed relay frame limits, so catch-up uses bounded pages. Bounded does not mean partial.

Page limits are projected-item targets. A tool call lifecycle is one projected item even if it spans many source sequence numbers, and assistant/reasoning chunks are merged before counting. The response carries `seqStart`, `seqEnd`, `sourceSeqRanges`, and `collapsed` so clients can advance sequence cursors without rendering delta rows.

When the app fetches `direction: "after"` and the daemon responds with `hasNewer: true`, the app must immediately fetch the next page from `endCursor`. The catch-up is complete only when `hasNewer: false`.

Initialization timeouts guard lack of catch-up progress, not the full multi-page sync. A successful page that queues the next `after` page refreshes the watchdog.

The first load of an agent without a local cursor is different: it fetches a bounded latest tail page. Older history remains user-driven by scrolling upward.

首次打开或恢复没有本地游标的会话时，只读取一页有界的最新尾部；更早的历史仍由用户向上滚动时加载。

补载或订阅协调失败后会自动重试，间隔从 1 秒开始翻倍，最高 30 秒。固定每秒重试会让持续存在的守护进程拒绝（例如同一 Codex 线程已有活动写入者）在应用空闲时也不断产生请求和日志。成功、重连、传输模式变化或真正的可见会话集合变化会重置间隔；重复发布完全相同的可见集合是空操作，不能绕过退避。

后台自动重试不打扰用户。同步错误提示中的手动重试是可能失败的用户操作，进行中状态由同步模型统一发布；重试失败后界面会回到错误状态。

到达历史起点阈值时只加载一页更早内容，并保持当前可见内容锚点。游标推进本身不会连续触发下一页；只有新页面仍不足以填满视口或历史尚未脱离起点时，才在同一次加载操作中继续分页，直到填满视口或耗尽历史。

## Durable item anchors

Provider message IDs are not guaranteed for every displayed item. Paseo-generated system errors are one example. Rendered item indices are not durable either because pagination and projection can merge source rows.

Actions that address a point in chat history, such as Fork, use the daemon timeline `epoch` plus the projected item's `seqEnd`. The app carries that position on the rendered assistant item for both live and fetched history. When adjacent projected chunks merge, the merged item retains the newer chunk's position.

The daemon validates that the epoch is current and the exact source sequence still exists before slicing rows. It slices before projection so later lifecycle updates cannot leak into the selected context.

## Resume behavior

When a client resumes with a known cursor, it catches up after that cursor to completion. It does not replace the view with a latest tail page, because tail pagination can skip the middle of a long background run.

When a client resumes without a cursor, it fetches the latest tail page.

## Client replica lifetime

The host runtime owns each session replica for as long as the host remains registered. React
providers attach message handlers and UI integrations to that replica, but mounting or unmounting a
provider must not create or clear it. A provider can remount during Fast Refresh or ordinary UI
recomposition while the runtime still owns the same directory snapshot and timeline cursors.

Removing the host from the registry is the destructive boundary: it stops the runtime and clears the
session and host-scoped setup state together.

## Selective and legacy delivery

The app chooses one delivery policy from `server_info.features.selectiveAgentTimeline`:

- 选择性投递的守护进程接收所有面板可见会话的并集，新增会话立即订阅并补载。任何由可见性
  引起的移除都保留 30 秒订阅宽限，避免短暂切换标签、面板、路由或应用时反复退订和补载。
  初始化和运行中会话即使没有可见面板也始终保留订阅，停止后再应用同一宽限期。窗口失去键盘焦点不会让
  已选面板变为不可见；断开连接或销毁同步器会清除待执行的宽限期，因为此时订阅本身已不存在。面板重新可见时，
  即使仍在宽限期内，也必须从本地游标执行权威增量补载；应用重新聚焦时对当前可见和运行中会话执行同样的核对。
  实时投递仍是快速路径，权威补载则保证偶发丢失的事件不会让已完成会话永久停留在旧记录。
- Legacy daemons keep globally streaming agent timelines. Visibility still triggers the existing
  authoritative catch-up, but the app does not issue selective-subscription RPCs.

This policy is owned by `viewed-timeline-sync.ts`; downstream reducers do not branch on daemon
version.

## Projected pages reconcile with live presentation

A projected page is canonical state, not a sequence of live deltas. One projected item can overlap
rows already received live—for example, a tool call retained at its original display position while
its completion advances `seqEnd`, followed by a merged assistant message. The app uses
`sourceSeqRanges` to replace overlapping assistant and reasoning projections before applying the
remaining page through the existing stream reducer. It must not append full projected text to a
live prefix.

Optimistic user prompts occupy stable timeline slots. Catch-up never extracts, delays, or reinserts
them. A canonical user row replaces its matching slot in place; an unmatched prompt stays exactly
where the user submitted it. Other canonical rows are applied after the already-present timeline
instead of relocating visible user messages around newly fetched history.

Canonical submitted user rows carry the provider's `messageId` and Paseo's optional
`clientMessageId`. Clients reconcile optimistic prompts by `clientMessageId`. Content matching is
limited to the dated compatibility path for daemon timelines created before that field existed.

## Relevant code

- Server live stream forwarding: `packages/server/src/server/session.ts`
- App sync planning: `packages/app/src/timeline/timeline-sync-plan.ts`
- App viewed-agent synchronization: `packages/app/src/timeline/viewed-timeline-sync.ts`
- App stream/timeline reducer: `packages/app/src/timeline/session-stream-reducers.ts`
- Session wiring: `packages/app/src/contexts/session-context.tsx`
