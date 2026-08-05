import { memo, useCallback, useMemo, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import type { CheckoutCommitFile } from "@getpaseo/protocol/messages";
import {
  Cloud,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  History,
  LocateFixed,
  Tag,
  UserRound,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MaterialFileIcon } from "@/components/material-file-icon";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { getScmStatusDecoration, splitScmPath } from "@/git/scm-model";
import { ThemedChevron, chevronColorMapping } from "@/git/themed-chevron";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { CommitGraphNode, CommitGraphPlaceholder } from "./commit-graph-node";
import type { CommitGraphViewModel } from "./graph-model";

interface CommitRowProps {
  viewModel: CommitGraphViewModel;
  graphWidth: number;
  now: Date;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleExpanded: (sha: string) => void;
  onOpenCommitDiff: (sha: string, path?: string) => void;
}

const ThemedCloud = withUnistyles(Cloud);
const ThemedFileDiff = withUnistyles(FileDiff);
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedGitCommitHorizontal = withUnistyles(GitCommitHorizontal);
const ThemedHistory = withUnistyles(History);
const ThemedLocateFixed = withUnistyles(LocateFixed);
const ThemedTag = withUnistyles(Tag);
const ThemedUserRound = withUnistyles(UserRound);

const mutedIconMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const badgeIconMapping = (theme: { colors: { accentForeground: string } }) => ({
  color: theme.colors.accentForeground,
});
const branchBadgeIconMapping = (theme: { colors: { foreground: string } }) => ({
  color: theme.colors.foreground,
});
const tagBadgeIconMapping = (theme: {
  colorScheme: "light" | "dark";
  colors: { surface0: string };
}) => ({
  color: theme.colorScheme === "dark" ? theme.colors.surface0 : "#ffffff",
});

const commitRelativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatCommitRelativeTime(date: Date, now: Date): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absoluteSeconds = Math.abs(seconds);
  if (absoluteSeconds < 30) {
    return commitRelativeTimeFormatter.format(0, "second");
  }

  const ranges: Array<[number, Intl.RelativeTimeFormatUnit, number]> = [
    [60, "second", 1],
    [3_600, "minute", 60],
    [86_400, "hour", 3_600],
    [604_800, "day", 86_400],
    [2_592_000, "week", 604_800],
    [31_536_000, "month", 2_592_000],
    [Number.POSITIVE_INFINITY, "year", 31_536_000],
  ];
  const range = ranges.find(([maximum]) => absoluteSeconds < maximum);
  if (!range) {
    throw new Error("无法确定提交时间的相对单位");
  }
  const [, unit, divisor] = range;
  const value = Math.sign(seconds) * Math.max(1, Math.floor(absoluteSeconds / divisor));
  return commitRelativeTimeFormatter.format(value, unit);
}

function commitRowPressableStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.row, (Boolean(hovered) || pressed) && styles.rowHovered];
}

function inlineButtonStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.inlineButton, (Boolean(hovered) || pressed) && styles.inlineButtonHovered];
}

function fileRowStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.fileRow, (Boolean(hovered) || pressed) && styles.fileRowHovered];
}

function ReferenceIcon({
  kind,
}: {
  kind: CommitGraphViewModel["commit"]["references"][number]["kind"];
}) {
  switch (kind) {
    case "head":
      return <ThemedLocateFixed size={10} uniProps={badgeIconMapping} />;
    case "branch":
      return <ThemedGitBranch size={10} uniProps={branchBadgeIconMapping} />;
    case "remote":
      return <ThemedCloud size={10} uniProps={badgeIconMapping} />;
    case "tag":
      return <ThemedTag size={10} uniProps={tagBadgeIconMapping} />;
  }
}

