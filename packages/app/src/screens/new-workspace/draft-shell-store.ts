import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { generateDraftId } from "@/stores/draft-keys";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import {
  createNewWorkspaceDraftShellState,
  type NewWorkspaceDraftShellState,
} from "../new-workspace-draft-shell-model";

/**
 * 尚未发送首条消息的新建会话按“主机 + 项目目录”在后台常驻：每个项目只有一个草稿，
 * 重新进入新建页时复用同一草稿标识、输入内容和已打开的文件标签。首条消息发送成功或
 * 显式创建空工作区后才释放，下次新建会得到新的草稿。
 *
 * 该状态只保存在内存中，不写入持久化存储，退出应用后不再恢复。
 */
export interface NewSessionDraftScope {
  serverId: string;
  sourceDirectory: string;
}

interface NewSessionDraftStoreState {
  draftIdByScope: Record<string, string>;
  releaseCountByScope: Record<string, number>;
  shellByDraftId: Record<string, NewWorkspaceDraftShellState>;
  retainDraft: (input: { scopeKey: string; draftId: string }) => void;
  releaseDraft: (draftId: string) => void;
  updateShell: (
    draftId: string,
    update: (state: NewWorkspaceDraftShellState) => NewWorkspaceDraftShellState,
  ) => void;
}

export function buildNewSessionDraftScopeKey(scope: NewSessionDraftScope): string {
  const serverId = scope.serverId.trim();
  const sourceDirectory = normalizeWorkspacePath(scope.sourceDirectory);
  if (!serverId || !sourceDirectory) {
    throw new Error("新建会话草稿需要有效的主机和项目目录");
  }
  return JSON.stringify([serverId, sourceDirectory]);
}

export const useNewSessionDraftStore = create<NewSessionDraftStoreState>()((set) => ({
  draftIdByScope: {},
  releaseCountByScope: {},
  shellByDraftId: {},

  retainDraft: ({ scopeKey, draftId }) => {
    set((state) => {
      if (state.draftIdByScope[scopeKey]) {
        return state;
      }
      return { draftIdByScope: { ...state.draftIdByScope, [scopeKey]: draftId } };
    });
  },

  releaseDraft: (draftId) => {
    set((state) => {
      const releasedScopeKeys = Object.entries(state.draftIdByScope)
        .filter(([, retainedDraftId]) => retainedDraftId === draftId)
        .map(([scopeKey]) => scopeKey);
      if (releasedScopeKeys.length === 0 && !state.shellByDraftId[draftId]) {
        return state;
      }
      const draftIdByScope = { ...state.draftIdByScope };
      const releaseCountByScope = { ...state.releaseCountByScope };
      for (const scopeKey of releasedScopeKeys) {
        delete draftIdByScope[scopeKey];
        releaseCountByScope[scopeKey] = (releaseCountByScope[scopeKey] ?? 0) + 1;
      }
      const shellByDraftId = { ...state.shellByDraftId };
      delete shellByDraftId[draftId];
      return { draftIdByScope, releaseCountByScope, shellByDraftId };
    });
  },

  updateShell: (draftId, update) => {
    set((state) => {
      const current = state.shellByDraftId[draftId] ?? createNewWorkspaceDraftShellState(draftId);
      const next = update(current);
      if (next === current) {
        return state;
      }
      return { shellByDraftId: { ...state.shellByDraftId, [draftId]: next } };
    });
  },
}));

/**
 * 返回项目在后台常驻的新建会话草稿标识。首次进入时生成候选标识并在提交阶段登记，
 * 草稿被释放后会生成新的候选标识，不会把已经发送的草稿重新登记回去。
 */
export function useRetainedNewSessionDraftId(scope: NewSessionDraftScope | null): string | null {
  const scopeKey = scope ? buildNewSessionDraftScopeKey(scope) : null;
  const retainedDraftId = useNewSessionDraftStore((state) =>
    scopeKey ? (state.draftIdByScope[scopeKey] ?? null) : null,
  );
  const releaseCount = useNewSessionDraftStore((state) =>
    scopeKey ? (state.releaseCountByScope[scopeKey] ?? 0) : 0,
  );
  const candidate = useMemo(
    () => (scopeKey ? { scopeKey, releaseCount, draftId: generateDraftId() } : null),
    [releaseCount, scopeKey],
  );

  useEffect(() => {
    if (!candidate || retainedDraftId) {
      return;
    }
    useNewSessionDraftStore
      .getState()
      .retainDraft({ scopeKey: candidate.scopeKey, draftId: candidate.draftId });
  }, [candidate, retainedDraftId]);

  return retainedDraftId ?? candidate?.draftId ?? null;
}

export function useNewSessionDraftShellState(
  draftId: string | null,
): NewWorkspaceDraftShellState | null {
  const stored = useNewSessionDraftStore((state) =>
    draftId ? (state.shellByDraftId[draftId] ?? null) : null,
  );
  return useMemo(
    () => stored ?? (draftId ? createNewWorkspaceDraftShellState(draftId) : null),
    [draftId, stored],
  );
}

export function getNewSessionDraftShellState(draftId: string): NewWorkspaceDraftShellState {
  return (
    useNewSessionDraftStore.getState().shellByDraftId[draftId] ??
    createNewWorkspaceDraftShellState(draftId)
  );
}

export function updateNewSessionDraftShell(
  draftId: string,
  update: (state: NewWorkspaceDraftShellState) => NewWorkspaceDraftShellState,
): void {
  useNewSessionDraftStore.getState().updateShell(draftId, update);
}

export function releaseNewSessionDraft(draftId: string): void {
  useNewSessionDraftStore.getState().releaseDraft(draftId);
}

/** 草稿正式创建为工作区后，把草稿外壳中打开的文件按原顺序在后台打开到新工作区。 */
export function openNewSessionDraftFilesInWorkspace(input: {
  draftId: string;
  serverId: string;
  workspaceId: string;
}): void {
  const shell = useNewSessionDraftStore.getState().shellByDraftId[input.draftId];
  const fileTargets = shell?.tabs.flatMap((tab) =>
    tab.target.kind === "file" ? [tab.target] : [],
  );
  if (!fileTargets?.length) {
    return;
  }
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    throw new Error("无法把草稿中打开的文件带入新工作区：工作区标识无效");
  }
  const { openTabInBackground } = useWorkspaceLayoutStore.getState();
  for (const target of fileTargets) {
    openTabInBackground(workspaceKey, target);
  }
}
