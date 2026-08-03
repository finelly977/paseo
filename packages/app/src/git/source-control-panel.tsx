import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  GitBranch,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { CheckoutGitActionStatus } from "@/git/actions-store";
import type { GitActions } from "@/git/policy";
import type { CheckoutStatusResponse } from "@getpaseo/protocol/messages";
import { GitActionsSplitButton } from "@/git/actions-split-button";

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedArrowDownUp = withUnistyles(ArrowDownUp);
const ThemedCloudUpload = withUnistyles(CloudUpload);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedChevronDown = withUnistyles(ChevronDown);

export interface SourceControlRepositoryHeaderProps {
  repositoryName: string;
  gitActions: GitActions;
  children: ReactNode;
}

export function SourceControlRepositoryHeader({
  repositoryName,
  gitActions,
  children,
}: SourceControlRepositoryHeaderProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.repositorySection} testID="source-control-repository">
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>{t("workspace.git.panel.repository")}</Text>
      </View>
      <View style={styles.repositoryRow}>
        <View style={styles.repositoryIdentity}>
          <ThemedGitBranch size={17} uniProps={mutedIconColorMapping} />
          <Text style={styles.repositoryName} numberOfLines={1}>
            {repositoryName}
          </Text>
        </View>
        <View style={styles.repositoryBranch}>{children}</View>
        <View style={styles.repositoryActions}>
          <GitActionsSplitButton gitActions={gitActions} hideLabels />
        </View>
      </View>
    </View>
  );
}

