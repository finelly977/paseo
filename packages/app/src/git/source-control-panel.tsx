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
  RotateCw,
  Sparkles,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedArrowDownUp = withUnistyles(ArrowDownUp);
const ThemedCloudUpload = withUnistyles(CloudUpload);
const ThemedCheck = withUnistyles(Check);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedSparkles = withUnistyles(Sparkles);

export interface SourceControlRepositoryHeaderProps {
  repositoryName: string;
  gitActions: GitActions;
  isRefreshing: boolean;
  refreshSupported: boolean;
  onRefresh: () => void;
  children: ReactNode;
}

export function SourceControlRepositoryHeader({
  repositoryName,
  gitActions,
  isRefreshing,
  refreshSupported,
  onRefresh,
  children,
}: SourceControlRepositoryHeaderProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.repositorySection} testID="source-control-repository">
      <View style={styles.repositoryRow}>
        <View style={styles.repositoryIdentity}>
          <ThemedGitBranch size={14} uniProps={mutedIconColorMapping} />
          <Text style={styles.repositoryName} numberOfLines={1}>
            {repositoryName}
          </Text>
        </View>
        <View style={styles.repositoryBranch}>{children}</View>
        {refreshSupported ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workspace.git.diff.refresh")}
            disabled={isRefreshing}
            onPress={onRefresh}
            style={repositoryRefreshActionStyle}
            testID="source-control-refresh"
          >
            {isRefreshing ? (
              <ThemedActivityIndicator size={12} uniProps={mutedIconColorMapping} />
            ) : (
              <ThemedRotateCw size={14} uniProps={mutedIconColorMapping} />
            )}
          </Pressable>
        ) : null}
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

function repositoryRefreshActionStyle({
  hovered = false,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.repositoryRefreshAction,
    (Boolean(hovered) || pressed) && styles.repositoryRefreshActionActive,
  ];
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
  onGenerateMessage?: (() => Promise<string>) | undefined;
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
  ];
}

function resolveCommitCanPress(input: {
  isPending: boolean;
  isGenerating: boolean;
  buttonKind: CommitButtonKind;
  hasAhead: boolean;
  hasBehind: boolean;
  hasChanges: boolean;
  hasMessage: boolean;
  canSync: boolean;
  canPublish: boolean;
}): boolean {
  if (input.isPending || input.isGenerating) {
    return false;
  }
  if (input.buttonKind === "sync") {
    return input.canSync && (input.hasAhead || input.hasBehind);
  }
  if (input.buttonKind === "publish") {
    return input.canPublish;
  }
  return input.hasChanges && input.hasMessage;
}

function resolveCommitButtonLabel(input: {
  isPending: boolean;
  buttonKind: CommitButtonKind;
  t: TFunction;
}): string {
  if (input.isPending) {
    return input.t("workspace.git.panel.committing");
  }
  if (input.buttonKind === "sync") {
    return input.t("workspace.git.panel.syncChanges");
  }
  if (input.buttonKind === "publish") {
    return input.t("workspace.git.panel.publishBranch");
  }
  return input.t("workspace.git.panel.commit");
}

function CommitButtonIcon({
  isPending,
  buttonKind,
}: {
  isPending: boolean;
  buttonKind: CommitButtonKind;
}) {
  if (isPending) {
    return <ThemedActivityIndicator size={12} uniProps={buttonIconColorMapping} />;
  }
  if (buttonKind === "sync") {
    return <ThemedArrowDownUp size={14} uniProps={buttonIconColorMapping} />;
  }
  if (buttonKind === "publish") {
    return <ThemedCloudUpload size={14} uniProps={buttonIconColorMapping} />;
  }
  return <ThemedCheck size={14} uniProps={buttonIconColorMapping} />;
}

function CommitMessageAiButton({
  available,
  canGenerate,
  isGenerating,
  label,
  onPress,
}: {
  available: boolean;
  canGenerate: boolean;
  isGenerating: boolean;
  label: string;
  onPress: () => void;
}) {
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.commitAiButton,
      !canGenerate && styles.commitAiButtonDisabled,
      canGenerate && (Boolean(hovered) || pressed) && styles.commitAiButtonActive,
    ],
    [canGenerate],
  );
  if (!available) {
    return null;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={!canGenerate}
      hitSlop={4}
      onPress={onPress}
      style={buttonStyle}
      testID="source-control-generate-commit-message"
    >
      {isGenerating ? (
        <ThemedActivityIndicator size={12} uniProps={mutedIconColorMapping} />
      ) : (
        <ThemedSparkles size={14} uniProps={mutedIconColorMapping} />
      )}
    </Pressable>
  );
}

