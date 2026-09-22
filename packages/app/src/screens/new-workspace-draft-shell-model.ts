import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

export function createNewWorkspaceDraftTabDescriptor(draftId: string): WorkspaceTabDescriptor {
  const normalizedDraftId = draftId.trim();
  if (!normalizedDraftId) {
    throw new Error("新建会话草稿需要有效的草稿标识");
  }
  return {
    key: normalizedDraftId,
    tabId: normalizedDraftId,
    kind: "draft",
    target: { kind: "draft", draftId: normalizedDraftId },
  };
}
