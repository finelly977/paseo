import type { NativeHistoryPage } from "@getpaseo/protocol/messages";
import type { StreamItem } from "@/types/stream";
import { hydrateStreamState } from "@/types/stream";

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
): StreamItem[] {
  const incoming = nativeHistoryItems(page, cursor);
  const byId = new Map(current.map((item) => [item.id, item]));
  const stable = incoming.map((item) => {
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

export function retainNativeHistoryLiveItems(
  items: readonly StreamItem[],
  page: NativeHistoryPage,
): StreamItem[] {
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
  let coveredGroup = false;
  for (const item of items) {
    if (item.nativeTurnId !== undefined) continue;
    if (item.kind === "user_message")
      coveredGroup = item.messageId !== undefined && covered.has(item.messageId);
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
  previous: { readId: string; nextCursor: string | null; firstTurnId: string | null } | undefined;
  page: NativeHistoryPage;
  older: boolean;
}): {
  sameRead: boolean;
  tail: StreamItem[];
  nativeState: { readId: string; nextCursor: string | null; firstTurnId: string | null };
} | null {
  const { items, previous, page, older } = input;
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
  const tail = mergeNativeHistoryPage(sameRead ? items : [], page, older, page.cursor);
  const nativeState =
    sameRead && previous && !older
      ? previous
      : {
          readId: page.readId,
          nextCursor: page.nextCursor,
          firstTurnId: tail[0]?.nativeTurnId ?? null,
        };
  return { sameRead, tail, nativeState };
}
