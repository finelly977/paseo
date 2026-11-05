import type { NativeHistoryPage } from "@getpaseo/protocol/messages";
import type { StreamItem, UserMessageItem } from "@/types/stream";
import { hydrateStreamState, isUnreconciledLocalUserMessage } from "@/types/stream";
import type { TimelineReadCursor } from "./fetch-agent-timeline-once";

export function nativeHistoryItems(page: NativeHistoryPage, cursor: string | null): StreamItem[] {
  return page.turns.flatMap((turn) => {
    // Date 是现有水合模型的内部要求；原生缺失的时间必须显式标记，不能展示为 1970 年。
    const started = (turn.startedAt ?? 0) * 1000;
    const events = turn.items.map((item) => ({
      event: { type: "timeline" as const, provider: "codex", turnId: turn.id, item },
      timestamp: new Date(
        item.type === "user_message" ? started : started + (turn.durationMs ?? 0),
      ),
    }));
    const hydrated = hydrateStreamState(events, { source: "canonical" });
    for (const item of hydrated) {
      item.timestampUnknown =
        turn.startedAt === null || (item.kind !== "user_message" && turn.durationMs === null);
    }
    const users = hydrated.filter((item) => item.kind === "user_message");
    const rest = hydrated.filter((item) => item.kind !== "user_message");
    return [
      ...users,
      {
        kind: "native_history_process" as const,
        id: `native-process:${turn.id}`,
        turnId: turn.id,
        status: turn.status,
        durationMs: turn.durationMs,
        error: turn.error,
        timestamp: new Date(started),
        timestampUnknown: turn.startedAt === null,
        summaryMessageIds: turn.items.flatMap((item) =>
          "messageId" in item && typeof item.messageId === "string" ? [item.messageId] : [],
        ),
        summaryRevision: JSON.stringify(turn.items),
      },
      ...rest,
    ].map((item) => Object.assign(item, { nativeTurnId: turn.id, nativePageCursor: cursor }));
  });
}

/** 以原生身份更新局部页；不伪造规范序号，不重建未变化的消息对象。 */
export function mergeNativeHistoryPage(
  current: StreamItem[],
  page: NativeHistoryPage,
  older: boolean,
  cursor: string | null,
  localPresentation: readonly StreamItem[] = current,
): StreamItem[] {
  const incoming = nativeHistoryItems(page, cursor);
  const byClient = new Map<string, UserMessageItem>();
  const byMessage = new Map<string, UserMessageItem>();
  for (const item of localPresentation) {
    if (item.kind !== "user_message") continue;
    if (item.clientMessageId) byClient.set(item.clientMessageId, item);
    if (item.messageId) byMessage.set(item.messageId, item);
  }
  const byId = new Map(current.map((item) => [item.id, item]));
  const stable = incoming.map((item) => {
    if (item.kind === "user_message") {
      const local =
        (item.clientMessageId ? byClient.get(item.clientMessageId) : undefined) ??
        (item.messageId ? byMessage.get(item.messageId) : undefined);
      // 本地图片是展示副本；另一客户端改写正文后，不以旧输入覆盖权威正文或附加内容。
      if (local && local.text === item.text) {
        const paths = item.providerImages?.map((image) => image.path);
        const previousPaths = local.providerImagePaths;
        const sameSource =
          previousPaths === undefined ||
          (paths !== undefined &&
            previousPaths.length === paths.length &&
            previousPaths.every((path, index) => path === paths[index]));
        const keepPreview =
          sameSource &&
          local.images &&
          local.images.length > 0 &&
          (paths === undefined || paths.length === local.images.length);
        item = {
          ...item,
          images: keepPreview ? local.images : undefined,
          providerImagePaths: paths,
          attachments: local.attachments,
          // 同一原生消息已有本地预览时，不能再把提供方图片恢复成另一份缩略图。
          providerImages: keepPreview ? undefined : item.providerImages,
        };
      }
    }
    const previous = byId.get(item.id);
    return previous && JSON.stringify(previous) === JSON.stringify(item) ? previous : item;
  });
  const incomingTurns = new Set(page.turns.map((turn) => turn.id));
  const kept = current.filter(
    (item) => item.nativeTurnId !== undefined && !incomingTurns.has(item.nativeTurnId),
  );
  const live = retainNativeHistoryLiveItems(current, page);
  if (older) return [...stable, ...kept, ...live];
  const overlap = current.findIndex(
    (item) => item.nativeTurnId !== undefined && incomingTurns.has(item.nativeTurnId),
  );
  const prefix =
    overlap < 0 ? [] : current.slice(0, overlap).filter((item) => item.nativeTurnId !== undefined);
  // 原生回退后移除旧尾部；没有重叠意味着存在未读取的缺口，重新从原生尾页连续补齐。
  return [...prefix, ...stable, ...live];
}

interface NativeReadBoundary {
  readCursor: TimelineReadCursor | undefined;
  activeTurnId: string | null | undefined;
  coveredStart: number | null;
  emptyThread: boolean;
}

function wasRemovedBeforeNativeRead(item: UserMessageItem, boundary: NativeReadBoundary): boolean {
  const { readCursor, activeTurnId, coveredStart, emptyThread } = boundary;
  if (!item.timelineCursor || !readCursor) return false;
  if (item.timelineCursor.epoch !== readCursor.epoch) return false;
  if (item.timelineCursor.seq > readCursor.endSeq) return false;
  if (activeTurnId != null && item.turnId === activeTurnId) return false;
  return emptyThread || (coveredStart !== null && item.timestamp.getTime() >= coveredStart);
}

