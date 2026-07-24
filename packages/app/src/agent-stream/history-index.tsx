import type { RefObject } from "react";
import type { ConversationHistoryIndexEntry } from "./history-index-model";
import type { StreamViewportHandle } from "./strategy";

export interface ConversationHistoryIndexProps {
  entries: readonly ConversationHistoryIndexEntry[];
  viewportRef: RefObject<StreamViewportHandle | null>;
}

/** 原生端暂不显示桌面历史刻度，消息列表仍可正常滚动。 */
export function ConversationHistoryIndex(_props: ConversationHistoryIndexProps): null {
  return null;
}
