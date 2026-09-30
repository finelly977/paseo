import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { Ellipsis, PanelRight, Settings } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { ExplorerSidebar } from "@/components/explorer-sidebar";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { SourceControlPanelIcon } from "@/components/icons/source-control-panel-icon";
import { RetainedPanel } from "@/components/retained-panel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FloatingPanelPortalHost,
  FloatingPanelPortalHostNameProvider,
} from "@/components/ui/floating-panel-portal";
import { getIsElectron } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { FilePane } from "@/file-pane/pane";
import { TerminalPane } from "@/components/terminal-pane";
import { BrowserPane } from "@/components/browser-pane";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useBrowserStore } from "@/stores/browser-store";
import { WorkspaceActions } from "@/git/workspace-actions";
import { PaneProvider, type PaneContextValue } from "@/panels/pane-context";
import { getPanelInstanceAttributes } from "@/panels/panel-instance-attributes";
import {
  WorkspaceDesktopTabsRow,
  type WorkspaceDesktopTabRowItem,
} from "@/screens/workspace/workspace-desktop-tabs-row";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { TerminalProfileInput } from "@/screens/workspace/terminals/use-workspace-terminals";
import { selectIsFileExplorerOpen, usePanelStore } from "@/stores/panel-store";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { WindowChromeRegion } from "@/utils/desktop-window";
import { buildOpenProjectRoute, buildProjectSettingsRoute } from "@/utils/host-routes";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import { WorkspaceOpenInEditorButton } from "@/workspace/open-in-editor/button";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  closeNewWorkspaceDraftShellTab,
  buildNewWorkspaceDraftWorkspaceId,
  closeNewWorkspaceDraftShellTabsAfter,
  closeNewWorkspaceDraftShellTabsBefore,
  closeNewWorkspaceDraftShellOtherTabs,
  focusNewWorkspaceDraftShellTab,
  listNewWorkspaceDraftShellFileTabIds,
  openNewWorkspaceDraftShellFile,
  reorderNewWorkspaceDraftShellTabs,
  type NewWorkspaceDraftShellState,
} from "./new-workspace-draft-shell-model";
import {
  getNewSessionDraftShellState,
  updateNewSessionDraftShell,
  useNewSessionDraftStore,
  useNewSessionDraftShellState,
} from "./new-workspace/draft-shell-store";

const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedPanelRight = withUnistyles(PanelRight);
const ThemedSettings = withUnistyles(Settings);
const ThemedSourceControlPanelIcon = withUnistyles(SourceControlPanelIcon);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const sourceControlStrokeWidth = { strokeWidth: 1.5 };
const emptyShortcutKeys: [] = [];
const settingsLeadingIcon = <ThemedSettings size={14} uniProps={mutedColorMapping} />;

function noop() {}

/** 附加资源留在草稿内，正式发送前不创建工作区。 */
export type NewWorkspaceDraftShellTarget =
  | { kind: "terminal"; profile?: TerminalProfileInput }
  | { kind: "browser" };

interface NewWorkspaceDraftShellProps {
  serverId: string;
  projectId: string | null;
  projectName: string;
  draftId: string;
  cwd: string;
  isGit: boolean;
  isPending: boolean;
  children: ReactNode;
  onOpenTarget: (target: NewWorkspaceDraftShellTarget) => void;
}

interface DraftShellActions {
  closingTabIds: readonly string[];
  focusTab: (tabId: string) => void;
  focusDraftTab: () => void;
  openFile: (location: WorkspaceFileLocation) => void;
  closeTab: (tabId: string) => Promise<void>;
  closeOtherTabs: (tabId: string) => Promise<void>;
  closeTabsBefore: (tabId: string) => Promise<void>;
  closeTabsAfter: (tabId: string) => Promise<void>;
  reorderTabs: (nextTabs: WorkspaceTabDescriptor[]) => void;
  copyFilePath: (path: string) => Promise<void>;
}

interface DraftHeaderMenuProps {
  serverId: string;
  projectId: string | null;
  cwd: string;
}