function useCommitMessageGeneration({
  onGenerateMessage,
  hasChanges,
  disabled,
  failedMessage,
  onGenerated,
}: {
  onGenerateMessage: (() => Promise<string>) | undefined;
  hasChanges: boolean;
  disabled: boolean;
  failedMessage: string;
  onGenerated: (message: string) => void;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canGenerate = Boolean(onGenerateMessage && hasChanges && !disabled && !isGenerating);
  const clearError = useCallback(() => setError(null), []);
  const generate = useCallback(() => {
    if (!onGenerateMessage || !hasChanges || disabled || isGenerating) {
      return;
    }
    setIsGenerating(true);
    setError(null);
    void onGenerateMessage()
      .then((generated) => {
        onGenerated(generated);
        return generated;
      })
      .catch((generationError) => {
        console.error("[Git AI] 生成提交说明失败", generationError);
        setError(generationError instanceof Error ? generationError.message : failedMessage);
      })
      .finally(() => setIsGenerating(false));
  }, [disabled, failedMessage, hasChanges, isGenerating, onGenerateMessage, onGenerated]);
  return {
    available: onGenerateMessage !== undefined,
    canGenerate,
    clearError,
    error,
    generate,
    isGenerating,
  };
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
  onGenerateMessage,
}: SourceControlCommitComposerProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const [focused, setFocused] = useState(false);
  const [inputHeight, setInputHeight] = useState(26);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [historyDraft, setHistoryDraft] = useState("");
  const isPending = status === "pending";
  const handleGeneratedMessage = useCallback((generated: string) => {
    setMessage(generated);
    setHistoryIndex(null);
    setHistoryDraft("");
  }, []);
  const generation = useCommitMessageGeneration({
    onGenerateMessage,
    hasChanges,
    disabled: isPending,
    failedMessage: t("workspace.git.ai.commitMessage.failed"),
    onGenerated: handleGeneratedMessage,
  });
  const clearGenerationError = generation.clearError;
  const isGit = gitStatus?.isGit === true;
  const aheadOfOrigin = isGit ? (gitStatus.aheadOfOrigin ?? 0) : 0;
  const behindOfOrigin = isGit ? (gitStatus.behindOfOrigin ?? 0) : 0;
  const hasRemote = isGit && gitStatus.hasRemote;
  const hasAhead = aheadOfOrigin > 0;
  const hasBehind = behindOfOrigin > 0;
  const hasMessage = message.trim().length > 0;
  const buttonKind = resolveButtonKind({ hasChanges, hasRemote, hasAhead, hasBehind, branchName });

  const canPress = resolveCommitCanPress({
    isPending,
    isGenerating: generation.isGenerating,
    buttonKind,
    hasAhead,
    hasBehind,
    hasChanges,
    hasMessage,
    canSync: onSync !== undefined,
    canPublish: onPublish !== undefined,
  });

  const submitCommit = useCallback(
    (addAll: boolean) => {
      if (isPending || generation.isGenerating || !hasChanges || message.trim().length === 0) {
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
    [generation.isGenerating, hasChanges, history, isPending, message, onCommit],
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
  const commitCaretStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.commitCaret,
      canPress && (hovered || pressed || open) && styles.commitButtonHovered,
    ],
    [canPress],
  );
  const commitPlaceholder = t("workspace.git.panel.commitPlaceholder", { branch: branchName });
  const handleFocus = useCallback(() => {
    setFocused(true);
  }, []);
  const handleBlur = useCallback(() => {
    setFocused(false);
  }, []);
  const handleMessageChange = useCallback(
    (value: string) => {
      setMessage(value);
      clearGenerationError();
    },
    [clearGenerationError],
  );
  const buttonLabel = resolveCommitButtonLabel({ isPending, buttonKind, t });

  return (
    <View style={styles.commitComposer} testID="source-control-commit-composer">
      <View
        style={[
          styles.commitInputRow,
          { height: inputHeight },
          focused && styles.commitInputRowFocused,
        ]}
      >
        <TextInput
          value={message}
          onChangeText={handleMessageChange}
          multiline
          scrollEnabled={inputHeight >= 100}
          onContentSizeChange={handleContentSizeChange}
          onKeyPress={handleInputKeyPress}
          editable={!isPending && !generation.isGenerating}
          returnKeyType="default"
          accessibilityLabel={commitPlaceholder}
          testID="source-control-commit-message"
          style={[styles.commitInput, { height: inputHeight }]}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        <CommitMessageAiButton
          available={generation.available}
          canGenerate={generation.canGenerate}
          isGenerating={generation.isGenerating}
          label={t("workspace.git.ai.commitMessage.generate")}
          onPress={generation.generate}
        />
      </View>
      {generation.error ? (
        <Text style={styles.commitGenerationError} testID="source-control-generation-error">
          {generation.error}
        </Text>
      ) : null}
      <View style={styles.commitButtonRow}>
        <View style={[styles.commitSplitButton, !canPress && styles.commitSplitButtonDisabled]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={buttonLabel}
            testID="source-control-commit"
            disabled={!canPress}
            onPress={submit}
            style={commitButtonStyle}
          >
            <CommitButtonIcon isPending={isPending} buttonKind={buttonKind} />
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
                disabled={
                  isPending || generation.isGenerating || !hasMessage || totalChangeCount === 0
                }
                style={commitCaretStyle}
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
    maxWidth: "36%",
    minWidth: 0,
  },
  repositoryRefreshAction: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 3,
    flexShrink: 0,
  },
  repositoryRefreshActionActive: {
    backgroundColor: theme.colors.surface2,
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
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: theme.colors.scmBadgeBackground,
  },
  countText: {
    fontSize: 10,
    lineHeight: 12,
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
    outlineColor: "transparent",
    outlineWidth: 0,
  },
  commitAiButton: {
    width: 22,
    height: 22,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
  },
  commitAiButtonActive: {
    backgroundColor: theme.colors.surface2,
  },
  commitAiButtonDisabled: {
    opacity: theme.opacity[50],
  },
  commitGenerationError: {
    marginHorizontal: 11,
    marginTop: 3,
    color: theme.colors.statusDanger,
    fontSize: 11,
    lineHeight: 15,
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
    backgroundColor: theme.colors.scmButtonBackground,
  },
  commitSplitButtonDisabled: {
    opacity: theme.opacity[50],
  },
  commitButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
    backgroundColor: "transparent",
  },
  commitCaret: {
    width: 26,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.scmButtonHoverBackground,
    backgroundColor: "transparent",
  },
  commitButtonHovered: {
    backgroundColor: theme.colors.scmButtonHoverBackground,
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
