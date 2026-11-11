import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import {
  hydrateStreamState,
  isAgentToolCallItem,
  type CompactionItem,
  type NativeHistoryProcessItem,
  type StreamItem,
} from "@/types/stream";
import type { NativeHistoryDetails } from "./native-history-details";

const completedDetailsCache = new WeakMap<
  NativeHistoryProcessItem,
  WeakMap<AgentTimelineItem[], StreamItem[]>
>();

/** 展开的历史过程进入普通消息流，再走现有命令分组和外层虚拟化。 */
export function presentNativeHistoryProcesses(input: {
  tail: StreamItem[];
  expandedTurnIds: ReadonlySet<string>;
  detailsByTurn: ReadonlyMap<string, NativeHistoryDetails>;
}): StreamItem[] {
  let changed = false;
  const result = input.tail.flatMap((item) => {
    if (item.kind !== "native_history_process" || item.status === "inProgress") return [item];
    const details = input.detailsByTurn.get(item.turnId);
    if (!details) return [item];
    const preview = details.complete ? nativeHistoryInterruptedReply(item, details.items) : [];
    const previewSource =
      preview.length > 0
        ? details.items.findLast(
            (entry) => entry.type === "assistant_message" && entry.text.trim().length > 0,
          )
        : undefined;
    const inserted: StreamItem[] = [];
    if (input.expandedTurnIds.has(item.turnId)) {
      let byItems = completedDetailsCache.get(item);
      if (!byItems) {
        byItems = new WeakMap();
        completedDetailsCache.set(item, byItems);
      }
      let rows = byItems.get(details.items);
      if (!rows) {
        const summaryIds = new Set(item.summaryMessageIds);
        rows = hydrateNativeHistoryDetails(
          item,
          details.items.filter(
            (entry) =>
              entry !== previewSource &&
              !(
                "messageId" in entry &&
                typeof entry.messageId === "string" &&
                summaryIds.has(entry.messageId)
              ),
          ),
        );
        for (const row of rows) {
          row.id = `native-detail:${item.turnId}:${row.id}`;
          row.nativeTurnId = item.turnId;
          row.nativePageCursor = item.nativePageCursor;
        }
        byItems.set(details.items, rows);
      }
      inserted.push(...rows);
    }
    for (const row of preview) {
      row.id = `native-preview:${item.turnId}:${row.id}`;
      row.nativeTurnId = item.turnId;
    }
    inserted.push(...preview);
    if (inserted.length > 0) changed = true;
    return [item, ...inserted];
  });
  return changed ? result : input.tail;
}

const activeDetailsCache = new WeakMap<
  NativeHistoryProcessItem,
  WeakMap<AgentTimelineItem[], { turnId: string; rows: StreamItem[] }>
>();
const activeTailCache = new WeakMap<StreamItem[], StreamItem[]>();

function activeDetailRows(
  process: NativeHistoryProcessItem,
  details: AgentTimelineItem[],
  turnId: string,
): StreamItem[] {
  let byDetails = activeDetailsCache.get(process);
  if (!byDetails) {
    byDetails = new WeakMap();
    activeDetailsCache.set(process, byDetails);
  }
  let cached = byDetails.get(details);
  if (!cached || cached.turnId !== turnId) {
    const rows = hydrateNativeHistoryDetails(process, details);
    for (const row of rows) {
      row.turnId = turnId;
      row.id = `native-active:${process.turnId}:${row.id}`;
    }
    cached = { turnId, rows };
    byDetails.set(details, cached);
  }
  return cached.rows;
}

interface ActiveHistoryIndexInput {
  existing: StreamItem[];
  process: NativeHistoryProcessItem;
  activeTurnId: string | null;
}

function indexActiveHistory(input: ActiveHistoryIndexInput) {
  const { existing, process } = input;
  const belongsToActiveProcess = (entry: StreamItem) =>
    entry.turnId === undefined ||
    entry.turnId === process.turnId ||
    entry.turnId === input.activeTurnId;
  const replacements = new Map<StreamItem, StreamItem | null>();
  const liveMessageIds = new Set(
    existing.flatMap((entry) =>
      entry.nativeTurnId === undefined &&
      belongsToActiveProcess(entry) &&
      entry.kind === "assistant_message" &&
      entry.messageId
        ? [entry.messageId]
        : [],
    ),
  );
  const messages = new Map<string, StreamItem[]>();
  const tools = new Map<string, StreamItem>();
  const compactions = new Map<string, CompactionItem>();
  const liveCompactionIds = new Set(
    existing.flatMap((entry) =>
      entry.nativeTurnId === undefined &&
      belongsToActiveProcess(entry) &&
      entry.kind === "compaction" &&
      entry.compactionId
        ? [entry.compactionId]
        : [],
    ),
  );
  for (const entry of existing) {
    if (!belongsToActiveProcess(entry)) continue;
    if (
      entry.nativeTurnId === process.turnId &&
      entry.kind === "compaction" &&
      entry.compactionId &&
      liveCompactionIds.has(entry.compactionId)
    ) {
      replacements.set(entry, null);
      continue;
    }
    if (
      entry.nativeTurnId === process.turnId &&
      entry.kind === "assistant_message" &&
      entry.messageId &&
      liveMessageIds.has(entry.messageId)
    ) {
      replacements.set(entry, null);
      continue;
    }
    if ("messageId" in entry && entry.messageId) {
      const rows = messages.get(entry.messageId) ?? [];
      rows.push(entry);
      messages.set(entry.messageId, rows);
    }
    if (isAgentToolCallItem(entry)) tools.set(entry.payload.data.callId, entry);
    if (entry.kind === "compaction" && entry.compactionId)
      compactions.set(entry.compactionId, entry);
  }
  return { messages, tools, compactions, replacements };
}

