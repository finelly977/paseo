import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Columns2, Globe, Rows2, SquarePen, SquareTerminal } from "lucide-react-native";
import { getIsElectron } from "@/constants/platform";
import { supportsDesktopPaneSplits, useIsCompactFormFactor } from "@/constants/layout";
import { useKeyboardShortcutOverrides } from "@/hooks/use-keyboard-shortcut-overrides";
import { resolveShortcutKeysForAction } from "@/keyboard/keyboard-shortcuts";
import { keyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { clearCommandCenterFocusRestoreElement } from "@/utils/command-center-focus-restore";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { getCommandCenterIcon } from "./icon";
import { useCommandCenterActions } from "./provider";
import {
  buildWorkspaceCommandCenterContributions,
  type WorkspaceCommandCenterShortcuts,
} from "./workspace-contributions";

const WORKSPACE_COMMAND_CENTER_ICONS = {
  newAgent: getCommandCenterIcon(SquarePen),
  newTerminal: getCommandCenterIcon(SquareTerminal),
  newBrowser: getCommandCenterIcon(Globe),
  splitRight: getCommandCenterIcon(Columns2),
  splitDown: getCommandCenterIcon(Rows2),
};

function resolveWorkspaceShortcuts(
  overrides: Readonly<Record<string, string>>,
): WorkspaceCommandCenterShortcuts {
  const platform = { isMac: getShortcutOs() === "mac", isDesktop: getIsElectron() };
  return {
    newAgent: resolveShortcutKeysForAction("workspace-tab-new", overrides, platform) ?? undefined,
    newTerminal:
      resolveShortcutKeysForAction("workspace-terminal-new", overrides, platform) ?? undefined,
    splitRight:
      resolveShortcutKeysForAction("workspace-pane-split-right", overrides, platform) ?? undefined,
    splitDown:
      resolveShortcutKeysForAction("workspace-pane-split-down", overrides, platform) ?? undefined,
  };
}

export function useWorkspaceCommandCenterActions(): void {
  const { t } = useTranslation();
  const selection = useActiveWorkspaceSelection();
  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;
  const isCompact = useIsCompactFormFactor();
  const { overrides } = useKeyboardShortcutOverrides();

  const actions = useMemo(
    () =>
      buildWorkspaceCommandCenterContributions({
        labels: {
          section: t("workspace.header.actions.workspaceActions"),
          newAgent: t("workspace.tabs.actions.newAgent"),
          newTerminal: t("workspace.tabs.actions.newTerminal"),
          newBrowser: t("workspace.tabs.actions.newBrowser"),
          splitRight: t("workspace.tabs.actions.splitRight"),
          splitDown: t("workspace.tabs.actions.splitDown"),
        },
        icons: {
          ...WORKSPACE_COMMAND_CENTER_ICONS,
        },
        shortcuts: resolveWorkspaceShortcuts(overrides),
        capabilities: {
          canSplitPanes: supportsDesktopPaneSplits() && !isCompact,
          canOpenBrowserTabs: getIsElectron(),
        },
        dispatch: (action) => {
          clearCommandCenterFocusRestoreElement();
          keyboardActionDispatcher.dispatch(action);
        },
      }),
    [isCompact, overrides, t],
  );

  useCommandCenterActions({
    sourceId: "workspace",
    enabled: Boolean(serverId && workspaceId),
    actions,
  });
}

export function CommandCenterWorkspaceActions() {
  useWorkspaceCommandCenterActions();
  return null;
}
