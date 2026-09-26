import { generateMessageId } from "@/types/stream";

export const NEW_WORKSPACE_DRAFT_KEY = "new-workspace";
const NEW_WORKSPACE_FORK_DRAFT_PREFIX = `${NEW_WORKSPACE_DRAFT_KEY}:draft:`;
// 按项目常驻后台的新建会话草稿只在当前应用进程内保留，退出应用后不恢复，因此不进入持久化存储。
const NEW_SESSION_DRAFT_PREFIX = "new-session-draft:";

export function generateDraftId(): string {
  return `draft_${generateMessageId()}`;
}

export function buildNewWorkspaceDraftKey(draftId?: string): string {
  const explicitDraftId = draftId?.trim();
  if (explicitDraftId) {
    return `${NEW_WORKSPACE_FORK_DRAFT_PREFIX}${explicitDraftId}`;
  }
  return NEW_WORKSPACE_DRAFT_KEY;
}

export function buildNewSessionDraftKey(draftId: string): string {
  const normalizedDraftId = draftId.trim();
  if (!normalizedDraftId) {
    throw new Error("新建会话草稿需要有效的草稿标识");
  }
  return `${NEW_SESSION_DRAFT_PREFIX}${normalizedDraftId}`;
}

export function isEphemeralDraftKey(draftKey: string): boolean {
  return draftKey.startsWith(NEW_SESSION_DRAFT_PREFIX);
}

export function isLegacyNewWorkspaceDraftKey(draftKey: string): boolean {
  return (
    draftKey.startsWith(`${NEW_WORKSPACE_DRAFT_KEY}:`) &&
    !draftKey.startsWith(NEW_WORKSPACE_FORK_DRAFT_PREFIX)
  );
}

export function buildDraftStoreKey(input: {
  serverId: string;
  agentId: string;
  draftId?: string | null;
}): string {
  const serverId = input.serverId.trim();
  const explicitDraftId = input.draftId?.trim();
  if (explicitDraftId) {
    return `draft:${serverId}:${explicitDraftId}`;
  }
  return `agent:${serverId}:${input.agentId.trim()}`;
}
