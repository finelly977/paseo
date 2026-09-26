import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import {
  createWorkspaceFileTabTarget,
  normalizeWorkspaceFileLocation,
  type WorkspaceFileLocation,
} from "@/workspace/file-open";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";

/**
 * 新建会话草稿外壳的标签状态只存在于客户端：草稿标签始终存在，右侧文件面板打开的文件
 * 作为附加标签留在外壳内，不创建服务端工作区。
 */
export interface NewWorkspaceDraftShellState {
  draftTabId: string;
  tabs: WorkspaceTabDescriptor[];
  activeTabId: string;
  fileNavigationRevisionByTabId: Record<string, number>;
}

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

export function createNewWorkspaceDraftShellState(draftId: string): NewWorkspaceDraftShellState {
  const draftTab = createNewWorkspaceDraftTabDescriptor(draftId);
  return {
    draftTabId: draftTab.tabId,
    tabs: [draftTab],
    activeTabId: draftTab.tabId,
    fileNavigationRevisionByTabId: {},
  };
}

function createFileTabDescriptor(location: WorkspaceFileLocation): WorkspaceTabDescriptor {
  const target = createWorkspaceFileTabTarget(location);
  const tabId = buildDeterministicWorkspaceTabId(target);
  return { key: tabId, tabId, kind: "file", target };
}

export function openNewWorkspaceDraftShellFile(
  state: NewWorkspaceDraftShellState,
  location: WorkspaceFileLocation,
): NewWorkspaceDraftShellState {
  const normalizedLocation = normalizeWorkspaceFileLocation(location);
  if (!normalizedLocation) {
    throw new Error("无法打开文件：文件路径为空");
  }
  const fileTab = createFileTabDescriptor(normalizedLocation);
  const existingIndex = state.tabs.findIndex((tab) => tab.tabId === fileTab.tabId);
  if (existingIndex === -1) {
    return {
      ...state,
      tabs: [...state.tabs, fileTab],
      activeTabId: fileTab.tabId,
    };
  }
  // 重复打开同一文件时复用原标签，只更新定位行并递增导航版本，让文件面板重新滚动到目标行。
  const tabs = [...state.tabs];
  tabs[existingIndex] = fileTab;
  return {
    ...state,
    tabs,
    activeTabId: fileTab.tabId,
    fileNavigationRevisionByTabId: {
      ...state.fileNavigationRevisionByTabId,
      [fileTab.tabId]: (state.fileNavigationRevisionByTabId[fileTab.tabId] ?? 0) + 1,
    },
  };
}

export function focusNewWorkspaceDraftShellTab(
  state: NewWorkspaceDraftShellState,
  tabId: string,
): NewWorkspaceDraftShellState {
  if (state.activeTabId === tabId || !state.tabs.some((tab) => tab.tabId === tabId)) {
    return state;
  }
  return { ...state, activeTabId: tabId };
}

function resolveActiveTabAfterClose(input: {
  state: NewWorkspaceDraftShellState;
  remainingTabs: WorkspaceTabDescriptor[];
  anchorTabId?: string;
}): string {
  const { state, remainingTabs, anchorTabId } = input;
  if (remainingTabs.some((tab) => tab.tabId === state.activeTabId)) {
    return state.activeTabId;
  }
  if (anchorTabId && remainingTabs.some((tab) => tab.tabId === anchorTabId)) {
    return anchorTabId;
  }
  const closedIndex = state.tabs.findIndex((tab) => tab.tabId === state.activeTabId);
  const successor = remainingTabs[Math.max(0, Math.min(closedIndex - 1, remainingTabs.length - 1))];
  return successor?.tabId ?? state.draftTabId;
}

function removeFileTabs(input: {
  state: NewWorkspaceDraftShellState;
  shouldRemove: (tab: WorkspaceTabDescriptor, index: number) => boolean;
  anchorTabId?: string;
}): NewWorkspaceDraftShellState {
  const { state, shouldRemove, anchorTabId } = input;
  // 草稿标签代表新建会话本身，批量关闭只作用于文件标签，关闭草稿标签由外壳单独处理。
  const remainingTabs = state.tabs.filter(
    (tab, index) => tab.tabId === state.draftTabId || !shouldRemove(tab, index),
  );
  if (remainingTabs.length === state.tabs.length) {
    return state;
  }
  const remainingTabIds = new Set(remainingTabs.map((tab) => tab.tabId));
  const fileNavigationRevisionByTabId = Object.fromEntries(
    Object.entries(state.fileNavigationRevisionByTabId).filter(([tabId]) =>
      remainingTabIds.has(tabId),
    ),
  );
  return {
    ...state,
    tabs: remainingTabs,
    activeTabId: resolveActiveTabAfterClose({ state, remainingTabs, anchorTabId }),
    fileNavigationRevisionByTabId,
  };
}

export function closeNewWorkspaceDraftShellFileTab(
  state: NewWorkspaceDraftShellState,
  tabId: string,
): NewWorkspaceDraftShellState {
  return removeFileTabs({ state, shouldRemove: (tab) => tab.tabId === tabId });
}

export function closeNewWorkspaceDraftShellOtherFileTabs(
  state: NewWorkspaceDraftShellState,
  tabId: string,
): NewWorkspaceDraftShellState {
  return removeFileTabs({
    state,
    shouldRemove: (tab) => tab.tabId !== tabId,
    anchorTabId: tabId,
  });
}

export function closeNewWorkspaceDraftShellFileTabsBefore(
  state: NewWorkspaceDraftShellState,
  tabId: string,
): NewWorkspaceDraftShellState {
  const anchorIndex = state.tabs.findIndex((tab) => tab.tabId === tabId);
  if (anchorIndex === -1) {
    return state;
  }
  return removeFileTabs({
    state,
    shouldRemove: (_tab, index) => index < anchorIndex,
    anchorTabId: tabId,
  });
}

export function closeNewWorkspaceDraftShellFileTabsAfter(
  state: NewWorkspaceDraftShellState,
  tabId: string,
): NewWorkspaceDraftShellState {
  const anchorIndex = state.tabs.findIndex((tab) => tab.tabId === tabId);
  if (anchorIndex === -1) {
    return state;
  }
  return removeFileTabs({
    state,
    shouldRemove: (_tab, index) => index > anchorIndex,
    anchorTabId: tabId,
  });
}

export function reorderNewWorkspaceDraftShellTabs(
  state: NewWorkspaceDraftShellState,
  nextTabs: readonly WorkspaceTabDescriptor[],
): NewWorkspaceDraftShellState {
  const tabById = new Map(state.tabs.map((tab) => [tab.tabId, tab]));
  const reordered: WorkspaceTabDescriptor[] = [];
  for (const tab of nextTabs) {
    const current = tabById.get(tab.tabId);
    if (!current) {
      throw new Error(`无法调整新建会话标签顺序：标签 ${tab.tabId} 不存在`);
    }
    reordered.push(current);
    tabById.delete(tab.tabId);
  }
  if (tabById.size > 0) {
    throw new Error("无法调整新建会话标签顺序：新顺序缺少已打开的标签");
  }
  return { ...state, tabs: reordered };
}

export function listNewWorkspaceDraftShellFileTabIds(state: NewWorkspaceDraftShellState): string[] {
  return state.tabs.filter((tab) => tab.target.kind === "file").map((tab) => tab.tabId);
}