function DraftHeaderMenu({ serverId, projectId, cwd }: DraftHeaderMenuProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const copyWorkspacePath = useCallback(() => {
    void Clipboard.setStringAsync(cwd)
      .then(() => toast.copied(t("workspace.header.toasts.workspacePathCopiedLabel")))
      .catch((error: unknown) => {
        console.error("[new-workspace] failed to copy draft workspace path", error);
        toast.error(t("workspace.tabs.toasts.copyFailed"));
      });
  }, [cwd, t, toast]);
  const openProjectSettings = useCallback(() => {
    if (!projectId) {
      throw new Error("无法打开项目设置：项目标识不存在");
    }
    router.push(buildProjectSettingsRoute(serverId, projectId));
  }, [projectId, router, serverId]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        accessibilityLabel={t("workspace.header.actions.workspaceActions")}
        style={styles.headerMenuTrigger}
      >
        <ThemedEllipsis size={16} uniProps={mutedColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={230}>
        <DropdownMenuItem onSelect={copyWorkspacePath}>
          {t("workspace.header.actions.copyPath")}
        </DropdownMenuItem>
        {projectId ? (
          <DropdownMenuItem leading={settingsLeadingIcon} onSelect={openProjectSettings}>
            {t("sidebar.project.actions.openSettings")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface DraftHeaderActionsProps {
  serverId: string;
  cwd: string;
  isGit: boolean;
  isExplorerOpen: boolean;
  onToggleExplorer: () => void;
}

function DraftHeaderActions({
  serverId,
  cwd,
  isGit,
  isExplorerOpen,
  onToggleExplorer,
}: DraftHeaderActionsProps) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ expanded: isExplorerOpen }), [isExplorerOpen]);
  const renderExplorerIcon = useCallback(
    ({ hovered, pressed }: { hovered: boolean; pressed: boolean }) => {
      const colorMapping =
        hovered || pressed || isExplorerOpen ? foregroundColorMapping : mutedColorMapping;
      return isGit ? (
        <ThemedSourceControlPanelIcon
          size={16}
          uniProps={colorMapping}
          {...sourceControlStrokeWidth}
        />
      ) : (
        <ThemedPanelRight size={16} uniProps={colorMapping} />
      );
    },
    [isExplorerOpen, isGit],
  );

  return (
    <View style={styles.headerActions}>
      <WorkspaceOpenInEditorButton serverId={serverId} cwd={cwd} hideLabels />
      {isGit ? <WorkspaceActions serverId={serverId} cwd={cwd} hideLabels /> : null}
      <HeaderToggleButton
        testID="new-workspace-explorer-toggle"
        onPress={onToggleExplorer}
        tooltipLabel={t("workspace.tabs.explorer.toggle")}
        tooltipKeys={emptyShortcutKeys}
        tooltipSide="left"
        accessibilityRole="button"
        accessibilityLabel={t("workspace.tabs.explorer.toggle")}
        accessibilityState={accessibilityState}
      >
        {renderExplorerIcon}
      </HeaderToggleButton>
    </View>
  );
}

interface DraftHeaderProps extends DraftHeaderMenuProps, DraftHeaderActionsProps {
  projectName: string;
}

function DraftHeader({ projectName, ...props }: DraftHeaderProps) {
  const isCompact = useIsCompactFormFactor();
  const left = (
    <>
      <SidebarMenuToggle />
      {isCompact ? <ScreenTitle>{projectName}</ScreenTitle> : null}
      <DraftHeaderMenu serverId={props.serverId} projectId={props.projectId} cwd={props.cwd} />
    </>
  );
  // ScreenHeader 的左右插槽要求传入 React 节点；节点在这里集中构造，不使用匿名渲染函数。
  // oxlint-disable-next-line react-perf/jsx-no-jsx-as-prop
  const right = (
    <DraftHeaderActions
      serverId={props.serverId}
      cwd={props.cwd}
      isGit={props.isGit}
      isExplorerOpen={props.isExplorerOpen}
      onToggleExplorer={props.onToggleExplorer}
    />
  );

  // ScreenHeader 的左右插槽要求传入 React 节点。
  // oxlint-disable-next-line react-perf/jsx-no-jsx-as-prop
  return <ScreenHeader left={left} right={right} />;
}

interface DraftTabsProps {
  serverId: string;
  virtualWorkspaceId: string;
  shellState: NewWorkspaceDraftShellState;
  isPending: boolean;
  actions: DraftShellActions;
  onOpenTarget: (target: NewWorkspaceDraftShellTarget) => void;
}

function DraftTabs({
  serverId,
  virtualWorkspaceId,
  shellState,
  isPending,
  actions,
  onOpenTarget,
}: DraftTabsProps) {
  const [hoveredCloseTabKey, setHoveredCloseTabKey] = useState<string | null>(null);
  const tabs = useMemo<WorkspaceDesktopTabRowItem[]>(
    () =>
      shellState.tabs.map((tab) => ({
        tab,
        isActive: tab.tabId === shellState.activeTabId,
        isCloseHovered: hoveredCloseTabKey === tab.key,
        isClosingTab: actions.closingTabIds.includes(tab.tabId),
      })),
    [actions.closingTabIds, hoveredCloseTabKey, shellState.activeTabId, shellState.tabs],
  );
  const createTerminal = useCallback(
    (input: { profile?: TerminalProfileInput }) => {
      onOpenTarget({ kind: "terminal", ...(input.profile ? { profile: input.profile } : {}) });
    },
    [onOpenTarget],
  );
  const createBrowser = useCallback(() => onOpenTarget({ kind: "browser" }), [onOpenTarget]);

  return (
    <WorkspaceDesktopTabsRow
      isFocused
      tabs={tabs}
      normalizedServerId={serverId}
      normalizedWorkspaceId={virtualWorkspaceId}
      setHoveredCloseTabKey={setHoveredCloseTabKey}
      onNavigateTab={actions.focusTab}
      onCloseTab={actions.closeTab}
      onCopyResumeCommand={noop}
      onCopyAgentId={noop}
      onCopyFilePath={actions.copyFilePath}
      onReloadAgent={noop}
      onRenameTab={noop}
      onCloseTabsToLeft={actions.closeTabsBefore}
      onCloseTabsToRight={actions.closeTabsAfter}
      onCloseOtherTabs={actions.closeOtherTabs}
      onCreateDraftTab={actions.focusDraftTab}
      onCreateTerminalTab={createTerminal}
      onCreateBrowserTab={createBrowser}
      showCreateBrowserTab={getIsElectron()}
      disableCreateTerminal={isPending}
      isWaitingOnTerminalReadiness={isPending}
      onReorderTabs={actions.reorderTabs}
      onSplitRight={noop}
      onSplitDown={noop}
      showPaneSplitActions={false}
      focusModeEnabled={false}
      onExitFocusMode={noop}
    />
  );
}

interface DraftFileTabPaneProps {
  serverId: string;
  cwd: string;
  virtualWorkspaceId: string;
  tab: WorkspaceTabDescriptor;
  navigationRevision: number;
  actions: DraftShellActions;
}

function DraftFileTabPane({
  serverId,
  cwd,
  virtualWorkspaceId,
  tab,
  navigationRevision,
  actions,
}: DraftFileTabPaneProps) {
  const target = tab.target;
  invariant(target.kind === "file", "新建会话草稿外壳的文件面板需要文件标签");
  const paneContext = useMemo<PaneContextValue>(() => {
    const openShellTarget = (next: WorkspaceTabTarget) => {
      if (next.kind !== "file") {
        throw new Error("新建会话草稿外壳只能在客户端打开文件标签");
      }
      actions.openFile(next);
    };
    return {
      serverId,
      workspaceId: virtualWorkspaceId,
      tabId: tab.tabId,
      target,
      fileNavigationRevision: navigationRevision,
      openTab: openShellTarget,
      closeCurrentTab: () => void actions.closeTab(tab.tabId),
      retargetCurrentTab: openShellTarget,
      openFileInWorkspace: (request) => actions.openFile(request.location),
      openImportSheet: () => {
        throw new Error("新建会话草稿外壳不支持导入会话");
      },
    };
  }, [actions, navigationRevision, serverId, tab.tabId, target, virtualWorkspaceId]);

  return (
    <PaneProvider value={paneContext}>
      <FilePane
        serverId={serverId}
        workspaceRoot={cwd}
        location={target}
        navigationRevision={navigationRevision}
      />
    </PaneProvider>
  );
}

interface DraftContentProps {
  serverId: string;
  cwd: string;
  virtualWorkspaceId: string;
  shellState: NewWorkspaceDraftShellState;
  actions: DraftShellActions;
  children: ReactNode;
}

function DraftResourcePane({
  serverId,
  cwd,
  virtualWorkspaceId,
  shellState,
  actions,
  tab,
}: Omit<DraftContentProps, "children"> & { tab: WorkspaceTabDescriptor }) {
  const active = shellState.activeTabId === tab.tabId;
  const openFile = useCallback(
    (request: { location: WorkspaceFileLocation }) => actions.openFile(request.location),
    [actions],
  );
  const openExplorer = usePanelStore((state) => state.openFileExplorerForCheckout);
  const showExplorer = useCallback(
    () => openExplorer({ isCompact: false, checkout: { serverId, cwd, isGit: false } }),
    [cwd, openExplorer, serverId],
  );
  if (tab.target.kind === "file") {
    return (
      <DraftFileTabPane
        serverId={serverId}
        cwd={cwd}
        virtualWorkspaceId={virtualWorkspaceId}
        tab={tab}
        navigationRevision={shellState.fileNavigationRevisionByTabId[tab.tabId] ?? 0}
        actions={actions}
      />
    );
  }
  if (tab.target.kind === "terminal") {
    return (
      <TerminalPane
        serverId={serverId}
        cwd={cwd}
        terminalId={tab.target.terminalId}
        isWorkspaceFocused
        isPaneFocused={active}
        onOpenFileExplorer={showExplorer}
        onOpenWorkspaceFile={openFile}
      />
    );
  }
  invariant(tab.target.kind === "browser", "草稿附加标签需要文件、终端或浏览器目标");
  return (
    <BrowserPane
      serverId={serverId}
      workspaceId={virtualWorkspaceId}
      cwd={cwd}
      browserId={tab.target.browserId}
      isInteractive={active}
    />
  );
}

function DraftContent({
  serverId,
  cwd,
  virtualWorkspaceId,
  shellState,
  actions,
  children,
}: DraftContentProps) {
  // 草稿输入区和已打开文件都保持挂载，只切换可见性，避免切换标签时丢失输入状态或文件滚动位置。
  return (
    <View style={styles.content}>
      <RetainedPanel active={shellState.activeTabId === shellState.draftTabId}>
        {children}
      </RetainedPanel>
      {shellState.tabs.map((tab) =>
        tab.target.kind !== "draft" ? (
          <RetainedPanel key={tab.tabId} active={shellState.activeTabId === tab.tabId}>
            <DraftResourcePane
              serverId={serverId}
              cwd={cwd}
              virtualWorkspaceId={virtualWorkspaceId}
              tab={tab}
              shellState={shellState}
              actions={actions}
            />
          </RetainedPanel>
        ) : null,
      )}
    </View>
  );
}

interface DraftCenterColumnProps extends DraftHeaderProps, DraftTabsProps {
  portalHostName: string;
  cwd: string;
  children: ReactNode;
}

function DraftCenterColumn({ portalHostName, children, ...props }: DraftCenterColumnProps) {
  return (
    <FloatingPanelPortalHostNameProvider hostName={portalHostName}>
      <View style={styles.centerColumn}>
        <DraftHeader {...props} />
        <DraftTabs {...props} />
        <DraftContent {...props}>{children}</DraftContent>
      </View>
    </FloatingPanelPortalHostNameProvider>
  );
}

interface DraftExplorerProps {
  serverId: string;
  cwd: string;
  isGit: boolean;
  onOpenFile: (location: WorkspaceFileLocation) => void;
}

function DraftExplorer({ serverId, cwd, isGit, onOpenFile }: DraftExplorerProps) {
  const openFile = useCallback((path: string) => onOpenFile({ path }), [onOpenFile]);
  return (
    <ExplorerSidebar
      serverId={serverId}
      workspaceId={null}
      workspaceRoot={cwd}
      isGit={isGit}
      onOpenFile={openFile}
    />
  );
}

function useDraftShellActions(input: {
  serverId: string;
  draftId: string;
  virtualWorkspaceId: string;
  onLeave: () => void;
}): DraftShellActions {
  const { serverId, draftId, virtualWorkspaceId, onLeave } = input;
  const { t } = useTranslation();
  const toast = useToast();

  const client = useHostRuntimeClient(serverId);
  const [closingTabIds, setClosingTabIds] = useState<string[]>([]);
  const closing = useRef(false);

  const confirmDiscardModifiedTabs = useCallback(
    async (tabIds: readonly string[]): Promise<boolean> => {
      const modifiedAttributes = tabIds
        .map((tabId) =>
          getPanelInstanceAttributes({ serverId, workspaceId: virtualWorkspaceId, tabId }),
        )
        .filter((attributes) => attributes.modified);
      if (modifiedAttributes.length === 0) return true;
      const resumePendingSaves = modifiedAttributes.map((attributes) =>
        attributes.suspendPendingSave?.(),
      );
      const confirmed = await confirmDialog({
        title: t("workspace.tabs.confirmations.unsavedTitle"),
        message: t("workspace.tabs.confirmations.unsavedMessage"),
        confirmLabel: t("workspace.tabs.confirmations.closeWithoutSaving"),
        cancelLabel: t("workspace.tabs.confirmations.cancel"),
        destructive: true,
      });
      if (!confirmed) {
        for (const resume of resumePendingSaves) resume?.();
      }
      return confirmed;
    },
    [serverId, t, virtualWorkspaceId],
  );

  const closeResourceTabs = useCallback(
    async (reducer: (state: NewWorkspaceDraftShellState) => NewWorkspaceDraftShellState) => {
      if (closing.current) return;
      const current = getNewSessionDraftShellState(draftId);
      const remainingTabIds = new Set(reducer(current).tabs.map((tab) => tab.tabId));
      const resourceTabIds = current.tabs
        .filter((tab) => !remainingTabIds.has(tab.tabId))
        .map((tab) => tab.tabId);
      if (resourceTabIds.length === 0) return;
      closing.current = true;
      setClosingTabIds(resourceTabIds);
      try {
        if (!(await confirmDiscardModifiedTabs(resourceTabIds))) return;
        for (const tab of current.tabs) {
          if (!resourceTabIds.includes(tab.tabId)) continue;
          if (tab.target.kind === "terminal") {
            if (!client || !client.isConnected) throw new Error("主机未连接，无法关闭终端");
            const result = await client.killTerminal(tab.target.terminalId);
            if (!result.success) throw new Error("关闭终端失败，请重试");
          }
          if (tab.target.kind === "browser") {
            useBrowserStore.getState().removeBrowser(tab.target.browserId);
          }
        }
        updateNewSessionDraftShell(draftId, reducer);
      } catch (error) {
        console.error("关闭新会话草稿附加标签失败", error);
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        closing.current = false;
        setClosingTabIds([]);
      }
    },
    [client, confirmDiscardModifiedTabs, draftId, toast],
  );

  return useMemo<DraftShellActions>(
    () => ({
      closingTabIds,
      focusTab: (tabId) =>
        updateNewSessionDraftShell(draftId, (state) =>
          focusNewWorkspaceDraftShellTab(state, tabId),
        ),
      focusDraftTab: () =>
        updateNewSessionDraftShell(draftId, (state) =>
          focusNewWorkspaceDraftShellTab(state, state.draftTabId),
        ),
      openFile: (location) =>
        updateNewSessionDraftShell(draftId, (state) =>
          openNewWorkspaceDraftShellFile(state, location),
        ),
      closeTab: async (tabId) => {
        const current = getNewSessionDraftShellState(draftId);
        if (tabId !== current.draftTabId) {
          await closeResourceTabs((state) => closeNewWorkspaceDraftShellTab(state, tabId));
          return;
        }
        // 关闭草稿标签只离开新建页，草稿本身继续在后台保留；离开会卸载文件面板，需要先确认未保存的修改。
        if (!(await confirmDiscardModifiedTabs(listNewWorkspaceDraftShellFileTabIds(current)))) {
          return;
        }
        onLeave();
      },
      closeOtherTabs: (tabId) =>
        closeResourceTabs((state) => closeNewWorkspaceDraftShellOtherTabs(state, tabId)),
      closeTabsBefore: (tabId) =>
        closeResourceTabs((state) => closeNewWorkspaceDraftShellTabsBefore(state, tabId)),
      closeTabsAfter: (tabId) =>
        closeResourceTabs((state) => closeNewWorkspaceDraftShellTabsAfter(state, tabId)),
      reorderTabs: (nextTabs) =>
        updateNewSessionDraftShell(draftId, (state) =>
          reorderNewWorkspaceDraftShellTabs(state, nextTabs),
        ),
      copyFilePath: async (path) => {
        if (!path) return;
        try {
          await Clipboard.setStringAsync(path);
          toast.copied(t("workspace.tabs.toasts.filePathCopiedLabel"));
        } catch (error) {
          console.error("[new-workspace] failed to copy draft file path", error);
          toast.error(t("workspace.tabs.toasts.copyFailed"));
        }
      },
    }),
    [closeResourceTabs, closingTabIds, confirmDiscardModifiedTabs, draftId, onLeave, t, toast],
  );
}

export function NewWorkspaceDraftShell(props: NewWorkspaceDraftShellProps) {
  const router = useRouter();
  const isExplorerOpen = usePanelStore((state) =>
    selectIsFileExplorerOpen(state, { isCompact: false }),
  );
  const toggleFileExplorerForCheckout = usePanelStore(
    (state) => state.toggleFileExplorerForCheckout,
  );
  const shellState = useNewSessionDraftShellState(props.draftId);
  invariant(shellState, "新建会话草稿外壳需要有效的草稿状态");
  const virtualWorkspaceId = useMemo(
    () => buildNewWorkspaceDraftWorkspaceId(props.draftId),
    [props.draftId],
  );
  const portalHostName = useMemo(
    () => `new-workspace:${props.serverId}:${props.draftId}`,
    [props.draftId, props.serverId],
  );
  const leaveDraft = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(buildOpenProjectRoute());
  }, [router]);
  const actions = useDraftShellActions({
    serverId: props.serverId,
    draftId: props.draftId,
    virtualWorkspaceId,
    onLeave: leaveDraft,
  });
  const toggleExplorer = useCallback(() => {
    toggleFileExplorerForCheckout({
      isCompact: false,
      checkout: { serverId: props.serverId, cwd: props.cwd, isGit: props.isGit },
    });
  }, [props.cwd, props.isGit, props.serverId, toggleFileExplorerForCheckout]);

  // 草稿在后台保留时总是回到输入标签，重新进入新建页时先看到会话输入区而不是上次查看的文件。
  const { draftId } = props;
  useEffect(
    () => () => {
      // 正式发送已释放草稿时，不在卸载清理中重新创建孤立的空草稿。
      if (!useNewSessionDraftStore.getState().shellByDraftId[draftId]) return;
      updateNewSessionDraftShell(draftId, (state) =>
        focusNewWorkspaceDraftShellTab(state, state.draftTabId),
      );
    },
    [draftId],
  );

  const centerProps = {
    ...props,
    portalHostName,
    virtualWorkspaceId,
    shellState,
    actions,
    isExplorerOpen,
    onToggleExplorer: toggleExplorer,
  };

  return (
    <View style={styles.shell}>
      <View style={styles.chromeRow}>
        <WindowChromeRegion corners={isExplorerOpen ? "top-left" : "both"}>
          <DraftCenterColumn {...centerProps} />
        </WindowChromeRegion>
        <FloatingPanelPortalHost name={portalHostName} />
        {isExplorerOpen ? (
          <WindowChromeRegion corners="top-right">
            <DraftExplorer
              serverId={props.serverId}
              cwd={props.cwd}
              isGit={props.isGit}
              onOpenFile={actions.openFile}
            />
          </WindowChromeRegion>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  shell: {
    flex: 1,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  chromeRow: {
    flex: 1,
    minHeight: 0,
    flexDirection: "row",
    alignItems: "stretch",
  },
  centerColumn: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  headerMenuTrigger: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
}));