function CommitReferences({ viewModel }: { viewModel: CommitGraphViewModel }) {
  const references = viewModel.commit.references.slice(0, 3);
  const hiddenCount = viewModel.commit.references.length - references.length;
  if (references.length === 0) {
    return null;
  }
  return (
    <View style={styles.references}>
      {references.map((reference) => (
        <View
          key={reference.id}
          style={[
            styles.reference,
            reference.kind === "branch" && styles.referenceBranch,
            reference.kind === "remote" && styles.referenceRemote,
            reference.kind === "tag" && styles.referenceTag,
          ]}
        >
          <ReferenceIcon kind={reference.kind} />
          <Text
            style={[
              styles.referenceText,
              reference.kind === "branch" && styles.referenceTextBranch,
              reference.kind === "tag" && styles.referenceTextTag,
            ]}
            numberOfLines={1}
          >
            {reference.name}
          </Text>
        </View>
      ))}
      {hiddenCount > 0 ? (
        <View style={[styles.reference, styles.referenceOverflow]}>
          <Text style={[styles.referenceText, styles.referenceOverflowText]}>+{hiddenCount}</Text>
        </View>
      ) : null}
    </View>
  );
}

function CommitTooltip({
  viewModel,
  authoredAt,
  relativeTime,
}: {
  viewModel: CommitGraphViewModel;
  authoredAt: string;
  relativeTime: string;
}) {
  const { t } = useTranslation();
  const { commit } = viewModel;
  const message = commit.message?.trim() || commit.subject;
  return (
    <TooltipContent
      side="left"
      align="center"
      offset={8}
      maxWidth={480}
      style={styles.tooltipSurface}
    >
      <View style={styles.tooltip} testID={`commit-tooltip-${commit.shortSha}`}>
        <View style={styles.tooltipAuthorRow}>
          <ThemedUserRound size={14} uniProps={mutedIconMapping} />
          <Text style={styles.tooltipAuthor}>{commit.authorName},</Text>
          <ThemedHistory size={14} uniProps={mutedIconMapping} />
          <Text style={styles.tooltipMetadata} numberOfLines={1}>
            {relativeTime} ({authoredAt})
          </Text>
        </View>
        <Text style={styles.tooltipMessage}>{message}</Text>
        <View style={styles.tooltipSeparator} />
        <View style={styles.tooltipStats}>
          <Text style={styles.tooltipMetadata}>
            {t("workspace.git.diff.commits.filesChanged", { count: commit.statistics.files })}
            {commit.statistics.additions > 0 ? (
              <Text style={styles.tooltipAdditions}>
                {`, ${t("workspace.git.diff.commits.insertions", {
                  count: commit.statistics.additions,
                })}`}
              </Text>
            ) : null}
            {commit.statistics.deletions > 0 ? (
              <Text style={styles.tooltipDeletions}>
                {`, ${t("workspace.git.diff.commits.deletions", {
                  count: commit.statistics.deletions,
                })}`}
              </Text>
            ) : null}
          </Text>
        </View>
        {commit.references.length > 0 ? (
          <>
            <View style={styles.tooltipSeparator} />
            <View style={styles.tooltipReferences}>
              {commit.references.map((reference) => (
                <View
                  key={reference.id}
                  style={[
                    styles.tooltipReference,
                    reference.kind === "branch" && styles.referenceBranch,
                    reference.kind === "remote" && styles.referenceRemote,
                    reference.kind === "tag" && styles.referenceTag,
                  ]}
                >
                  <ReferenceIcon kind={reference.kind} />
                  <Text
                    style={[
                      styles.referenceText,
                      reference.kind === "branch" && styles.referenceTextBranch,
                      reference.kind === "tag" && styles.referenceTextTag,
                    ]}
                  >
                    {reference.name}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
        <View style={styles.tooltipSeparator} />
        <View style={styles.tooltipCommitRow}>
          <ThemedGitCommitHorizontal size={14} uniProps={mutedIconMapping} />
          <Text dataSet={CODE_SURFACE_DATASET} style={styles.tooltipSha} selectable>
            {commit.shortSha}
          </Text>
        </View>
      </View>
    </TooltipContent>
  );
}

function CommitFiles({
  viewModel,
  graphWidth,
  onOpenCommitDiff,
}: {
  viewModel: CommitGraphViewModel;
  graphWidth: number;
  onOpenCommitDiff: (sha: string, path?: string) => void;
}) {
  const { commit } = viewModel;
  return (
    <View testID={`commit-files-${commit.shortSha}`}>
      {commit.files.map((file) => (
        <CommitFileRow
          key={`${file.path}-${file.status ?? ""}`}
          commitSha={commit.sha}
          file={file}
          graphWidth={graphWidth}
          lanes={viewModel.outputLanes}
          onOpenCommitDiff={onOpenCommitDiff}
        />
      ))}
    </View>
  );
}

function CommitFileRow({
  commitSha,
  file,
  graphWidth,
  lanes,
  onOpenCommitDiff,
}: {
  commitSha: string;
  file: CheckoutCommitFile;
  graphWidth: number;
  lanes: CommitGraphViewModel["outputLanes"];
  onOpenCommitDiff: (sha: string, path?: string) => void;
}) {
  const { fileName, directory } = splitScmPath(file.path);
  const decoration = getScmStatusDecoration(file.status ?? "modified");
  const handlePress = useCallback(
    () => onOpenCommitDiff(commitSha, file.path),
    [commitSha, file.path, onOpenCommitDiff],
  );
  return (
    <Pressable accessibilityRole="button" onPress={handlePress} style={fileRowStyle}>
      <CommitGraphPlaceholder lanes={lanes} width={graphWidth} />
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
    </Pressable>
  );
}

export const CommitRow = memo(function CommitRow({
  viewModel,
  graphWidth,
  now,
  isSelected,
  isExpanded,
  onToggleExpanded,
  onOpenCommitDiff,
}: CommitRowProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const { commit } = viewModel;
  const authoredAt = useMemo(
    () =>
      new Date(commit.authorDate).toLocaleString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
      }),
    [commit.authorDate],
  );
  const relativeTime = formatCommitRelativeTime(new Date(commit.authorDate), now);
  const showInlineActions = isHovered || isSelected || isNative || isCompact;
  const rowStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => [
      ...commitRowPressableStyle(state),
      isSelected && styles.rowSelected,
    ],
    [isSelected],
  );
  const handlePress = useCallback(() => {
    onToggleExpanded(commit.sha);
  }, [commit.sha, onToggleExpanded]);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const handleToggleExpanded = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onToggleExpanded(commit.sha);
    },
    [commit.sha, onToggleExpanded],
  );
  const handleOpenCommitDiff = useCallback(
    (event?: GestureResponderEvent) => {
      event?.stopPropagation();
      onOpenCommitDiff(commit.sha);
    },
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
            onHoverIn={handleHoverIn}
            onHoverOut={handleHoverOut}
            onPress={handlePress}
            style={rowStyle}
          >
            <CommitGraphNode
              viewModel={viewModel}
              width={graphWidth}
              selected={isSelected}
              hovered={isHovered}
              expanded={isExpanded}
            />
            <View style={styles.commitIdentity}>
              <Text style={styles.identityText} numberOfLines={1} ellipsizeMode="tail">
                <Text style={[styles.subject, viewModel.kind === "head" && styles.subjectCurrent]}>
                  {commit.subject}
                </Text>
                <Text style={[styles.author, viewModel.kind === "head" && styles.authorCurrent]}>
                  {" "}
                  • {commit.authorName}
                </Text>
              </Text>
              <CommitReferences viewModel={viewModel} />
            </View>
            {showInlineActions ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("workspace.git.diff.commits.openFullDiff")}
                hitSlop={4}
                onPress={handleOpenCommitDiff}
                style={inlineButtonStyle}
                testID={`commit-inline-diff-${commit.shortSha}`}
              >
                <ThemedFileDiff size={13} uniProps={mutedIconMapping} />
              </Pressable>
            ) : null}
            {commit.files.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isExpanded
                    ? t("workspace.git.diff.commits.collapseFiles")
                    : t("workspace.git.diff.commits.expandFiles")
                }
                hitSlop={4}
                onPress={handleToggleExpanded}
                style={styles.caret}
              >
                <ThemedChevron
                  size={13}
                  uniProps={chevronColorMapping}
                  style={isExpanded ? styles.caretExpanded : undefined}
                />
              </Pressable>
            ) : (
              <View style={styles.caret} />
            )}
          </ContextMenuTrigger>
        </TooltipTrigger>
        <CommitTooltip viewModel={viewModel} authoredAt={authoredAt} relativeTime={relativeTime} />
      </Tooltip>
      {isExpanded ? (
        <CommitFiles
          viewModel={viewModel}
          graphWidth={graphWidth}
          onOpenCommitDiff={onOpenCommitDiff}
        />
      ) : null}
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
    paddingRight: theme.spacing[1],
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowSelected: {
    backgroundColor: theme.colors.surface2,
  },
  commitIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  identityText: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
  subject: {
    color: theme.colors.foreground,
  },
  subjectCurrent: {
    fontWeight: theme.fontWeight.medium,
  },
  author: {
    color: theme.colors.foregroundMuted,
  },
  authorCurrent: {
    fontWeight: theme.fontWeight.medium,
  },
  references: {
    maxWidth: "48%",
    minWidth: 0,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    overflow: "hidden",
  },
  reference: {
    maxWidth: 132,
    height: 16,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.accent,
  },
  referenceBranch: {
    backgroundColor: theme.colors.surface3,
  },
  referenceRemote: {
    backgroundColor: theme.colors.statusMerged,
  },
  referenceTag: {
    backgroundColor: theme.colors.statusWarning,
  },
  referenceOverflow: {
    backgroundColor: theme.colors.surface3,
  },
  referenceText: {
    flexShrink: 1,
    fontSize: 9,
    lineHeight: 12,
    color: theme.colors.accentForeground,
  },
  referenceOverflowText: {
    color: theme.colors.foreground,
  },
  referenceTextBranch: {
    color: theme.colors.foreground,
  },
  referenceTextTag: {
    color: theme.colorScheme === "dark" ? theme.colors.surface0 : "#ffffff",
  },
  inlineButton: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
  },
  inlineButtonHovered: {
    backgroundColor: theme.colors.surface3,
  },
  caret: {
    width: 18,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  caretExpanded: {
    transform: [{ rotate: "90deg" }],
  },
  fileRow: {
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: theme.spacing[2],
  },
  fileRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
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
  tooltipSurface: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderRadius: theme.borderRadius.base,
  },
  tooltip: {
    minWidth: 320,
    maxWidth: 440,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  tooltipAuthorRow: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  tooltipAuthor: {
    marginRight: theme.spacing[1],
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.popoverForeground,
  },
  tooltipMessage: {
    marginTop: theme.spacing[1],
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    color: theme.colors.popoverForeground,
  },
  tooltipMetadata: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  tooltipSeparator: {
    height: theme.borderWidth[1],
    marginVertical: theme.spacing[2],
    backgroundColor: theme.colors.border,
  },
  tooltipStats: {
    minHeight: 18,
    justifyContent: "center",
  },
  tooltipAdditions: {
    color: theme.colorScheme === "dark" ? "#81b88b" : "#587c0c",
  },
  tooltipDeletions: {
    color: theme.colorScheme === "dark" ? "#c74e39" : "#ad0707",
  },
  tooltipReferences: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  tooltipReference: {
    minHeight: 18,
    maxWidth: 180,
    paddingHorizontal: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 9,
    backgroundColor: theme.colors.accent,
  },
  tooltipCommitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  tooltipSha: {
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
}));
