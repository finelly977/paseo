import type { SessionState } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";

/** 保留已显示行的身份与高度，只把原生尾页的位置校准到完整历史。 */
type HistoryPreviewState = Pick<
  SessionState,
  | "agentTimelineCursor"
  | "agentTimelineHasOlder"
  | "agentStreamTail"
  | "agentStreamHead"
  | "agentConversationIndex"
  | "agentConversationIndexVersion"
  | "releasedAgentIds"
>;

export function rebaseHistoryPreview<T extends HistoryPreviewState>(
  session: T,
  agentId: string,
  epoch: string,
  rebase: {
    previousEpoch: string;
    minSeq: number;
    positions: ReadonlyArray<{ previousSeq: number; seq: number }>;
  },
): T | null {
  const cursor = session.agentTimelineCursor.get(agentId);
  if (session.releasedAgentIds.has(agentId) || !cursor || cursor.epoch !== rebase.previousEpoch)
    return null;
  const positions = new Map(
    rebase.positions.map((position) => [position.previousSeq, position.seq]),
  );
  const retained = rebase.positions.filter(
    (position) => position.previousSeq >= cursor.startSeq && position.previousSeq <= cursor.endSeq,
  );
  if (retained.length === 0) return null;
  const update = (items: StreamItem[]): StreamItem[] =>
    items.flatMap((item) => {
      const position = item.timelineCursor;
      if (!position || position.epoch !== rebase.previousEpoch) return [item];
      const seq = positions.get(position.seq);
      return seq === undefined ? [] : [{ ...item, timelineCursor: { epoch, seq } }];
    });
  const cursors = new Map(session.agentTimelineCursor);
  cursors.set(agentId, {
    epoch,
    startSeq: Math.min(...retained.map((position) => position.seq)),
    endSeq: Math.max(...retained.map((position) => position.seq)),
  });
  const indexes = new Map(session.agentConversationIndex);
  const index = indexes.get(agentId);
  if (index)
    indexes.set(
      agentId,
      index.flatMap((entry) => {
        const seqStart = positions.get(entry.seqStart);
        return seqStart === undefined ? [] : [{ ...entry, seqStart }];
      }),
    );
  const versions = new Map(session.agentConversationIndexVersion);
  versions.delete(agentId);
  return {
    ...session,
    agentStreamTail: new Map(session.agentStreamTail).set(
      agentId,
      update(session.agentStreamTail.get(agentId) ?? []),
    ),
    agentStreamHead: new Map(session.agentStreamHead).set(
      agentId,
      update(session.agentStreamHead.get(agentId) ?? []),
    ),
    agentTimelineCursor: cursors,
    agentTimelineHasOlder: new Map(session.agentTimelineHasOlder).set(
      agentId,
      Math.min(...retained.map((position) => position.seq)) > rebase.minSeq,
    ),
    agentConversationIndex: indexes,
    agentConversationIndexVersion: versions,
  };
}
