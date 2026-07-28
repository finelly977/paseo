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
        <Text dataSet={CODE_SURFACE_DATASET} style={styles.shortSha} numberOfLines={1}>
          {commit.shortSha}
        </Text>
        <Text style={styles.subject} numberOfLines={1}>
          {commit.subject}
        </Text>
        <CommitRefList refs={refs} />
      </View>
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
  const { t } = useTranslation();
  return (
    <View style={styles.files} testID={`commit-files-${commit.shortSha}`}>
      <Text style={styles.filesHeading}>
        {t("workspace.git.diff.commits.filesChanged", { count: commit.files.length })}
      </Text>
      {commit.files.map((file) => (
        <View key={`${file.path}-${file.status ?? ""}`} style={styles.fileRow}>
          <Text style={styles.filePath} numberOfLines={1}>
            {file.path}
          </Text>
          <Text style={styles.fileStats}>
            <Text style={styles.additions}>+{file.additions}</Text>{" "}
            <Text style={styles.deletions}>-{file.deletions}</Text>
          </Text>
        </View>
      ))}
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
          打开完整 Diff
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[2],
    paddingVertical: theme.spacing[1],
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
  shortSha: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
    width: 70,
    flexShrink: 0,
  },
  subject: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
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
    paddingVertical: 1,
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface1,
  },
  refPillBase: {
    borderColor: theme.colors.foregroundMuted,
  },
  refPillRemote: {
    borderColor: theme.colors.statusMerged,
  },
  refPillTag: {
    borderColor: theme.colors.statusWarning,
  },
  refText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.accent,
  },
  refTextBase: {
    color: theme.colors.foregroundMuted,
  },
  refTextRemote: {
    color: theme.colors.statusMerged,
  },
  refTextTag: {
    color: theme.colors.statusWarning,
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
    marginLeft: 24,
    marginRight: theme.spacing[2],
    marginBottom: theme.spacing[1],
    paddingLeft: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
    gap: theme.spacing[1],
  },
  filesHeading: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  filePath: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foreground,
  },
  fileStats: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
  },
  additions: {
    color: theme.colors.statusSuccess,
  },
  deletions: {
    color: theme.colors.statusDanger,
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
