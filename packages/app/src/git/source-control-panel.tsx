import { useCallback, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { Check, GitBranch, MessageSquarePlus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { CheckoutGitActionStatus } from "@/git/actions-store";
import type { GitActions } from "@/git/policy";
import { GitActionsSplitButton } from "@/git/actions-split-button";

const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedMessageSquarePlus = withUnistyles(MessageSquarePlus);

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
}

export function SourceControlSectionHeader({
  title,
  count,
  children,
  testID,
}: SourceControlSectionHeaderProps) {
  return (
    <View style={styles.changesHeading} testID={testID}>
      <View style={styles.changesHeadingTitle}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {count !== undefined && count !== null ? (
          <Text style={styles.count} accessibilityLabel={`${title}: ${count}`}>
            {count}
          </Text>
        ) : null}
      </View>
      {children ? <View style={styles.changesHeadingActions}>{children}</View> : null}
    </View>
  );
}

export interface SourceControlCommitComposerProps {
  branchName: string;
  hasChanges: boolean;
  status: CheckoutGitActionStatus;
  onCommit: (message: string) => Promise<boolean>;
}

export function SourceControlCommitComposer({
  branchName,
  hasChanges,
  status,
  onCommit,
}: SourceControlCommitComposerProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const isPending = status === "pending";
  const canCommit = hasChanges && !isPending && message.trim().length > 0;

  const submit = useCallback(() => {
    if (!canCommit) {
      return;
    }
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
  }, [canCommit, message, onCommit]);

  const commitButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.commitButton,
      canCommit && (Boolean(hovered) || pressed) && styles.commitButtonActive,
      !canCommit && styles.commitButtonDisabled,
    ],
    [canCommit],
  );
  const commitPlaceholder = t("workspace.git.panel.commitPlaceholder", { branch: branchName });

  return (
    <View style={styles.commitComposer} testID="source-control-commit-composer">
      <View style={styles.commitInputRow}>
        <ThemedMessageSquarePlus size={16} uniProps={mutedIconColorMapping} />
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
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("workspace.git.panel.commit")}
        testID="source-control-commit"
        disabled={!canCommit}
        onPress={submit}
        style={commitButtonStyle}
      >
        {isPending ? (
          <ActivityIndicator size="small" color={styles.commitButtonText.color} />
        ) : (
          <Check size={15} color={styles.commitButtonText.color} />
        )}
        <Text style={styles.commitButtonText}>
          {isPending ? t("workspace.git.panel.committing") : t("workspace.git.panel.commit")}
        </Text>
      </Pressable>
    </View>
  );
}

const mutedIconColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
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
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
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
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  changesHeadingTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  count: {
    minWidth: 19,
    paddingHorizontal: theme.spacing[1],
    textAlign: "center",
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.full,
    overflow: "hidden",
  },
  changesHeadingActions: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-end",
  },
  commitComposer: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  commitInputRow: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  commitInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  commitInputPlaceholder: {
    color: theme.colors.foregroundMuted,
  },
  commitButton: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.accent,
  },
  commitButtonActive: {
    backgroundColor: theme.colors.accentBright,
  },
  commitButtonDisabled: {
    opacity: 0.45,
  },
  commitButtonText: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
