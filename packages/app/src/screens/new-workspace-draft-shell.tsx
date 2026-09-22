import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { Ellipsis, PanelRight, Settings } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ExplorerSidebar } from "@/components/explorer-sidebar";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ScreenTitle } from "@/components/headers/screen-title";
import { SourceControlPanelIcon } from "@/components/icons/source-control-panel-icon";
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
import { useToast } from "@/contexts/toast-context";
import { WorkspaceActions } from "@/git/workspace-actions";
import {
  WorkspaceDesktopTabsRow,
  type WorkspaceDesktopTabRowItem,
} from "@/screens/workspace/workspace-desktop-tabs-row";
import type { TerminalProfileInput } from "@/screens/workspace/terminals/use-workspace-terminals";
import { selectIsFileExplorerOpen, usePanelStore } from "@/stores/panel-store";
import type { Theme } from "@/styles/theme";
import { WindowChromeRegion } from "@/utils/desktop-window";
import { buildOpenProjectRoute, buildProjectSettingsRoute } from "@/utils/host-routes";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import { WorkspaceOpenInEditorButton } from "@/workspace/open-in-editor/button";
import { createNewWorkspaceDraftTabDescriptor } from "./new-workspace-draft-shell-model";

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

export type NewWorkspaceDraftShellTarget =
  | { kind: "terminal"; profile?: TerminalProfileInput }
  | { kind: "browser" }
  | { kind: "file"; location: WorkspaceFileLocation };

interface NewWorkspaceDraftShellProps {
  serverId: string;
  projectId: string | null;
  projectName: string;
  draftId: string;
  cwd: string;
  isGit: boolean;
  isPending: boolean;
  children: ReactNode;
  onCreateDraft: () => void;
  onOpenTarget: (target: NewWorkspaceDraftShellTarget) => void;
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
  const left = (
    <>
      <SidebarMenuToggle />
      <ScreenTitle>{projectName}</ScreenTitle>
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
  draftId: string;
  isPending: boolean;
  onClose: () => void;
  onCreateDraft: () => void;
  onOpenTarget: (target: NewWorkspaceDraftShellTarget) => void;
}

function DraftTabs({
  serverId,
  draftId,
  isPending,
  onClose,
  onCreateDraft,
  onOpenTarget,
}: DraftTabsProps) {
  const [hoveredCloseTabKey, setHoveredCloseTabKey] = useState<string | null>(null);
  const tab = useMemo(() => createNewWorkspaceDraftTabDescriptor(draftId), [draftId]);
  const tabs = useMemo<WorkspaceDesktopTabRowItem[]>(
    () => [
      {
        tab,
        isActive: true,
        isCloseHovered: hoveredCloseTabKey === tab.key,
        isClosingTab: false,
      },
    ],
    [hoveredCloseTabKey, tab],
  );
  const virtualWorkspaceId = useMemo(() => `draft-${draftId}`, [draftId]);
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
      onNavigateTab={noop}
      onCloseTab={onClose}
      onCopyResumeCommand={noop}
      onCopyAgentId={noop}
      onCopyFilePath={noop}
      onReloadAgent={noop}
      onRenameTab={noop}
      onCloseTabsToLeft={noop}
      onCloseTabsToRight={noop}
      onCloseOtherTabs={noop}
      onCreateDraftTab={onCreateDraft}
      onCreateTerminalTab={createTerminal}
      onCreateBrowserTab={createBrowser}
      showCreateBrowserTab={getIsElectron()}
      disableCreateTerminal={isPending}
      isWaitingOnTerminalReadiness={isPending}
      onReorderTabs={noop}
      onSplitRight={noop}
      onSplitDown={noop}
      showPaneSplitActions={false}
      focusModeEnabled={false}
      onExitFocusMode={noop}
    />
  );
}

interface DraftCenterColumnProps extends DraftHeaderProps, DraftTabsProps {
  portalHostName: string;
  children: ReactNode;
}

function DraftCenterColumn({ portalHostName, children, ...props }: DraftCenterColumnProps) {
  return (
    <FloatingPanelPortalHostNameProvider hostName={portalHostName}>
      <View style={styles.centerColumn}>
        <DraftHeader {...props} />
        <DraftTabs {...props} />
        <View style={styles.content}>{children}</View>
      </View>
    </FloatingPanelPortalHostNameProvider>
  );
}

interface DraftExplorerProps {
  serverId: string;
  cwd: string;
  isGit: boolean;
  onOpenTarget: (target: NewWorkspaceDraftShellTarget) => void;
}

function DraftExplorer({ serverId, cwd, isGit, onOpenTarget }: DraftExplorerProps) {
  const openFile = useCallback(
    (path: string) => onOpenTarget({ kind: "file", location: { path } }),
    [onOpenTarget],
  );
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

export function NewWorkspaceDraftShell(props: NewWorkspaceDraftShellProps) {
  const router = useRouter();
  const isExplorerOpen = usePanelStore((state) =>
    selectIsFileExplorerOpen(state, { isCompact: false }),
  );
  const toggleFileExplorerForCheckout = usePanelStore(
    (state) => state.toggleFileExplorerForCheckout,
  );
  const portalHostName = useMemo(
    () => `new-workspace:${props.serverId}:${props.draftId}`,
    [props.draftId, props.serverId],
  );
  const closeDraft = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(buildOpenProjectRoute());
  }, [router]);
  const toggleExplorer = useCallback(() => {
    toggleFileExplorerForCheckout({
      isCompact: false,
      checkout: { serverId: props.serverId, cwd: props.cwd, isGit: props.isGit },
    });
  }, [props.cwd, props.isGit, props.serverId, toggleFileExplorerForCheckout]);
  const centerProps = {
    ...props,
    portalHostName,
    isExplorerOpen,
    onClose: closeDraft,
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
            <DraftExplorer {...props} />
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