/** 活动回合的读取元数据不进入视口；已读过程直接补入普通消息流，继续由外层虚拟列表管理。 */
export function presentNativeHistoryActiveTurn(input: {
  tail: StreamItem[];
  head: StreamItem[];
  process: NativeHistoryProcessItem | undefined;
  details: AgentTimelineItem[];
  activeTurnId: string | null;
  error?: string | null;
}): { tail: StreamItem[]; head: StreamItem[] } {
  const { tail, head, process } = input;
  if (!process) return { tail, head };
  const historyIndex = indexActiveHistory({
    existing: [...tail, ...head],
    process,
    activeTurnId: input.activeTurnId,
  });
  const { messages, tools, replacements } = historyIndex;
  const insertions = new Map<StreamItem, StreamItem[]>();
  let anchor: StreamItem = process;
  for (const entry of activeDetailRows(
    process,
    input.details,
    input.activeTurnId ?? process.turnId,
  )) {
    const compaction = reconcileActiveCompaction(entry, historyIndex);
    if (compaction) {
      anchor = compaction;
      continue;
    }
    if (isAgentToolCallItem(entry)) {
      const current = tools.get(entry.payload.data.callId);
      if (current) {
        anchor = current;
        continue;
      }
    }
    const current =
      "messageId" in entry && entry.messageId ? messages.get(entry.messageId) : undefined;
    if (current && current.length > 0) {
      if (entry.kind === "assistant_message")
        reconcileActiveAssistant(entry, current, replacements);
      anchor = current[current.length - 1];
      continue;
    }
    const pending = insertions.get(anchor) ?? [];
    pending.push(entry);
    insertions.set(anchor, pending);
  }
  if (input.error)
    insertions.set(process, [
      ...(insertions.get(process) ?? []),
      {
        kind: "activity_log",
        id: `${process.id}:read-error`,
        activityType: "error",
        message: `读取当前轮的早期过程失败：${input.error}。重新打开会话可重试。`,
        timestamp: process.timestamp,
      },
    ]);
  const rewrite = (items: StreamItem[]) =>
    items.flatMap((entry) => {
      const replacement = replacements.get(entry);
      const shown = replacement === null || entry === process ? [] : [replacement ?? entry];
      return [...shown, ...(insertions.get(entry) ?? [])];
    });
  const nextTail = rewrite(tail);
  const previous = activeTailCache.get(tail);
  const unchanged =
    previous &&
    previous.length === nextTail.length &&
    previous.every((entry, index) => entry === nextTail[index]);
  if (!unchanged) activeTailCache.set(tail, nextTail);
  return { tail: unchanged ? previous : nextTail, head: rewrite(head) };
}

function reconcileActiveCompaction(
  entry: StreamItem,
  index: ReturnType<typeof indexActiveHistory>,
): CompactionItem | null {
  if (entry.kind !== "compaction" || !entry.compactionId) return null;
  const current = index.compactions.get(entry.compactionId);
  if (!current) return null;
  if (entry.status === "completed" && current.status === "loading")
    index.replacements.set(current, {
      ...current,
      status: "completed",
      trigger: entry.trigger ?? current.trigger,
      preTokens: entry.preTokens ?? current.preTokens,
    });
  return current;
}

function reconcileActiveAssistant(
  entry: Extract<StreamItem, { kind: "assistant_message" }>,
  current: StreamItem[],
  replacements: Map<StreamItem, StreamItem | null>,
): void {
  const live = current.filter((row) => row.kind === "assistant_message");
  const text = live.map((row) => row.text).join("\n\n");
  const incomingText = entry.text.replace(/\s/gu, "");
  const liveText = text.replace(/\s/gu, "");
  // 精确消息身份一致，快照补齐此前未投递的前缀；已有更长的实时正文不被旧快照截短。
  if (
    live.length === 0 ||
    incomingText.length <= liveText.length ||
    !incomingText.includes(liveText)
  )
    return;
  for (const row of live) replacements.set(row, null);
  const { blockGroupId: _group, blockIndex: _index, ...first } = live[0];
  replacements.set(live[0], { ...first, text: entry.text });
}

export function nativeHistoryInterruptedReply(
  item: NativeHistoryProcessItem,
  details: AgentTimelineItem[],
): StreamItem[] {
  if (item.status !== "interrupted" && item.status !== "failed") return [];
  const reply = details.findLast(
    (entry) => entry.type === "assistant_message" && entry.text.trim().length > 0,
  );
  if (
    !reply ||
    reply.type !== "assistant_message" ||
    (reply.messageId !== undefined && item.summaryMessageIds.includes(reply.messageId))
  )
    return [];
  return hydrateNativeHistoryDetails(item, [reply]);
}

export function hydrateNativeHistoryDetails(
  item: NativeHistoryProcessItem,
  details: AgentTimelineItem[],
): StreamItem[] {
  const rows = hydrateStreamState(
    details.map((entry) => ({
      event: { type: "timeline" as const, provider: "codex", item: entry, turnId: item.turnId },
      timestamp: item.timestamp,
    })),
    { source: "canonical" },
  );
  for (const row of rows) row.timestampUnknown = true; // 条目接口不提供每个操作的独立发生时间。
  return rows;
}
