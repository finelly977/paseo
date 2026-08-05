import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type TextInputKeyPressEventData,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedArrowDownUp = withUnistyles(ArrowDownUp);
const ThemedCloudUpload = withUnistyles(CloudUpload);
const ThemedCheck = withUnistyles(Check);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
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
          <ThemedGitBranch size={14} uniProps={mutedIconColorMapping} />
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
          <View style={styles.countBadge} accessibilityLabel={`${title}: ${count}`}>
            <Text style={styles.countText}>{count}</Text>
          </View>
        ) : null}
      </Pressable>
      {children ? <View style={styles.changesHeadingActions}>{children}</View> : null}
    </View>
  );
}

export interface SourceControlCommitComposerProps {
  branchName: string;
  hasChanges: boolean;
  stagedFileCount: number;
  totalChangeCount: number;
  status: CheckoutGitActionStatus;
  /** Full checkout status; used only to derive Sync/Publish button state. */
  gitStatus?: CheckoutStatusResponse["payload"] | null | undefined;
  onCommit: (message: string, addAll: boolean) => Promise<boolean>;
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
  stagedFileCount,
  totalChangeCount,
  status,
  gitStatus,
  onCommit,
  onSync,
  onPublish,
}: SourceControlCommitComposerProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [focused, setFocused] = useState(false);
  const [inputHeight, setInputHeight] = useState(26);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [historyDraft, setHistoryDraft] = useState("");
  const isPending = status === "pending";
  const isGit = gitStatus?.isGit === true;
  const aheadOfOrigin = isGit ? (gitStatus.aheadOfOrigin ?? 0) : 0;
  const behindOfOrigin = isGit ? (gitStatus.behindOfOrigin ?? 0) : 0;
  const hasRemote = isGit && gitStatus.hasRemote;
  const hasAhead = aheadOfOrigin > 0;
  const hasBehind = behindOfOrigin > 0;
  const hasMessage = message.trim().length > 0;
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
    return hasChanges && hasMessage;
  }, [buttonKind, hasAhead, hasBehind, hasChanges, hasMessage, isPending, onPublish, onSync]);

  const submitCommit = useCallback(
    (addAll: boolean) => {
      if (isPending || !hasChanges || message.trim().length === 0) {
        return;
      }
      const submittedMessage = message.trim();
      const nextHistory = [
        submittedMessage,
        ...history.filter((entry) => entry !== submittedMessage),
      ].slice(0, 50);
      void onCommit(submittedMessage, addAll)
        .then((committed) => {
          if (committed) {
            setHistory(nextHistory);
            setMessage("");
            setInputHeight(26);
            setHistoryIndex(null);
            setHistoryDraft("");
          }
          return committed;
        })
        .catch((error) => {
          console.error("提交操作失败且未被上层处理", error);
        });
    },
    [hasChanges, history, isPending, message, onCommit],
  );
  const submit = useCallback(() => {
    if (!canPress) {
      return;
    }
    if (buttonKind === "commit") {
      submitCommit(stagedFileCount === 0);
      return;
    }
    if (buttonKind === "sync" && onSync) {
      onSync();
      return;
    }
    if (buttonKind === "publish" && onPublish) {
      onPublish();
    }
  }, [buttonKind, canPress, onPublish, onSync, stagedFileCount, submitCommit]);

  const submitStaged = useCallback(() => submitCommit(false), [submitCommit]);
  const submitAll = useCallback(() => submitCommit(true), [submitCommit]);
  const handleContentSizeChange = useCallback(
    (event: { nativeEvent: { contentSize: { height: number } } }) => {
      setInputHeight(Math.max(26, Math.min(100, Math.ceil(event.nativeEvent.contentSize.height))));
    },
    [],
  );
  const handleInputKeyPress = useCallback(
    (
      event: NativeSyntheticEvent<
        TextInputKeyPressEventData & { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
      >,
    ) => {
      if (event.nativeEvent.altKey === true && event.nativeEvent.key === "ArrowUp") {
        event.preventDefault();
        if (history.length === 0) {
          return;
        }
        const nextIndex =
          historyIndex === null ? 0 : Math.min(historyIndex + 1, history.length - 1);
        if (historyIndex === null) {
          setHistoryDraft(message);
        }
        setHistoryIndex(nextIndex);
        setMessage(history[nextIndex] ?? message);
        return;
      }
      if (event.nativeEvent.altKey === true && event.nativeEvent.key === "ArrowDown") {
        event.preventDefault();
        if (historyIndex === null) {
          return;
        }
        if (historyIndex === 0) {
          setHistoryIndex(null);
          setMessage(historyDraft);
          return;
        }
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        setMessage(history[nextIndex] ?? historyDraft);
        return;
      }
      if (
        event.nativeEvent.key === "Enter" &&
        (event.nativeEvent.ctrlKey === true || event.nativeEvent.metaKey === true)
      ) {
        event.preventDefault();
        submit();
      }
    },
    [history, historyDraft, historyIndex, message, submit],
  );

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
    buttonIcon = <ThemedActivityIndicator size="small" uniProps={buttonIconColorMapping} />;
    buttonLabel = t("workspace.git.panel.committing");
  } else if (buttonKind === "sync") {
    buttonIcon = <ThemedArrowDownUp size={14} uniProps={buttonIconColorMapping} />;
    buttonLabel = t("workspace.git.panel.syncChanges");
  } else if (buttonKind === "publish") {
    buttonIcon = <ThemedCloudUpload size={14} uniProps={buttonIconColorMapping} />;
    buttonLabel = t("workspace.git.panel.publishBranch");
  } else {
    buttonIcon = <ThemedCheck size={14} uniProps={buttonIconColorMapping} />;
    buttonLabel = t("workspace.git.panel.commit");
  }

  return (
    <View style={styles.commitComposer} testID="source-control-commit-composer">
      <View
        style={[
          styles.commitInputRow,
          { minHeight: inputHeight },
          focused && styles.commitInputRowFocused,
        ]}
      >
        <TextInput
          value={message}
          onChangeText={setMessage}
          multiline
          scrollEnabled={inputHeight >= 100}
          onContentSizeChange={handleContentSizeChange}
          onKeyPress={handleInputKeyPress}
          editable={!isPending}
          placeholder={commitPlaceholder}
          placeholderTextColor={styles.commitInputPlaceholder.color}
          returnKeyType="default"
          accessibilityLabel={commitPlaceholder}
          testID="source-control-commit-message"
          style={styles.commitInput}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      </View>
      <View style={styles.commitButtonRow}>
        <View style={styles.commitSplitButton}>
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
          {buttonKind === "commit" ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                accessibilityRole="button"
                accessibilityLabel={t("workspace.git.panel.commitMoreActions")}
                disabled={isPending || !hasMessage || totalChangeCount === 0}
                style={styles.commitCaret}
                testID="source-control-commit-caret"
              >
                <ThemedChevronDown size={14} uniProps={buttonIconColorMapping} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" width={220}>
                <DropdownMenuItem
                  disabled={!hasMessage || stagedFileCount === 0}
                  onSelect={submitStaged}
                >
                  {t("workspace.git.panel.commitStaged")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!hasMessage || totalChangeCount === 0}
                  onSelect={submitAll}
                >
                  {t("workspace.git.panel.commitAll")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </View>
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
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
  repositoryRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
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
  countBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: theme.colors.scmBadgeBackground,
  },
  countText: {
    height: 11,
    fontSize: 11,
    lineHeight: 11,
    textAlign: "center",
    includeFontPadding: false,
    color: theme.colors.scmBadgeForeground,
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
    textAlignVertical: "top",
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
  commitSplitButton: {
    flex: 1,
    minWidth: 0,
    height: 26,
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 4,
    overflow: "hidden",
  },
  commitButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: theme.colors.scmButtonBackground,
  },
  commitCaret: {
    width: 26,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.scmButtonHoverBackground,
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
