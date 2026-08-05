import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { Minus, Plus, Undo2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { CheckoutScmChanges, CheckoutScmFileChange } from "@getpaseo/protocol/messages";
import { MaterialFileIcon } from "@/components/material-file-icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { isNative } from "@/constants/platform";
import type { CheckoutGitActionStatus } from "@/git/actions-store";
import { getScmStatusDecoration, splitScmPath, type ScmStatusTone } from "@/git/scm-model";
import { SourceControlSectionHeader } from "@/git/source-control-panel";

type ScmGroupKind = "conflicts" | "staged" | "unstaged";

interface ScmChangesListProps {
  changes: CheckoutScmChanges;
  isCompact: boolean;
  stageStatus: CheckoutGitActionStatus;
  unstageStatus: CheckoutGitActionStatus;
  discardStatus: CheckoutGitActionStatus;
  onOpenFile: (path: string) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
}

interface ScmFileRowProps {
  change: CheckoutScmFileChange;
  group: ScmGroupKind;
  isCompact: boolean;
  disabled: boolean;
  onOpenFile: (path: string) => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
}

type ScmRowActionKind = "stage" | "unstage" | "discard";

const ThemedPlus = withUnistyles(Plus);
const ThemedMinus = withUnistyles(Minus);
const ThemedUndo2 = withUnistyles(Undo2);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const foregroundIconColorMapping = (theme: { colors: { foreground: string } }) => ({
  color: theme.colors.foreground,
});
const mutedIconColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

function statusTextStyle(tone: ScmStatusTone) {
  switch (tone) {
    case "added":
      return styles.statusAdded;
    case "modified":
      return styles.statusModified;
    case "deleted":
      return styles.statusDeleted;
    case "untracked":
      return styles.statusUntracked;
    case "conflict":
      return styles.statusConflict;
  }
}

function rowStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.fileRow, (Boolean(hovered) || pressed) && styles.fileRowActive];
}

function actionButtonStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.actionButton, (Boolean(hovered) || pressed) && styles.actionButtonActive];
}

function ScmRowAction({
  label,
  disabled,
  onPress,
  onHoverIn,
  onHoverOut,
  kind,
  testID,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
  kind: ScmRowActionKind;
  testID: string;
}) {
  let icon: ReactElement;
  if (kind === "stage") {
    icon = <ThemedPlus size={15} uniProps={foregroundIconColorMapping} />;
  } else if (kind === "unstage") {
    icon = <ThemedMinus size={15} uniProps={foregroundIconColorMapping} />;
  } else {
    icon = <ThemedUndo2 size={15} uniProps={foregroundIconColorMapping} />;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={4}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      onPress={onPress}
      style={actionButtonStyle}
      testID={testID}
    >
      {icon}
    </Pressable>
  );
}