export function retainNativeHistoryLiveItems(
  items: readonly StreamItem[],
  page: NativeHistoryPage,
  readCursor?: TimelineReadCursor,
  activeTurnId?: string | null,
): StreamItem[] {
  const clientIds = new Set(
    page.turns.flatMap((turn) =>
      turn.items.flatMap((item) =>
        item.type === "user_message" && item.clientMessageId ? [item.clientMessageId] : [],
      ),
    ),
  );
  const completedClientIds = new Set(
    page.turns
      .filter((turn) => turn.status !== "inProgress")
      .flatMap((turn) =>
        turn.items.flatMap((item) =>
          item.type === "user_message" && item.clientMessageId ? [item.clientMessageId] : [],
        ),
      ),
  );
  const covered = new Set(
    page.turns
      .filter((turn) => turn.status !== "inProgress")
      .flatMap((turn) =>
        turn.items.flatMap((item) =>
          item.type === "user_message" && typeof item.messageId === "string"
            ? [item.messageId]
            : [],
        ),
      ),
  );
  const summaryIds = new Set(
    page.turns.flatMap((turn) =>
      turn.items.flatMap((item) =>
        "messageId" in item && typeof item.messageId === "string" ? [item.messageId] : [],
      ),
    ),
  );
  const live: StreamItem[] = [];
  const starts = page.turns.flatMap((turn) =>
    turn.startedAt === null ? [] : [turn.startedAt * 1000],
  );
  const coveredStart = starts.length > 0 ? Math.min(...starts) : null;
  const emptyThread = page.turns.length === 0 && page.nextCursor === null;
  let coveredGroup = false;
  for (const item of items) {
    if (item.kind === "user_message") {
      const matchedClient = clientIds.has(item.clientMessageId ?? item.id);
      const matchedMessage = item.messageId !== undefined && summaryIds.has(item.messageId);
      const removedBeforeRead =
        !matchedClient &&
        !matchedMessage &&
        wasRemovedBeforeNativeRead(item, { readCursor, activeTurnId, coveredStart, emptyThread });
      coveredGroup =
        (item.messageId !== undefined && covered.has(item.messageId)) ||
        completedClientIds.has(item.clientMessageId ?? item.id) ||
        removedBeforeRead;
      if (matchedClient) continue;
    }
    if (item.nativeTurnId !== undefined) continue;
    if (coveredGroup) continue;
    if ("messageId" in item && typeof item.messageId === "string" && summaryIds.has(item.messageId))
      continue;
    live.push(item);
  }
  return live;
}

export function nativeBeforeCursor(
  items: readonly StreamItem[],
  state: { nextCursor: string | null; firstTurnId: string | null },
): string | null {
  // 内存预算可能裁掉半页。重新读该边界页可以恢复缺口，再按返回游标继续，不能跳过被裁的记录。
  const first = items.find((item) => item.nativeTurnId !== undefined);
  if (first && first.nativeTurnId !== state.firstTurnId) return first.nativePageCursor ?? null;
  return state.nextCursor;
}

export function planNativeHistoryPage(input: {
  items: StreamItem[];
  head?: StreamItem[];
  previous: { readId: string; nextCursor: string | null; firstTurnId: string | null } | undefined;
  page: NativeHistoryPage;
  older: boolean;
  readCursor?: TimelineReadCursor;
  activeTurnId?: string | null;
}): {
  sameRead: boolean;
  tail: StreamItem[];
  head: StreamItem[];
  acknowledgedClientMessageIds: string[];
  nativeState: { readId: string; nextCursor: string | null; firstTurnId: string | null };
} | null {
  const { items, previous, page, older } = input;
  const head = input.head ?? [];
  if (older) {
    if (!previous || previous.readId !== page.readId) return null;
    if (page.cursor !== nativeBeforeCursor(items, previous)) return null;
  }
  const incoming = new Set(page.turns.map((turn) => turn.id));
  const hasOverlap = items.some(
    (item) => item.nativeTurnId !== undefined && incoming.has(item.nativeTurnId),
  );
  const hasNativeItems = items.some((item) => item.nativeTurnId !== undefined);
  const sameRead = previous?.readId === page.readId && hasNativeItems && (older || hasOverlap);
  const keepAcrossReset = (item: StreamItem) =>
    (item.kind === "user_message" &&
      (item.optimistic === true || isUnreconciledLocalUserMessage(item))) ||
    (input.activeTurnId != null && item.turnId === input.activeTurnId) ||
    (input.readCursor !== undefined &&
      item.timelineCursor !== undefined &&
      item.timelineCursor.epoch === input.readCursor.epoch &&
      item.timelineCursor.seq > input.readCursor.endSeq);
  // 活动区可能只有回复、用户行已在尾部；先按完整顺序核对归属，避免两区分开判断留下孤立旧回复。
  const survivingLive = new Set(
    retainNativeHistoryLiveItems(
      [...items, ...head],
      page,
      older ? undefined : input.readCursor,
      input.activeTurnId,
    ),
  );
  const retained = items.filter((item) =>
    sameRead
      ? item.nativeTurnId !== undefined || survivingLive.has(item)
      : survivingLive.has(item) && keepAcrossReset(item),
  );
  const tail = mergeNativeHistoryPage(retained, page, older, page.cursor, [...items, ...head]);
  const nativeState =
    sameRead && previous && !older
      ? previous
      : {
          readId: page.readId,
          nextCursor: page.nextCursor,
          firstTurnId: tail[0]?.nativeTurnId ?? null,
        };
  return {
    sameRead,
    tail,
    head: head.filter((item) => survivingLive.has(item) && (sameRead || keepAcrossReset(item))),
    nativeState,
    acknowledgedClientMessageIds: page.turns.flatMap((turn) =>
      turn.items.flatMap((item) =>
        item.type === "user_message" && item.clientMessageId ? [item.clientMessageId] : [],
      ),
    ),
  };
}
