import { useMemo, type ReactElement, type ReactNode } from "react";
import { Text, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  MessageSquarePlus,
  MoreVertical,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Globe,
  type LucideIcon,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, SPACING, type Theme } from "@/styles/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedMoreVertical = withUnistyles(MoreVertical);

/** Width occupied by a file action trigger, including its visual padding. */
export const FILE_ACTIONS_MENU_WIDTH = ICON_SIZE.sm + 2 * SPACING[1];

interface FileAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  testID?: string;
}

interface FileActionCandidate {
  key: string;
  label: string;
  icon: LucideIcon;
  callback: (() => void) | undefined;
}

interface FileActionsMenuProps {
  contextTarget?: ReactElement;
  fileKind: "file" | "directory";
  fileExists?: boolean;
  onOpenFile?: () => void;
  onOpenInFileManager?: () => void;
  onOpenInEditor?: () => void;
  editorTargetName?: string;
  onCopyPath?: () => void;
  onDownload?: () => void;
  onAddToChat?: () => void;
  onNewFile?: () => void;
  onNewDirectory?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onOpenInBrowser?: () => void;
  onOpenInExternalBrowser?: () => void;
  /** Optional metadata block rendered above the actions (e.g. size/modified). */
  header?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hitSlop?: number;
  accessibilityLabel: string;
  testIDPrefix?: string;
}

// The menu lives inside pressable rows (diff header, explorer entry); stop the
// press so opening it doesn't also trigger the row.
function stopTriggerPropagation(event: { stopPropagation?: () => void }) {
  event.stopPropagation?.();
}

function triggerStyle({
  hovered,
  pressed,
  open,
}: PressableStateCallbackType & { hovered?: boolean; open?: boolean }) {
  return [styles.trigger, (Boolean(hovered) || pressed || Boolean(open)) && styles.triggerActive];
}

/**
 * Shared kebab (⋮) menu for per-file actions. Used by the file explorer tree and
 * git diff pane so both surfaces share action availability, ordering, and chrome.
 */
