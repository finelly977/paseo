import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AgentStreamView } from "@/agent-stream/view";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { PendingPermission } from "@/types/shared";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import type { GitCommitReviewState } from "@/git/use-git-ai";
import type { Theme } from "@/styles/theme";

const ThemedAlertCircle = withUnistyles(AlertCircle);
const ThemedCheckCircle = withUnistyles(CheckCircle2);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedX = withUnistyles(X);

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const successIconMapping = (theme: Theme) => ({ color: theme.colors.statusSuccess });
const dangerIconMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });

function closeButtonStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.closeButton, (Boolean(hovered) || pressed) && styles.headerButtonActive];
}

function ReviewStatus({ status }: { status: GitCommitReviewState["status"] }) {
  const { t } = useTranslation();
  if (status === "starting" || status === "running" || status === "closing") {
    return (
      <View style={styles.status}>
        <LoadingSpinner size={12} color={styles.statusText.color} />
        <Text style={styles.statusText}>{t(`workspace.git.ai.review.status.${status}`)}</Text>
      </View>
    );
  }
  if (status === "completed") {
    return (
      <View style={styles.status}>
        <ThemedCheckCircle size={12} uniProps={successIconMapping} />
        <Text style={styles.statusText}>{t("workspace.git.ai.review.status.completed")}</Text>
      </View>
    );
  }
  return (
    <View style={styles.status}>
      <ThemedAlertCircle size={12} uniProps={dangerIconMapping} />
      <Text style={styles.statusText}>{t("workspace.git.ai.review.status.failed")}</Text>
    </View>
  );
}

function ReviewBodyContent({
  review,
  serverId,
  pendingPermissions,
  onOpenWorkspaceFile,
}: {
  review: GitCommitReviewState;
  serverId: string;
  pendingPermissions: Map<string, PendingPermission>;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  if (review.agent) {
    return (
      <AgentStreamView
        agentId={review.agent.id}
        serverId={serverId}
        context={review.agent}
        streamItems={review.streamItems}
        streamHead={review.streamHead}
        pendingPermissions={pendingPermissions}
        isAuthoritativeHistoryReady
        onOpenWorkspaceFile={onOpenWorkspaceFile}
        readOnly
      />
    );
  }
  if (review.status === "failed") {
    return (
      <View style={styles.loading}>
        <Text style={styles.errorText}>{t("workspace.git.ai.review.startFailed")}</Text>
      </View>
    );
  }
  const label =
    review.status === "closing"
      ? t("workspace.git.ai.review.status.closing")
      : t("workspace.git.ai.review.starting");
  return (
    <View style={styles.loading}>
      <LoadingSpinner size="small" color={styles.loadingText.color} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export function CommitReviewPane({
  review,
  serverId,
  pendingPermissions,
  onToggleCollapsed,
  onClose,
  onOpenWorkspaceFile,
}: {
  review: GitCommitReviewState;
  serverId: string;
  pendingPermissions: Map<string, PendingPermission>;
  onToggleCollapsed: () => void;
  onClose: () => Promise<void>;
  onOpenWorkspaceFile?: (request: WorkspaceFileOpenRequest) => void;
}) {
  const { t } = useTranslation();
  const closeDisabled = review.status === "closing";
  const panelStyle = useMemo(
    () => [styles.panel, review.collapsed && styles.panelCollapsed],
    [review.collapsed],
  );
  const handleClose = useCallback(() => {
    void onClose().catch((error) => {
      console.error("[Git AI] 关闭提交审查窗口失败", error);
    });
  }, [onClose]);

  return (
    <View style={panelStyle} testID="git-commit-review-pane">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            review.collapsed
              ? t("workspace.git.ai.review.expand")
              : t("workspace.git.ai.review.collapse")
          }
          onPress={onToggleCollapsed}
          style={styles.headerToggle}
          testID="git-commit-review-toggle"
        >
          {review.collapsed ? (
            <ThemedChevronRight size={14} uniProps={mutedIconMapping} />
          ) : (
            <ThemedChevronDown size={14} uniProps={mutedIconMapping} />
          )}
          <Text style={styles.title} numberOfLines={1}>
            {t("workspace.git.ai.review.title", { sha: review.sha.slice(0, 8) })}
          </Text>
          <ReviewStatus status={review.status} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.git.ai.review.close")}
          disabled={closeDisabled}
          onPress={handleClose}
          style={closeButtonStyle}
          testID="git-commit-review-close"
        >
          <ThemedX size={13} uniProps={mutedIconMapping} />
        </Pressable>
      </View>

      {review.collapsed ? null : (
        <View style={styles.body}>
          {review.error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{review.error}</Text>
            </View>
          ) : null}
          <ReviewBodyContent
            review={review}
            serverId={serverId}
            pendingPermissions={pendingPermissions}
            onOpenWorkspaceFile={onOpenWorkspaceFile}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    height: 280,
    minHeight: 120,
    maxHeight: "48%",
    flexShrink: 1,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  panelCollapsed: {
    height: 22,
    minHeight: 22,
    maxHeight: 22,
    flexShrink: 0,
  },
  header: {
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[1],
    paddingRight: theme.spacing[1],
    flexShrink: 0,
  },
  headerToggle: {
    flex: 1,
    minWidth: 0,
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  closeButton: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
  },
  headerButtonActive: {
    backgroundColor: theme.colors.surface2,
  },
  title: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: 13,
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  errorBanner: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.xs,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  loadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
