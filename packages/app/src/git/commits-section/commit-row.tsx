import { memo, useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
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
  now: Date;
  onCommitPress: (sha: string) => void;
}

function commitRowPressableStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.row, (Boolean(hovered) || pressed) && styles.rowActive];
}

export const CommitRow = memo(function CommitRow({
  commit,
  isFirst,
  isLast,
  now,
  onCommitPress,
}: CommitRowProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onCommitPress(commit.sha);
  }, [commit.sha, onCommitPress]);
  const authoredAt = useMemo(
    () => new Date(commit.authorDate).toLocaleString(),
    [commit.authorDate],
  );
  const visibleFiles = commit.files.slice(0, 6);
  const remainingFileCount = commit.files.length - visibleFiles.length;

  return (
    <Tooltip delayDuration={350}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${commit.subject}, ${commit.authorName}, ${authoredAt}`}
          testID={`commit-row-${commit.shortSha}`}
          onPress={handlePress}
          style={commitRowPressableStyle}
        >
          <CommitGraphNode commit={commit} isFirst={isFirst} isLast={isLast} />
          <View style={styles.commitDetails}>
            <Text dataSet={CODE_SURFACE_DATASET} style={styles.shortSha} numberOfLines={1}>
              {commit.shortSha}
            </Text>
            <Text style={styles.subject} numberOfLines={1}>
              {commit.subject}
            </Text>
          </View>
          <Text style={styles.timestamp}>{formatTimeAgo(new Date(commit.authorDate), now)}</Text>
          <View style={styles.caret}>
            <ThemedChevron size={14} uniProps={chevronColorMapping} />
          </View>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="left" align="center" offset={8} maxWidth={420}>
        <View style={styles.tooltip} testID={`commit-tooltip-${commit.shortSha}`}>
          <Text style={styles.tooltipSubject}>{commit.subject}</Text>
          <Text style={styles.tooltipMetadata}>
            {commit.authorName} | {authoredAt}
          </Text>
          <Text dataSet={CODE_SURFACE_DATASET} style={styles.tooltipSha} selectable>
            {commit.sha}
          </Text>
          {commit.files.length > 0 ? (
            <View style={styles.tooltipFiles}>
              <Text style={styles.tooltipFilesCount}>
                {t("workspace.git.diff.commits.filesChanged", { count: commit.files.length })}
              </Text>
              {visibleFiles.map((file) => (
                <Text key={file.path} style={styles.tooltipFile} numberOfLines={1}>
                  {file.path}
                </Text>
              ))}
              {remainingFileCount > 0 ? (
                <Text style={styles.tooltipMetadata}>
                  {t("workspace.git.diff.commits.moreFiles", { count: remainingFileCount })}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </TooltipContent>
    </Tooltip>
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
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
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
  tooltip: {
    gap: theme.spacing[2],
    maxWidth: 390,
  },
  tooltipSubject: {
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
  tooltipFiles: {
    gap: theme.spacing[1],
  },
  tooltipFilesCount: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.popoverForeground,
  },
  tooltipFile: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
}));
