interface ConversationRewindOperation {
  rewind(): Promise<unknown>;
  apply(): void;
  refreshTimeline(): Promise<unknown>;
  onRefreshError(error: unknown): void;
}

async function refreshRewoundTimeline(operation: ConversationRewindOperation): Promise<void> {
  try {
    await operation.refreshTimeline();
  } catch (error) {
    operation.onRefreshError(error);
  }
}

/** 原生撤回确认后即可恢复草稿，权威历史刷新不阻塞消息操作菜单和输入框。 */
export async function runConversationRewind(operation: ConversationRewindOperation): Promise<void> {
  await operation.rewind();
  operation.apply();
  void refreshRewoundTimeline(operation);
}
