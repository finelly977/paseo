import { memo, useCallback, useMemo } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemedChevron, chevronColorMapping } from "@/git/themed-chevron";
import type { ClassifiedCheckoutCommit } from "@/git/use-commits-query";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { formatTimeAgo } from "@/utils/time";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { getScmStatusDecoration, splitScmPath } from "@/git/scm-model";
import { CommitGraphNode } from "./commit-graph-node";

interface CommitRowProps {
  commit: ClassifiedCheckoutCommit;
  isFirst: boolean;
  isLast: boolean;
  isOnBaseLane: boolean;
  isBranchPoint: boolean;
  now: Date;
  isExpanded: boolean;
  refs: CommitRef[];
  onToggleExpanded: (sha: string) => void;
  onOpenCommitDiff: (sha: string) => void;
}

interface CommitRowHeaderProps {
  commit: ClassifiedCheckoutCommit;
  isFirst: boolean;
  isLast: boolean;
  isOnBaseLane: boolean;
  isBranchPoint: boolean;
  isExpanded: boolean;
  now: Date;
  refs: CommitRef[];
}

export interface CommitRef {
  label: string;
  kind: "current" | "base" | "remote" | "tag";
}

function commitRowPressableStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.row, (Boolean(hovered) || pressed) && styles.rowActive];
}

function CommitRefPill({ ref }: { ref: CommitRef }) {
  return (
    <View
      style={[
        styles.refPill,
        ref.kind === "base" && styles.refPillBase,
        ref.kind === "remote" && styles.refPillRemote,
        ref.kind === "tag" && styles.refPillTag,
      ]}
    >
      <Text
        style={[
          styles.refText,
          ref.kind === "base" && styles.refTextBase,
          ref.kind === "remote" && styles.refTextRemote,
          ref.kind === "tag" && styles.refTextTag,
        ]}
        numberOfLines={1}
      >
        {ref.label}
      </Text>
    </View>
  );
}

function CommitRefList({ refs }: { refs: CommitRef[] }) {
  if (refs.length === 0) {
    return null;
  }
  return (
    <View style={styles.refs}>
      {refs.map((ref) => (
        <CommitRefPill key={`${ref.kind}-${ref.label}`} ref={ref} />
      ))}
    </View>
  );
}

function CommitRowHeader({
  commit,
  isFirst,
  isLast,
  isOnBaseLane,
  isBranchPoint,
  isExpanded,
  now,
  refs,
}: CommitRowHeaderProps) {
  return (
    <>
      <CommitGraphNode
        commit={commit}
        isFirst={isFirst}
        isLast={isLast}
        isOnBaseLane={isOnBaseLane}
        isBranchPoint={isBranchPoint}
      />
      <View style={styles.commitDetails}>
        <Text style={[styles.subject, isFirst && styles.subjectCurrent]} numberOfLines={1}>
          {commit.subject}
        </Text>
        <CommitRefList refs={refs} />
      </View>
      <Text style={styles.author} numberOfLines={1}>
        {commit.authorName}
      </Text>
      <Text style={styles.timestamp}>{formatTimeAgo(new Date(commit.authorDate), now)}</Text>
      <View style={styles.caret}>
        <ThemedChevron
          size={14}
          uniProps={chevronColorMapping}
          style={isExpanded ? styles.caretExpanded : undefined}
        />
      </View>
    </>
  );
}

function CommitTooltipDetails({
  commit,
  authoredAt,
  refs,
}: {
  commit: ClassifiedCheckoutCommit;
  authoredAt: string;
  refs: CommitRef[];
}) {
  const message = commit.message?.trim() || commit.subject;
  return (
    <TooltipContent side="left" align="center" offset={8} maxWidth={420}>
      <View style={styles.tooltip} testID={`commit-tooltip-${commit.shortSha}`}>
        <Text style={styles.tooltipMessage}>{message}</Text>
        <Text style={styles.tooltipMetadata}>
          {commit.authorName} | {authoredAt}
        </Text>
        <Text dataSet={CODE_SURFACE_DATASET} style={styles.tooltipSha} selectable>
          {commit.sha}
        </Text>
        {refs.length > 0 ? (
          <Text style={styles.tooltipMetadata}>{refs.map((ref) => ref.label).join(", ")}</Text>
        ) : null}
      </View>
    </TooltipContent>
  );
}

