import { memo, useCallback, useMemo, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import type { CheckoutCommitFile } from "@getpaseo/protocol/messages";
import * as Clipboard from "expo-clipboard";
import {
  Cloud,
  Copy,
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
import { ForgeBrandIcon } from "@/git/forge-icon";
import { getForgePresentation } from "@/git/forge";
import { buildForgeCommitUrl } from "@/git/forge-url";
import { openExternalUrl } from "@/utils/open-external-url";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import { renderCommitMessageText } from "@/git/commit-message-text";
import { CommitGraphNode, CommitGraphPlaceholder } from "./commit-graph-node";
import type { CommitGraphViewModel } from "./graph-model";

interface CommitRowProps {
  viewModel: CommitGraphViewModel;
  graphWidth: number;
  now: Date;
  isSelected: boolean;
  isExpanded: boolean;
  remoteUrl: string | null;
  forge: string;
  onToggleExpanded: (sha: string) => void;
  onOpenCommitDiff: (sha: string, path?: string) => void;
  onReviewCommit?: (sha: string) => void;
}

const ThemedCloud = withUnistyles(Cloud);
const ThemedCopy = withUnistyles(Copy);
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
const graphLinkIconMapping = (theme: { colors: { scmGraphLinkForeground: string } }) => ({
  color: theme.colors.scmGraphLinkForeground,
});
const currentReferenceIconMapping = (theme: {
  colors: { scmGraphCurrentRefForeground: string };
}) => ({ color: theme.colors.scmGraphCurrentRefForeground });
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
  inTooltip = false,
}: {
  kind: CommitGraphViewModel["commit"]["references"][number]["kind"];
  inTooltip?: boolean;
}) {
  switch (kind) {
    case "head":
      return <ThemedLocateFixed size={10} uniProps={badgeIconMapping} />;
    case "branch":
      return (
        <ThemedGitBranch
          size={10}
          uniProps={inTooltip ? currentReferenceIconMapping : branchBadgeIconMapping}
        />
      );
    case "remote":
      return <ThemedCloud size={inTooltip ? 14 : 10} uniProps={badgeIconMapping} />;
    case "tag":
      return <ThemedTag size={inTooltip ? 14 : 10} uniProps={tagBadgeIconMapping} />;
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
  remoteUrl,
  forge,
}: {
  viewModel: CommitGraphViewModel;
  authoredAt: string;
  relativeTime: string;
  remoteUrl: string | null;
  forge: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { commit } = viewModel;
  const message = renderCommitMessageText(commit.message?.trim() || commit.subject);
  const forgePresentation = getForgePresentation(forge);
  const commitUrl = buildForgeCommitUrl(forge, { remoteUrl, sha: commit.sha });
  const handleCopySha = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      void Clipboard.setStringAsync(commit.sha)
        .then(() => toast.copied(t("common.states.copied")))
        .catch((error) => {
          console.error("[Git 图表] 复制提交标识失败", error);
          toast.error(toErrorMessage(error));
        });
    },
    [commit.sha, t, toast],
  );
  const handleOpenCommit = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      if (!commitUrl) {
        return;
      }
      void openExternalUrl(commitUrl).catch((error) => {
        console.error("[Git 图表] 打开远端提交失败", error);
        toast.error(toErrorMessage(error));
      });
    },
    [commitUrl, toast],
  );
  return (
    <TooltipContent
      side="left"
      align="center"
      offset={8}
      maxWidth={640}
      style={styles.tooltipSurface}
    >
      <View style={styles.tooltip} testID={`commit-tooltip-${commit.shortSha}`}>
        <View style={styles.tooltipHeaderSection}>
          <View style={styles.tooltipAuthorRow}>
            <ThemedUserRound size={14} uniProps={mutedIconMapping} />
            <Text style={styles.tooltipAuthor}>{commit.authorName},</Text>
            <ThemedHistory size={14} uniProps={mutedIconMapping} />
            <Text style={styles.tooltipMetadata} numberOfLines={1}>
              {relativeTime} ({authoredAt})
            </Text>
          </View>
          <Text style={styles.tooltipMessage}>{message}</Text>
        </View>
        <View style={styles.tooltipSeparator} />
        <View style={[styles.tooltipSection, styles.tooltipStats]}>
          <Text style={styles.tooltipStatsText}>
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
            <View style={styles.tooltipSection}>
              <View style={styles.tooltipReferences}>
                {commit.references.map((reference) => (
                  <View
                    key={reference.id}
                    style={[
                      styles.tooltipReference,
                      reference.kind === "branch" && styles.tooltipReferenceBranch,
                      reference.kind === "remote" && styles.referenceRemote,
                      reference.kind === "tag" && styles.referenceTag,
                    ]}
                  >
                    <ReferenceIcon kind={reference.kind} inTooltip />
                    <Text
                      style={[
                        styles.referenceText,
                        styles.tooltipReferenceText,
                        reference.kind === "branch" && styles.tooltipReferenceTextBranch,
                        reference.kind === "tag" && styles.referenceTextTag,
                      ]}
                      numberOfLines={1}
                    >
                      {reference.name}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : null}
        <View style={styles.tooltipSeparator} />
        <View style={styles.tooltipCommitRow}>
          <ThemedGitCommitHorizontal size={14} uniProps={graphLinkIconMapping} />
          <Text dataSet={CODE_SURFACE_DATASET} style={styles.tooltipSha} selectable>
            {commit.shortSha}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.actions.copy")}
            hitSlop={4}
            onPress={handleCopySha}
            style={inlineButtonStyle}
          >
            <ThemedCopy size={13} uniProps={graphLinkIconMapping} />
          </Pressable>
          {commitUrl ? (
            <>
              <View style={styles.tooltipCommitDivider} />
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t("workspace.git.pr.actions.openOn", {
                  brand: forgePresentation.brandLabel,
                })}
                onPress={handleOpenCommit}
                style={styles.tooltipOpenLink}
              >
                <ForgeBrandIcon
                  iconKind={forgePresentation.icon}
                  size={14}
                  uniProps={graphLinkIconMapping}
                />
                <Text style={styles.tooltipOpenLinkText}>
                  {t("workspace.git.pr.actions.openOn", {
                    brand: forgePresentation.brandLabel,
                  })}
                </Text>
              </Pressable>
            </>
          ) : null}
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
  remoteUrl,
  forge,
  onToggleExpanded,
  onOpenCommitDiff,
  onReviewCommit,
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
  const handleReviewCommit = useCallback(() => {
    onReviewCommit?.(commit.sha);
  }, [commit.sha, onReviewCommit]);

  return (
    <ContextMenu>
      <Tooltip delayDuration={350} interactive>
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
        <CommitTooltip
          viewModel={viewModel}
          authoredAt={authoredAt}
          relativeTime={relativeTime}
          remoteUrl={remoteUrl}
          forge={forge}
        />
      </Tooltip>
      {isExpanded ? (
        <CommitFiles
          viewModel={viewModel}
          graphWidth={graphWidth}
          onOpenCommitDiff={onOpenCommitDiff}
        />
      ) : null}
      <ContextMenuContent side="left" align="start" minWidth={190}>
        {onReviewCommit ? (
          <ContextMenuItem
            testID={`commit-review-${commit.shortSha}`}
            onSelect={handleReviewCommit}
          >
            {t("workspace.git.ai.review.action")}
          </ContextMenuItem>
        ) : null}
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
    fontSize: 13,
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
    fontSize: 11,
    lineHeight: 13,
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
    fontSize: 13,
    color: theme.colors.foreground,
    flexShrink: 0,
  },
  fileDirectory: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  fileStatus: {
    width: 18,
    textAlign: "center",
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
  tooltipSurface: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
    ...theme.shadow.sm,
  },
  tooltip: {
    overflow: "hidden",
  },
  tooltipHeaderSection: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  tooltipSection: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  tooltipAuthorRow: {
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  tooltipAuthor: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.scmGraphLinkForeground,
  },
  tooltipMessage: {
    marginTop: 4,
    maxWidth: 420,
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.popoverForeground,
  },
  tooltipMetadata: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  tooltipSeparator: {
    height: theme.borderWidth[1],
    marginVertical: 4,
    backgroundColor: theme.colors.border,
  },
  tooltipStats: {
    minHeight: 18,
    justifyContent: "center",
  },
  tooltipStatsText: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.popoverForeground,
  },
  tooltipAdditions: {
    color: theme.colorScheme === "dark" ? "#81b88b" : "#587c0c",
  },
  tooltipDeletions: {
    color: theme.colorScheme === "dark" ? "#c74e39" : "#ad0707",
  },
  tooltipReferences: {
    flexDirection: "row",
    gap: 4,
  },
  tooltipReference: {
    minHeight: 18,
    paddingHorizontal: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 10,
    backgroundColor: theme.colors.accent,
  },
  tooltipReferenceBranch: {
    backgroundColor: theme.colors.scmGraphCurrentRefBackground,
  },
  tooltipReferenceText: {
    fontSize: 12,
    lineHeight: 14,
  },
  tooltipReferenceTextBranch: {
    color: theme.colors.scmGraphCurrentRefForeground,
  },
  tooltipCommitRow: {
    minHeight: 20,
    paddingHorizontal: 0,
    paddingVertical: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  tooltipSha: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.scmGraphLinkForeground,
  },
  tooltipCommitDivider: {
    width: theme.borderWidth[1],
    height: 14,
    marginHorizontal: 4,
    backgroundColor: theme.colors.border,
  },
  tooltipOpenLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  tooltipOpenLinkText: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.scmGraphLinkForeground,
  },
}));