export interface SourceControlSectionHeaderProps {
  title: string;
  count?: number | null;
  children?: ReactNode;
  testID?: string;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

function headingTitlePressableStyle({ pressed }: PressableStateCallbackType) {
  return [styles.changesHeadingTitle, pressed && styles.changesHeadingTitlePressed];
}

export function SourceControlSectionHeader({
  title,
  count,
  children,
  testID,
  collapsible = false,
  collapsed = false,
  onToggleCollapsed,
}: SourceControlSectionHeaderProps) {
  const { t } = useTranslation();
  const accessibilityLabel = useMemo(() => {
    if (!collapsible) {
      return undefined;
    }
    return collapsed
      ? t("workspace.git.panel.expandSection", { section: title })
      : t("workspace.git.panel.collapseSection", { section: title });
  }, [collapsed, collapsible, t, title]);
  const pressable = collapsible && onToggleCollapsed ? onToggleCollapsed : undefined;
  return (
    <View style={styles.changesHeading} testID={testID}>
      <Pressable
        accessibilityRole={collapsible ? "button" : undefined}
        accessibilityLabel={accessibilityLabel}
        disabled={!pressable}
        onPress={pressable}
        style={headingTitlePressableStyle}
        testID={testID ? `${testID}-toggle` : undefined}
      >
        {collapsible ? (
          <View style={styles.headingTwistie}>
            {collapsed ? (
              <ThemedChevronRight size={14} uniProps={mutedIconColorMapping} />
            ) : (
              <ThemedChevronDown size={14} uniProps={mutedIconColorMapping} />
            )}
          </View>
        ) : null}
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {title}
        </Text>
        {count !== undefined && count !== null ? (
          <Text style={styles.count} accessibilityLabel={`${title}: ${count}`}>
            {count}
          </Text>
        ) : null}
      </Pressable>
      {children ? <View style={styles.changesHeadingActions}>{children}</View> : null}
    </View>
  );
}

export interface SourceControlCommitComposerProps {
  branchName: string;
  hasChanges: boolean;
  status: CheckoutGitActionStatus;
  /** Full checkout status; used only to derive Sync/Publish button state. */
  gitStatus?: CheckoutStatusResponse["payload"] | null | undefined;
  onCommit: (message: string) => Promise<boolean>;
  onSync?: (() => void) | undefined;
  onPublish?: (() => void) | undefined;
}

type CommitButtonKind = "commit" | "sync" | "publish";

interface ResolveButtonKindInput {
  hasChanges: boolean;
  hasRemote: boolean;
  hasAhead: boolean;
  hasBehind: boolean;
  branchName: string;
}

function resolveButtonKind({
  hasChanges,
  hasRemote,
  hasAhead,
  hasBehind,
  branchName,
}: ResolveButtonKindInput): CommitButtonKind {
  if (hasChanges) {
    return "commit";
  }
  if (hasRemote && (hasAhead || hasBehind)) {
    return "sync";
  }
  if (!hasRemote && branchName.length > 0) {
    return "publish";
  }
  return "commit";
}

function commitButtonPressableStyle({
  hovered,
  pressed,
  canPress,
}: PressableStateCallbackType & { hovered?: boolean; canPress: boolean }) {
  return [
    styles.commitButton,
    canPress && (Boolean(hovered) || pressed) && styles.commitButtonHovered,
    !canPress && styles.commitButtonDisabled,
  ];
}

export function SourceControlCommitComposer({
  branchName,
  hasChanges,
  status,
  gitStatus,
  onCommit,
  onSync,
  onPublish,
}: SourceControlCommitComposerProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [focused, setFocused] = useState(false);
  const isPending = status === "pending";
  const isGit = Boolean(gitStatus && gitStatus.isGit);
  const aheadOfOrigin = isGit ? (gitStatus!.aheadOfOrigin ?? 0) : 0;
  const behindOfOrigin = isGit ? (gitStatus!.behindOfOrigin ?? 0) : 0;
  const hasRemote = isGit && gitStatus!.hasRemote;
  const hasAhead = aheadOfOrigin > 0;
  const hasBehind = behindOfOrigin > 0;
  const buttonKind = resolveButtonKind({ hasChanges, hasRemote, hasAhead, hasBehind, branchName });

  const canPress = useMemo(() => {
    if (isPending) {
      return false;
    }
    if (buttonKind === "sync") {
      return onSync !== undefined && (hasAhead || hasBehind);
    }
    if (buttonKind === "publish") {
      return onPublish !== undefined;
    }
    return hasChanges && message.trim().length > 0;
  }, [buttonKind, hasAhead, hasBehind, hasChanges, isPending, message, onPublish, onSync]);

  const submit = useCallback(() => {
    if (!canPress) {
      return;
    }
    if (buttonKind === "commit") {
      void onCommit(message.trim())
        .then((committed) => {
          if (committed) {
            setMessage("");
          }
          return committed;
        })
        .catch((error) => {
          console.error("提交操作失败且未被上层处理", error);
        });
      return;
    }
    if (buttonKind === "sync" && onSync) {
      onSync();
      return;
    }
    if (buttonKind === "publish" && onPublish) {
      onPublish();
    }
  }, [buttonKind, canPress, message, onCommit, onPublish, onSync]);

  const commitButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) =>
      commitButtonPressableStyle({ hovered, pressed, canPress }),
    [canPress],
  );
  const commitPlaceholder = t("workspace.git.panel.commitPlaceholder", { branch: branchName });
  const handleFocus = useCallback(() => {
    setFocused(true);
  }, []);
  const handleBlur = useCallback(() => {
    setFocused(false);
  }, []);

  let buttonIcon: ReactNode;
  let buttonLabel: string;
  if (isPending) {
    buttonIcon = <ActivityIndicator size="small" color={styles.commitButtonText.color} />;
    buttonLabel = t("workspace.git.panel.committing");
  } else if (buttonKind === "sync") {
    buttonIcon = <ThemedArrowDownUp size={14} uniProps={buttonIconColorMapping} />;
    buttonLabel = t("workspace.git.panel.syncChanges");
  } else if (buttonKind === "publish") {
    buttonIcon = <ThemedCloudUpload size={14} uniProps={buttonIconColorMapping} />;
    buttonLabel = t("workspace.git.panel.publishBranch");
  } else {
    buttonIcon = <Check size={14} color={styles.commitButtonText.color} />;
    buttonLabel = t("workspace.git.panel.commit");
  }

  return (
    <View style={styles.commitComposer} testID="source-control-commit-composer">
      <View style={[styles.commitInputRow, focused && styles.commitInputRowFocused]}>
        <TextInput
          value={message}
          onChangeText={setMessage}
          onSubmitEditing={submit}
          editable={!isPending}
          placeholder={commitPlaceholder}
          placeholderTextColor={styles.commitInputPlaceholder.color}
          returnKeyType="send"
          accessibilityLabel={commitPlaceholder}
          testID="source-control-commit-message"
          style={styles.commitInput}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      </View>
      <View style={styles.commitButtonRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={buttonLabel}
          testID="source-control-commit"
          disabled={!canPress}
          onPress={submit}
          style={commitButtonStyle}
        >
          {buttonIcon}
          <Text style={styles.commitButtonText} numberOfLines={1}>
            {buttonLabel}
          </Text>
          {buttonKind === "sync" ? (
            <Text style={styles.syncCounts} numberOfLines={1}>
              {hasBehind ? `↓${behindOfOrigin}` : ""}
              {hasAhead ? `↑${aheadOfOrigin}` : ""}
            </Text>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const mutedIconColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

const buttonIconColorMapping = (theme: { colors: { scmButtonForeground: string } }) => ({
  color: theme.colors.scmButtonForeground,
});

const styles = StyleSheet.create((theme) => ({
  repositorySection: {
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  sectionHeading: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  repositoryRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  repositoryIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  repositoryName: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  repositoryBranch: {
    maxWidth: "42%",
    minWidth: 0,
  },
  repositoryActions: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  changesHeading: {
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[2],
  },
  changesHeadingTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  changesHeadingTitlePressed: {
    opacity: 0.7,
  },
  headingTwistie: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  count: {
    minWidth: 18,
    minHeight: 18,
    paddingHorizontal: 5,
    textAlign: "center",
    fontSize: 11,
    lineHeight: 11,
    color: theme.colors.scmBadgeForeground,
    backgroundColor: theme.colors.scmBadgeBackground,
    borderRadius: 11,
    overflow: "hidden",
  },
  changesHeadingActions: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-end",
  },
  commitComposer: {
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  commitInputRow: {
    height: 26,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 11,
    marginTop: 4,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 4,
    backgroundColor: theme.colors.scmInputBackground,
  },
  commitInputRowFocused: {
    borderColor: theme.colors.scmFocusBorder,
  },
  commitInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.scmInputForeground,
  },
  commitInputPlaceholder: {
    color: theme.colors.scmInputPlaceholder,
  },
  commitButtonRow: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 11,
    paddingRight: 11,
  },
  commitButton: {
    flex: 1,
    minWidth: 0,
    height: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: theme.colors.scmButtonBackground,
  },
  commitButtonHovered: {
    backgroundColor: theme.colors.scmButtonHoverBackground,
  },
  commitButtonDisabled: {
    opacity: 0.4,
  },
  commitButtonText: {
    color: theme.colors.scmButtonForeground,
    fontSize: 12,
    fontWeight: theme.fontWeight.normal,
  },
  syncCounts: {
    color: theme.colors.scmButtonForeground,
    fontSize: 12,
    opacity: 0.85,
  },
}));
