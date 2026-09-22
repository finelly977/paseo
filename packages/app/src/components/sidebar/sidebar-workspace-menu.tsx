import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type PressableStateCallbackType } from "react-native";
import * as Clipboard from "expo-clipboard";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getCodexProviderInjectionModels } from "@getpaseo/protocol/messages";
import {
  Archive,
  CircleCheck,
  Copy,
  EyeOff,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  RotateCw,
  ServerCog,
  Unplug,
} from "lucide-react-native";
import { isNative, isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import type { ShortcutKey } from "@/utils/format-shortcut";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { OpenInFileManagerMenuItem } from "@/workspace/open-in-file-manager/menu-item";
import { useToast } from "@/contexts/toast-context";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedCopy = withUnistyles(Copy);
const ThemedArchive = withUnistyles(Archive);
const ThemedPencil = withUnistyles(Pencil);
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedPin = withUnistyles(Pin);
const ThemedPinOff = withUnistyles(PinOff);
const ThemedEyeOff = withUnistyles(EyeOff);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedServerCog = withUnistyles(ServerCog);
const ThemedUnplug = withUnistyles(Unplug);

const copyLeadingIcon = <ThemedCopy size={14} uniProps={foregroundMutedColorMapping} />;
const renameLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const markAsReadLeadingIcon = (
  <ThemedCircleCheck size={14} uniProps={foregroundMutedColorMapping} />
);
const archiveLeadingIcon = <ThemedArchive size={14} uniProps={foregroundMutedColorMapping} />;
const pinLeadingIcon = <ThemedPin size={14} uniProps={foregroundMutedColorMapping} />;
const unpinLeadingIcon = <ThemedPinOff size={14} uniProps={foregroundMutedColorMapping} />;
const removeLeadingIcon = <ThemedEyeOff size={14} uniProps={foregroundMutedColorMapping} />;
const reloadLeadingIcon = <ThemedRotateCw size={14} uniProps={foregroundMutedColorMapping} />;
const releaseRuntimeLeadingIcon = <ThemedUnplug size={14} uniProps={foregroundMutedColorMapping} />;
const providerInjectionLeadingIcon = (
  <ThemedServerCog size={14} uniProps={foregroundMutedColorMapping} />
);

function WorkspacePinSubmenu({
  workspaceKey,
  isPinned,
  onTogglePin,
  isProjectPinned,
  onToggleProjectPin,
}: Pick<
  SidebarWorkspaceMenuProps,
  "workspaceKey" | "isPinned" | "onTogglePin" | "isProjectPinned" | "onToggleProjectPin"
>) {
  const { t } = useTranslation();
  if (!onTogglePin && !onToggleProjectPin) {
    return null;
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger leading={pinLeadingIcon}>
        {t("sidebar.workspace.actions.pin")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent testID={`sidebar-workspace-menu-pin-${workspaceKey}`}>
        {onTogglePin ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-pin-global-${workspaceKey}`}
            leading={isPinned ? unpinLeadingIcon : pinLeadingIcon}
            onSelect={onTogglePin}
          >
            {isPinned
              ? t("sidebar.workspace.actions.unpinGlobal")
              : t("sidebar.workspace.actions.pinGlobal")}
          </DropdownMenuItem>
        ) : null}
        {onToggleProjectPin ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-pin-project-${workspaceKey}`}
            leading={isProjectPinned ? unpinLeadingIcon : pinLeadingIcon}
            onSelect={onToggleProjectPin}
          >
            {isProjectPinned
              ? t("sidebar.workspace.actions.unpinProject")
              : t("sidebar.workspace.actions.pinProject")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export interface CodexProviderInjectionMenuItem {
  id: string;
  name: string;
  models?: readonly string[];
  model?: string;
}

function CodexProviderInjectionSubmenu({
  injection,
  applying,
  onApply,
}: {
  injection: CodexProviderInjectionMenuItem;
  applying: boolean;
  onApply: (injectionId: string, model?: string) => void;
}) {
  const { t } = useTranslation();
  const models = getCodexProviderInjectionModels(injection);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        testID={`codex-provider-injection-provider-${injection.id}`}
        disabled={applying}
      >
        {injection.name}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent testID={`codex-provider-injection-models-${injection.id}`}>
        {models.length ? (
          models.map((model) => (
            <CodexProviderModelItem
              key={model}
              injection={injection}
              model={model}
              applying={applying}
              onApply={onApply}
            />
          ))
        ) : (
          <CodexProviderModelItem injection={injection} applying={applying} onApply={onApply}>
            {t("sidebar.workspace.codexProviderInjections.keepCurrentModel")}
          </CodexProviderModelItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function CodexProviderModelItem({
  injection,
  model,
  applying,
  onApply,
  children,
}: {
  injection: CodexProviderInjectionMenuItem;
  model?: string;
  applying: boolean;
  onApply: (injectionId: string, model?: string) => void;
  children?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const handleSelect = useCallback(
    () => onApply(injection.id, model),
    [injection.id, model, onApply],
  );
  return (
    <DropdownMenuItem
      testID={`codex-provider-injection-model-${injection.id}-${model ?? "current"}`}
      onSelect={handleSelect}
      status={applying ? "pending" : "idle"}
      pendingLabel={t("sidebar.workspace.codexProviderInjections.applying", {
        name: injection.name,
      })}
    >
      {children ?? model}
    </DropdownMenuItem>
  );
}

function renderTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

interface SidebarWorkspaceMenuProps {
  workspaceKey: string;
  sessionId?: string | null;
  onOpenChange?: (open: boolean) => void;
  onCopyPath?: () => void;
  onCopyBranchName?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onArchive: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  isPinned?: boolean;
  onTogglePin?: () => void;
  isProjectPinned?: boolean;
  onToggleProjectPin?: () => void;
  onReloadAgent?: () => void;
  onReleaseAgentRuntime?: () => void;
  isReleasingAgentRuntime?: boolean;
  onRemoveAgent?: () => void;
  isRemovingAgent?: boolean;
  openInFileManagerPath?: string | null;
  codexProviderInjections?: readonly CodexProviderInjectionMenuItem[];
  applyingCodexProviderInjectionId?: string | null;
  onApplyCodexProviderInjection?: (injectionId: string, model?: string) => void;
}

export function SidebarWorkspaceMenu({
  workspaceKey,
  sessionId,
  onOpenChange,
  onCopyPath,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  isPinned,
  onTogglePin,
  isProjectPinned,
  onToggleProjectPin,
  onReloadAgent,
  onReleaseAgentRuntime,
  isReleasingAgentRuntime,
  onRemoveAgent,
  isRemovingAgent,
  openInFileManagerPath,
  codexProviderInjections,
  applyingCodexProviderInjectionId,
  onApplyCodexProviderInjection,
}: SidebarWorkspaceMenuProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const archiveTrailing = useMemo(
    () => (archiveShortcutKeys && !isNative ? <Shortcut chord={archiveShortcutKeys} /> : null),
    [archiveShortcutKeys],
  );
  const handleCopySessionId = useCallback(async () => {
    if (!sessionId) {
      throw new Error("无法复制会话 ID：会话标识不存在");
    }
    try {
      await Clipboard.setStringAsync(sessionId);
      toast.copied(t("sidebar.workspace.toasts.sessionIdCopied"));
    } catch (error) {
      console.error("[sidebar] failed to copy session ID", error);
      toast.error(t("sidebar.workspace.toasts.copySessionIdFailed"));
    }
  }, [sessionId, t, toast]);

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={8}
        style={triggerStyle}
        accessibilityRole={isWeb ? undefined : "button"}
        accessibilityLabel={t("sidebar.workspace.actions.menu")}
        testID={`sidebar-workspace-kebab-${workspaceKey}`}
      >
        {renderTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={260}>
        {sessionId ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-copy-session-id-${workspaceKey}`}
            leading={copyLeadingIcon}
            onSelect={handleCopySessionId}
          >
            {t("sidebar.workspace.actions.copySessionId")}
          </DropdownMenuItem>
        ) : null}
        {onCopyPath ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-copy-path-${workspaceKey}`}
            leading={copyLeadingIcon}
            onSelect={onCopyPath}
          >
            {t("sidebar.workspace.actions.copyPath")}
          </DropdownMenuItem>
        ) : null}
        {onCopyBranchName ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-copy-branch-name-${workspaceKey}`}
            leading={copyLeadingIcon}
            onSelect={onCopyBranchName}
          >
            {t("sidebar.workspace.actions.copyBranchName")}
          </DropdownMenuItem>
        ) : null}
        {onRename ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-rename-${workspaceKey}`}
            leading={renameLeadingIcon}
            onSelect={onRename}
          >
            {t("sidebar.workspace.actions.rename")}
          </DropdownMenuItem>
        ) : null}
        {onMarkAsRead ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-mark-as-read-${workspaceKey}`}
            leading={markAsReadLeadingIcon}
            onSelect={onMarkAsRead}
          >
            Mark as read
          </DropdownMenuItem>
        ) : null}
        <WorkspacePinSubmenu
          workspaceKey={workspaceKey}
          isPinned={isPinned}
          onTogglePin={onTogglePin}
          isProjectPinned={isProjectPinned}
          onToggleProjectPin={onToggleProjectPin}
        />
        {onReloadAgent ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-reload-agent-${workspaceKey}`}
            leading={reloadLeadingIcon}
            onSelect={onReloadAgent}
          >
            {t("workspace.tabs.menu.reloadAgent")}
          </DropdownMenuItem>
        ) : null}
        {codexProviderInjections?.length && onApplyCodexProviderInjection ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                leading={providerInjectionLeadingIcon}
                testID={`sidebar-workspace-menu-codex-provider-injections-${workspaceKey}`}
              >
                {t("sidebar.workspace.codexProviderInjections.label")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent testID="codex-provider-injection-providers">
                {codexProviderInjections.map((injection) => (
                  <CodexProviderInjectionSubmenu
                    key={injection.id}
                    injection={injection}
                    applying={applyingCodexProviderInjectionId === injection.id}
                    onApply={onApplyCodexProviderInjection}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {onReleaseAgentRuntime ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-release-runtime-${workspaceKey}`}
            leading={releaseRuntimeLeadingIcon}
            onSelect={onReleaseAgentRuntime}
            status={isReleasingAgentRuntime ? "pending" : "idle"}
            pendingLabel={t("sidebar.workspace.actions.releasingAgentRuntime")}
          >
            {t("sidebar.workspace.actions.releaseAgentRuntime")}
          </DropdownMenuItem>
        ) : null}
        {onRemoveAgent ? (
          <DropdownMenuItem
            testID={`sidebar-workspace-menu-remove-agent-${workspaceKey}`}
            leading={removeLeadingIcon}
            onSelect={onRemoveAgent}
            destructive
            status={isRemovingAgent ? "pending" : "idle"}
            pendingLabel={t("sidebar.workspace.actions.removingAgent")}
          >
            {t("sidebar.workspace.actions.removeAgent")}
          </DropdownMenuItem>
        ) : null}
        <OpenInFileManagerMenuItem
          path={openInFileManagerPath}
          testID={`sidebar-workspace-menu-open-folder-${workspaceKey}`}
        />
        <DropdownMenuItem
          testID={`sidebar-workspace-menu-archive-${workspaceKey}`}
          leading={archiveLeadingIcon}
          trailing={archiveTrailing}
          status={archiveStatus}
          pendingLabel={archivePendingLabel}
          onSelect={onArchive}
        >
          {archiveLabel ?? t("sidebar.workspace.actions.archive")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function triggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.trigger, hovered && styles.triggerHovered];
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: 2,
    borderRadius: 4,
    marginLeft: 2,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