function CommitFiles({ commit }: { commit: ClassifiedCheckoutCommit }) {
  return (
    <View style={styles.files} testID={`commit-files-${commit.shortSha}`}>
      {commit.files.map((file) => {
        const { fileName, directory } = splitScmPath(file.path);
        const decoration = getScmStatusDecoration(file.status ?? "modified");
        return (
          <View key={`${file.path}-${file.status ?? ""}`} style={styles.fileRow}>
            <MaterialFileIcon fileName={fileName} size={16} />
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
            <Text style={styles.fileStatus}>{decoration.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export const CommitRow = memo(function CommitRow({
  commit,
  isFirst,
  isLast,
  isOnBaseLane,
  isBranchPoint,
  now,
  isExpanded,
  refs,
  onToggleExpanded,
  onOpenCommitDiff,
}: CommitRowProps) {
  const { t } = useTranslation();
  const authoredAt = useMemo(
    () => new Date(commit.authorDate).toLocaleString(),
    [commit.authorDate],
  );
  const handlePress = useCallback(
    () => onToggleExpanded(commit.sha),
    [commit.sha, onToggleExpanded],
  );
  const handleOpenCommitDiff = useCallback(
    () => onOpenCommitDiff(commit.sha),
    [commit.sha, onOpenCommitDiff],
  );

  return (
    <ContextMenu>
      <Tooltip delayDuration={350}>
        <TooltipTrigger asChild triggerRefProp="triggerRef">
          <ContextMenuTrigger
            enabledOnMobile
            accessibilityRole="button"
            accessibilityLabel={`${commit.subject}, ${commit.authorName}, ${authoredAt}`}
            testID={`commit-row-${commit.shortSha}`}
            onPress={handlePress}
            style={commitRowPressableStyle}
          >
            <CommitRowHeader
              commit={commit}
              isFirst={isFirst}
              isLast={isLast}
              isOnBaseLane={isOnBaseLane}
              isBranchPoint={isBranchPoint}
              isExpanded={isExpanded}
              now={now}
              refs={refs}
            />
          </ContextMenuTrigger>
        </TooltipTrigger>
        <CommitTooltipDetails commit={commit} authoredAt={authoredAt} refs={refs} />
      </Tooltip>
      {isExpanded ? <CommitFiles commit={commit} /> : null}
      <ContextMenuContent side="left" align="start" minWidth={190}>
        <ContextMenuItem
          testID={`commit-open-diff-${commit.shortSha}`}
          onSelect={handleOpenCommitDiff}
        >
          {t("workspace.git.diff.commits.openFullDiff")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[2],
  },
  rowActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  commitDetails: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  subject: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  subjectCurrent: {
    fontWeight: theme.fontWeight.medium,
  },
  refs: {
    maxWidth: 220,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    overflow: "hidden",
  },
  refPill: {
    maxWidth: 140,
    paddingHorizontal: theme.spacing[1],
    height: 16,
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.accent,
  },
  refPillBase: {
    backgroundColor: theme.colors.surface3,
  },
  refPillRemote: {
    backgroundColor: theme.colors.statusMerged,
  },
  refPillTag: {
    backgroundColor: theme.colors.statusWarning,
  },
  refText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.accentForeground,
  },
  refTextBase: {
    color: theme.colors.foreground,
  },
  refTextRemote: {
    color: theme.colors.surface0,
  },
  refTextTag: {
    color: theme.colors.surface0,
  },
  author: {
    maxWidth: 72,
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  timestamp: {
    flexShrink: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  caret: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  caretExpanded: {
    transform: [{ rotate: "90deg" }],
  },
  files: {
    paddingBottom: theme.spacing[1],
  },
  fileRow: {
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 42,
    paddingRight: theme.spacing[2],
  },
  fileIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  fileName: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
    flexShrink: 0,
  },
  fileDirectory: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  fileStatus: {
    width: 18,
    textAlign: "center",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  tooltip: {
    gap: theme.spacing[2],
    maxWidth: 390,
  },
  tooltipMessage: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.popoverForeground,
  },
  tooltipMetadata: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  tooltipSha: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.popoverForeground,
  },
}));