export function FileActionsMenu({
  contextTarget,
  fileKind,
  fileExists = true,
  onOpenFile,
  onOpenInFileManager,
  onOpenInEditor,
  editorTargetName,
  onCopyPath,
  onDownload,
  onAddToChat,
  onNewFile,
  onNewDirectory,
  onRename,
  onDelete,
  onOpenInBrowser,
  onOpenInExternalBrowser,
  header,
  open,
  onOpenChange,
  hitSlop = 12,
  accessibilityLabel,
  testIDPrefix,
}: FileActionsMenuProps): ReactElement | null {
  const { t } = useTranslation();
  const actions = useMemo<FileAction[]>(() => {
    const availableFile = fileKind === "file" && fileExists;
    const candidates: FileActionCandidate[] = [
      {
        key: "newFile",
        label: t("workspace.fileActions.newFile"),
        icon: FilePlus,
        callback: onNewFile,
      },
      {
        key: "newDirectory",
        label: t("workspace.fileActions.newDirectory"),
        icon: FolderPlus,
        callback: onNewDirectory,
      },
      {
        key: "openInBrowser",
        label: t("workspace.fileActions.openInBrowser"),
        icon: Globe,
        callback: onOpenInBrowser,
      },
      {
        key: "openInExternalBrowser",
        label: t("workspace.fileActions.openInExternalBrowser"),
        icon: ExternalLink,
        callback: onOpenInExternalBrowser,
      },
      {
        key: "open-file",
        label: t("workspace.fileActions.openFile"),
        icon: FileText,
        callback: availableFile ? onOpenFile : undefined,
      },
      {
        key: "open-in-file-manager",
        label: t("workspace.fileActions.openInFileManager"),
        icon: FolderOpen,
        callback: fileExists ? onOpenInFileManager : undefined,
      },
      {
        key: "open-in-editor",
        label: t("workspace.fileActions.openIn", { target: editorTargetName }),
        icon: ExternalLink,
        callback: fileKind === "directory" && editorTargetName ? onOpenInEditor : undefined,
      },
      {
        key: "copy-path",
        label: t("workspace.fileActions.copyPath"),
        icon: Copy,
        callback: onCopyPath,
      },
      {
        key: "download",
        label: t("workspace.fileActions.download"),
        icon: Download,
        callback: availableFile ? onDownload : undefined,
      },
      {
        key: "add-to-chat",
        label: t("workspace.fileActions.addToChat"),
        icon: MessageSquarePlus,
        callback: availableFile ? onAddToChat : undefined,
      },
      { key: "rename", label: t("workspace.fileActions.rename"), icon: Pencil, callback: onRename },
      { key: "delete", label: t("workspace.fileActions.delete"), icon: Trash2, callback: onDelete },
    ];
    const next: FileAction[] = [];
    for (const candidate of candidates) {
      if (candidate.callback)
        next.push({
          key: candidate.key,
          label: candidate.label,
          icon: candidate.icon,
          onSelect: candidate.callback,
          testID: testIDPrefix ? `${testIDPrefix}-${candidate.key}` : undefined,
        });
    }
    return next;
  }, [
    fileExists,
    fileKind,
    editorTargetName,
    onAddToChat,
    onCopyPath,
    onDownload,
    onOpenFile,
    onOpenInEditor,
    onOpenInFileManager,
    onNewFile,
    onNewDirectory,
    onRename,
    onDelete,
    onOpenInBrowser,
    onOpenInExternalBrowser,
    t,
    testIDPrefix,
  ]);

  if (actions.length === 0) {
    return contextTarget ?? null;
  }
  if (contextTarget)
    return (
      <ContextMenu>
        <ContextMenuTrigger enabledOnMobile accessibilityLabel={accessibilityLabel}>
          {contextTarget}
        </ContextMenuTrigger>
        <ContextMenuContent width={220}>
          {actions.map((action) => (
            <FileActionMenuItem key={action.key} action={action} context />
          ))}
        </ContextMenuContent>
      </ContextMenu>
    );
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        hitSlop={hitSlop}
        onPressIn={stopTriggerPropagation}
        style={triggerStyle}
        accessibilityLabel={accessibilityLabel}
        testID={testIDPrefix ? `${testIDPrefix}-actions` : undefined}
      >
        <ThemedMoreVertical size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        {header ? (
          <>
            {header}
            <DropdownMenuSeparator />
          </>
        ) : null}
        {actions.map((action) => (
          <FileActionMenuItem key={action.key} action={action} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FileActionMenuItem({
  action,
  context = false,
}: {
  action: FileAction;
  context?: boolean;
}): ReactElement {
  const Icon = action.icon;
  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);
  const leading = useMemo(
    () => <ThemedIcon size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />,
    [ThemedIcon],
  );
  const Item = context ? ContextMenuItem : DropdownMenuItem;
  const shortcut = { rename: "F2", delete: "Delete" };
  let trailing: ReactElement | undefined;
  if (context && (action.key === "rename" || action.key === "delete"))
    trailing = <Text style={styles.shortcut}>{shortcut[action.key]}</Text>;
  return (
    <Item leading={leading} trailing={trailing} onSelect={action.onSelect} testID={action.testID}>
      {action.label}
    </Item>
  );
}

const styles = StyleSheet.create((theme) => ({
  shortcut: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  trigger: {
    // The hover box comes from padding, but an equal negative vertical margin
    // cancels its height contribution so the trigger overlaps the row's natural
    // line height instead of growing it. The comfortable tap target is `hitSlop`,
    // never padding.
    padding: theme.spacing[1],
    width: FILE_ACTIONS_MENU_WIDTH,
    marginVertical: -theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  triggerActive: {
    backgroundColor: theme.colors.surface2,
  },
}));