const ScmFileRow = memo(function ScmFileRow({
  change,
  group,
  isCompact,
  disabled,
  onOpenFile,
  onStage,
  onUnstage,
  onDiscard,
}: ScmFileRowProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [actionHovered, setActionHovered] = useState(false);
  const { fileName, directory } = useMemo(() => splitScmPath(change.path), [change.path]);
  const decoration = useMemo(() => getScmStatusDecoration(change.status), [change.status]);
  const showActions = hovered || actionHovered || isNative || isCompact;
  const openFile = useCallback(() => onOpenFile(change.path), [change.path, onOpenFile]);
  const stage = useCallback(() => onStage([change.path]), [change.path, onStage]);
  const unstage = useCallback(() => onUnstage([change.path]), [change.path, onUnstage]);
  const discard = useCallback(() => onDiscard([change.path]), [change.path, onDiscard]);
  const setRowHovered = useCallback(() => setHovered(true), []);
  const clearRowHovered = useCallback(() => setHovered(false), []);
  const setActionsHovered = useCallback(() => setActionHovered(true), []);
  const clearActionsHovered = useCallback(() => setActionHovered(false), []);
  const canStage = group === "unstaged" || group === "conflicts";
  const canUnstage = group === "staged";
  const canDiscard = group === "unstaged";
  const trailingWidth = (canDiscard && canStage ? 2 : 1) * 20;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        enabledOnMobile
        accessibilityRole="button"
        accessibilityLabel={`${fileName}, ${t(`workspace.git.panel.status.${change.status}`)}`}
        onHoverIn={setRowHovered}
        onHoverOut={clearRowHovered}
        onPress={openFile}
        style={rowStyle}
        testID={`scm-file-${group}-${change.path}`}
      >
        <View style={styles.fileIcon}>
          <MaterialFileIcon fileName={fileName} size={16} />
        </View>
        <View style={styles.fileIdentity}>
          <Text style={styles.fileName} numberOfLines={1}>
            {fileName}
          </Text>
          {directory ? (
            <Text style={styles.fileDirectory} numberOfLines={1}>
              {directory}
            </Text>
          ) : null}
        </View>
        <View style={[styles.rowTrailing, { width: trailingWidth }]}>
          <Text
            style={[
              styles.statusText,
              styles.rowTrailingLayer,
              statusTextStyle(decoration.tone),
              showActions && styles.rowTrailingHidden,
            ]}
          >
            {decoration.label}
          </Text>
          <View
            pointerEvents={showActions ? "auto" : "none"}
            style={[
              styles.rowActions,
              styles.rowTrailingLayer,
              !showActions && styles.rowTrailingHidden,
            ]}
          >
            {canDiscard ? (
              <ScmRowAction
                label={t("workspace.git.panel.discardChange")}
                disabled={disabled}
                onPress={discard}
                onHoverIn={setActionsHovered}
                onHoverOut={clearActionsHovered}
                kind="discard"
                testID={`scm-discard-${change.path}`}
              />
            ) : null}
            {canStage ? (
              <ScmRowAction
                label={t("workspace.git.panel.stageChange")}
                disabled={disabled}
                onPress={stage}
                onHoverIn={setActionsHovered}
                onHoverOut={clearActionsHovered}
                kind="stage"
                testID={`scm-stage-${change.path}`}
              />
            ) : null}
            {canUnstage ? (
              <ScmRowAction
                label={t("workspace.git.panel.unstageChange")}
                disabled={disabled}
                onPress={unstage}
                onHoverIn={setActionsHovered}
                onHoverOut={clearActionsHovered}
                kind="unstage"
                testID={`scm-unstage-${change.path}`}
              />
            ) : null}
          </View>
        </View>
      </ContextMenuTrigger>
      <ContextMenuContent side="left" align="start" minWidth={190}>
        <ContextMenuItem onSelect={openFile}>
          {t("workspace.git.panel.openChanges")}
        </ContextMenuItem>
        {canStage ? (
          <ContextMenuItem disabled={disabled} onSelect={stage}>
            {t("workspace.git.panel.stageChange")}
          </ContextMenuItem>
        ) : null}
        {canUnstage ? (
          <ContextMenuItem disabled={disabled} onSelect={unstage}>
            {t("workspace.git.panel.unstageChange")}
          </ContextMenuItem>
        ) : null}
        {canDiscard ? (
          <ContextMenuItem destructive disabled={disabled} onSelect={discard}>
            {t("workspace.git.panel.discardChange")}
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
});

interface ScmGroupProps extends Omit<ScmFileRowProps, "change" | "group"> {
  group: ScmGroupKind;
  title: string;
  changes: CheckoutScmFileChange[];
  status: CheckoutGitActionStatus;
}

function ScmGroup({
  group,
  title,
  changes,
  status,
  isCompact,
  disabled,
  onOpenFile,
  onStage,
  onUnstage,
  onDiscard,
}: ScmGroupProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const paths = useMemo(() => changes.map((change) => change.path), [changes]);
  const toggleCollapsed = useCallback(() => setCollapsed((value) => !value), []);
  const stageAll = useCallback(() => onStage(paths), [onStage, paths]);
  const unstageAll = useCallback(() => onUnstage(paths), [onUnstage, paths]);
  const discardAll = useCallback(() => onDiscard(paths), [onDiscard, paths]);
  if (changes.length === 0) {
    return null;
  }

  return (
    <View>
      <SourceControlSectionHeader
        title={title}
        count={changes.length}
        collapsible
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        testID={`scm-group-${group}`}
      >
        <View style={styles.groupActions}>
          {status === "pending" ? (
            <ThemedActivityIndicator size="small" uniProps={mutedIconColorMapping} />
          ) : null}
          {group === "unstaged" ? (
            <ScmRowAction
              label={t("workspace.git.panel.discardAllChanges")}
              disabled={disabled}
              onPress={discardAll}
              kind="discard"
              testID="scm-discard-all"
            />
          ) : null}
          {group === "staged" ? (
            <ScmRowAction
              label={t("workspace.git.panel.unstageAllChanges")}
              disabled={disabled}
              onPress={unstageAll}
              kind="unstage"
              testID="scm-unstage-all"
            />
          ) : (
            <ScmRowAction
              label={t("workspace.git.panel.stageAllChanges")}
              disabled={disabled}
              onPress={stageAll}
              kind="stage"
              testID={`scm-stage-all-${group}`}
            />
          )}
        </View>
      </SourceControlSectionHeader>
      {collapsed
        ? null
        : changes.map((change) => (
            <ScmFileRow
              key={`${group}:${change.path}`}
              change={change}
              group={group}
              isCompact={isCompact}
              disabled={disabled}
              onOpenFile={onOpenFile}
              onStage={onStage}
              onUnstage={onUnstage}
              onDiscard={onDiscard}
            />
          ))}
    </View>
  );
}

export function ScmChangesList({
  changes,
  isCompact,
  stageStatus,
  unstageStatus,
  discardStatus,
  onOpenFile,
  onStage,
  onUnstage,
  onDiscard,
}: ScmChangesListProps) {
  const { t } = useTranslation();
  const disabled =
    stageStatus === "pending" || unstageStatus === "pending" || discardStatus === "pending";
  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      <ScmGroup
        group="conflicts"
        title={t("workspace.git.panel.mergeChanges")}
        changes={changes.conflicts}
        status={stageStatus}
        isCompact={isCompact}
        disabled={disabled}
        onOpenFile={onOpenFile}
        onStage={onStage}
        onUnstage={onUnstage}
        onDiscard={onDiscard}
      />
      <ScmGroup
        group="staged"
        title={t("workspace.git.panel.stagedChanges")}
        changes={changes.staged}
        status={unstageStatus}
        isCompact={isCompact}
        disabled={disabled}
        onOpenFile={onOpenFile}
        onStage={onStage}
        onUnstage={onUnstage}
        onDiscard={onDiscard}
      />
      <ScmGroup
        group="unstaged"
        title={t("workspace.git.panel.changes")}
        changes={changes.unstaged}
        status={stageStatus === "pending" ? stageStatus : discardStatus}
        isCompact={isCompact}
        disabled={disabled}
        onOpenFile={onOpenFile}
        onStage={onStage}
        onUnstage={onUnstage}
        onDiscard={onDiscard}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingBottom: theme.spacing[2],
  },
  fileRow: {
    height: {
      xs: 34,
      sm: 34,
      md: 22,
    },
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 18,
    paddingRight: 8,
    gap: 6,
    userSelect: "none",
  },
  fileRowActive: {
    backgroundColor: theme.colors.scmListHoverBackground,
  },
  fileIcon: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  fileIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  fileName: {
    color: theme.colors.foreground,
    fontSize: 13,
    flexShrink: 0,
  },
  fileDirectory: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    flex: 1,
    minWidth: 0,
  },
  statusText: {
    width: 18,
    textAlign: "center",
    fontSize: 12,
    fontWeight: theme.fontWeight.medium,
  },
  statusAdded: {
    color: theme.colors.scmStatusAdded,
  },
  statusModified: {
    color: theme.colors.scmStatusModified,
  },
  statusDeleted: {
    color: theme.colors.scmStatusDeleted,
  },
  statusUntracked: {
    color: theme.colors.scmStatusUntracked,
  },
  statusConflict: {
    color: theme.colors.scmStatusConflict,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  rowTrailing: {
    height: 20,
    position: "relative",
    flexShrink: 0,
  },
  rowTrailingLayer: {
    position: "absolute",
    right: 0,
    top: 0,
  },
  rowTrailingHidden: {
    opacity: 0,
  },
  groupActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
  },
  actionButton: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 3,
  },
  actionButtonActive: {
    backgroundColor: theme.colors.surface2,
  },
}));
