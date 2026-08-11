import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import { Portal } from "@gorhom/portal";
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AgentStreamView } from "@/agent-stream/view";
import { DEFAULT_FLOATING_PANEL_PORTAL_HOST } from "@/components/ui/floating-panel-portal";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { isWeb } from "@/constants/platform";
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

const DEFAULT_PANEL_WIDTH = 560;
const DEFAULT_PANEL_HEIGHT = 520;
const MIN_PANEL_WIDTH = 360;
const MIN_PANEL_HEIGHT = 260;
const COLLAPSED_PANEL_HEIGHT = 34;
const PANEL_MARGIN = 12;

const webMoveCursorStyle = isWeb ? ({ cursor: "move" } as object) : null;
const webNwseResizeCursorStyle = isWeb ? ({ cursor: "nwse-resize" } as object) : null;
const webNeswResizeCursorStyle = isWeb ? ({ cursor: "nesw-resize" } as object) : null;

function clampPanelValue(value: number, minimum: number, maximum: number): number {
  "worklet";
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

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

function ResizeCorner({
  accessibilityLabel,
  gesture,
  position,
}: {
  accessibilityLabel: string;
  gesture: GestureType;
  position: "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
}) {
  const style = useMemo(
    () => [
      styles.resizeCorner,
      styles[position],
      position === "topLeft" || position === "bottomRight"
        ? webNwseResizeCursorStyle
        : webNeswResizeCursorStyle,
    ],
    [position],
  );
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        collapsable={false}
        style={style}
      />
    </GestureDetector>
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
  const hostWidth = useSharedValue(0);
  const hostHeight = useSharedValue(0);
  const panelX = useSharedValue(0);
  const panelY = useSharedValue(0);
  const panelWidth = useSharedValue(DEFAULT_PANEL_WIDTH);
  const panelHeight = useSharedValue(DEFAULT_PANEL_HEIGHT);
  const gestureStartX = useSharedValue(0);
  const gestureStartY = useSharedValue(0);
  const gestureStartWidth = useSharedValue(DEFAULT_PANEL_WIDTH);
  const gestureStartHeight = useSharedValue(DEFAULT_PANEL_HEIGHT);
  const hasMeasuredHostRef = useRef(false);
  const wasCollapsedRef = useRef(review.collapsed);

  const handleHostLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width: nextHostWidth, height: nextHostHeight } = event.nativeEvent.layout;
      const maxWidth = Math.max(0, nextHostWidth - PANEL_MARGIN * 2);
      const maxHeight = Math.max(0, nextHostHeight - PANEL_MARGIN * 2);
      const minimumWidth = Math.min(MIN_PANEL_WIDTH, maxWidth);
      const minimumHeight = Math.min(MIN_PANEL_HEIGHT, maxHeight);

      hostWidth.value = nextHostWidth;
      hostHeight.value = nextHostHeight;

      if (!hasMeasuredHostRef.current) {
        hasMeasuredHostRef.current = true;
        panelWidth.value = Math.max(minimumWidth, Math.min(DEFAULT_PANEL_WIDTH, maxWidth));
        panelHeight.value = Math.max(minimumHeight, Math.min(DEFAULT_PANEL_HEIGHT, maxHeight));
        panelX.value = Math.max(PANEL_MARGIN, nextHostWidth - panelWidth.value - PANEL_MARGIN);
        const renderedHeight = review.collapsed ? COLLAPSED_PANEL_HEIGHT : panelHeight.value;
        panelY.value = Math.max(PANEL_MARGIN, nextHostHeight - renderedHeight - PANEL_MARGIN);
        return;
      }

      panelWidth.value = clampPanelValue(panelWidth.value, minimumWidth, maxWidth);
      panelHeight.value = clampPanelValue(panelHeight.value, minimumHeight, maxHeight);
      const renderedHeight = review.collapsed ? COLLAPSED_PANEL_HEIGHT : panelHeight.value;
      panelX.value = clampPanelValue(
        panelX.value,
        PANEL_MARGIN,
        nextHostWidth - panelWidth.value - PANEL_MARGIN,
      );
      panelY.value = clampPanelValue(
        panelY.value,
        PANEL_MARGIN,
        nextHostHeight - renderedHeight - PANEL_MARGIN,
      );
    },
    [hostHeight, hostWidth, panelHeight, panelWidth, panelX, panelY, review.collapsed],
  );

  useEffect(() => {
    if (wasCollapsedRef.current === review.collapsed || hostHeight.value === 0) {
      return;
    }
    if (review.collapsed) {
      panelY.value = clampPanelValue(
        panelY.value + panelHeight.value - COLLAPSED_PANEL_HEIGHT,
        PANEL_MARGIN,
        hostHeight.value - COLLAPSED_PANEL_HEIGHT - PANEL_MARGIN,
      );
    } else {
      panelY.value = clampPanelValue(
        panelY.value + COLLAPSED_PANEL_HEIGHT - panelHeight.value,
        PANEL_MARGIN,
        hostHeight.value - panelHeight.value - PANEL_MARGIN,
      );
    }
    wasCollapsedRef.current = review.collapsed;
  }, [hostHeight, panelHeight, panelY, review.collapsed]);

  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(4)
        .onBegin(() => {
          gestureStartX.value = panelX.value;
          gestureStartY.value = panelY.value;
        })
        .onUpdate((event) => {
          const renderedHeight = review.collapsed ? COLLAPSED_PANEL_HEIGHT : panelHeight.value;
          panelX.value = clampPanelValue(
            gestureStartX.value + event.translationX,
            PANEL_MARGIN,
            hostWidth.value - panelWidth.value - PANEL_MARGIN,
          );
          panelY.value = clampPanelValue(
            gestureStartY.value + event.translationY,
            PANEL_MARGIN,
            hostHeight.value - renderedHeight - PANEL_MARGIN,
          );
        }),
    [
      gestureStartX,
      gestureStartY,
      hostHeight,
      hostWidth,
      panelHeight,
      panelWidth,
      panelX,
      panelY,
      review.collapsed,
    ],
  );

  const resizeGestures = useMemo(() => {
    const createResizeGesture = (horizontal: "left" | "right", vertical: "top" | "bottom") =>
      Gesture.Pan()
        .onBegin(() => {
          gestureStartX.value = panelX.value;
          gestureStartY.value = panelY.value;
          gestureStartWidth.value = panelWidth.value;
          gestureStartHeight.value = panelHeight.value;
        })
        .onUpdate((event) => {
          if (horizontal === "left") {
            const rightEdge = gestureStartX.value + gestureStartWidth.value;
            const maxWidth = rightEdge - PANEL_MARGIN;
            const minimumWidth = Math.min(MIN_PANEL_WIDTH, maxWidth);
            panelWidth.value = clampPanelValue(
              gestureStartWidth.value - event.translationX,
              minimumWidth,
              maxWidth,
            );
            panelX.value = rightEdge - panelWidth.value;
          } else {
            const maxWidth = hostWidth.value - gestureStartX.value - PANEL_MARGIN;
            const minimumWidth = Math.min(MIN_PANEL_WIDTH, maxWidth);
            panelWidth.value = clampPanelValue(
              gestureStartWidth.value + event.translationX,
              minimumWidth,
              maxWidth,
            );
          }

          if (vertical === "top") {
            const bottomEdge = gestureStartY.value + gestureStartHeight.value;
            const maxHeight = bottomEdge - PANEL_MARGIN;
            const minimumHeight = Math.min(MIN_PANEL_HEIGHT, maxHeight);
            panelHeight.value = clampPanelValue(
              gestureStartHeight.value - event.translationY,
              minimumHeight,
              maxHeight,
            );
            panelY.value = bottomEdge - panelHeight.value;
          } else {
            const maxHeight = hostHeight.value - gestureStartY.value - PANEL_MARGIN;
            const minimumHeight = Math.min(MIN_PANEL_HEIGHT, maxHeight);
            panelHeight.value = clampPanelValue(
              gestureStartHeight.value + event.translationY,
              minimumHeight,
              maxHeight,
            );
          }
        });

    return {
      topLeft: createResizeGesture("left", "top"),
      topRight: createResizeGesture("right", "top"),
      bottomLeft: createResizeGesture("left", "bottom"),
      bottomRight: createResizeGesture("right", "bottom"),
    };
  }, [
    gestureStartHeight,
    gestureStartWidth,
    gestureStartX,
    gestureStartY,
    hostHeight,
    hostWidth,
    panelHeight,
    panelWidth,
    panelX,
    panelY,
  ]);

  const panelAnimatedStyle = useAnimatedStyle(
    () => ({
      width: panelWidth.value,
      height: review.collapsed ? COLLAPSED_PANEL_HEIGHT : panelHeight.value,
      opacity: hostWidth.value > 0 && hostHeight.value > 0 ? 1 : 0,
      transform: [{ translateX: panelX.value }, { translateY: panelY.value }],
    }),
    [review.collapsed],
  );
  const handleClose = useCallback(() => {
    void onClose().catch((error) => {
      console.error("[Git AI] 关闭提交审查窗口失败", error);
    });
  }, [onClose]);

  return (
    <Portal hostName={DEFAULT_FLOATING_PANEL_PORTAL_HOST}>
      <View pointerEvents="box-none" style={styles.portalOverlay} onLayout={handleHostLayout}>
        <Animated.View
          accessibilityLabel={t("workspace.git.ai.review.title", { sha: review.sha.slice(0, 8) })}
          style={[styles.panel, panelAnimatedStyle]}
          testID="git-commit-review-pane"
        >
          <GestureDetector gesture={dragGesture}>
            <View style={[styles.header, webMoveCursorStyle]}>
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
                <ThemedX size={14} uniProps={mutedIconMapping} />
              </Pressable>
            </View>
          </GestureDetector>

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
          {review.collapsed ? null : (
            <>
              <ResizeCorner
                accessibilityLabel={t("workspace.git.ai.review.resize")}
                gesture={resizeGestures.topLeft}
                position="topLeft"
              />
              <ResizeCorner
                accessibilityLabel={t("workspace.git.ai.review.resize")}
                gesture={resizeGestures.topRight}
                position="topRight"
              />
              <ResizeCorner
                accessibilityLabel={t("workspace.git.ai.review.resize")}
                gesture={resizeGestures.bottomLeft}
                position="bottomLeft"
              />
              <ResizeCorner
                accessibilityLabel={t("workspace.git.ai.review.resize")}
                gesture={resizeGestures.bottomRight}
                position="bottomRight"
              />
            </>
          )}
        </Animated.View>
      </View>
    </Portal>
  );
}

const styles = StyleSheet.create((theme) => ({
  portalOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  panel: {
    position: "absolute",
    top: 0,
    left: 0,
    overflow: "hidden",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: 8,
    backgroundColor: theme.colors.surface1,
    ...theme.shadow.sm,
  },
  header: {
    height: COLLAPSED_PANEL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    flexShrink: 0,
  },
  headerToggle: {
    flex: 1,
    minWidth: 0,
    height: COLLAPSED_PANEL_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  closeButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
  },
  headerButtonActive: {
    backgroundColor: theme.colors.surface3,
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
    position: "relative",
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
  resizeCorner: {
    position: "absolute",
    width: 14,
    height: 14,
    zIndex: 2,
  },
  topLeft: {
    top: 0,
    left: 0,
  },
  topRight: {
    top: 0,
    right: 0,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
  },
  bottomRight: {
    right: 0,
    bottom: 0,
  },
}));
