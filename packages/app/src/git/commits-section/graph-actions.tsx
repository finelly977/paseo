import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { ArrowDownUp, CloudDownload, Download, RefreshCcw, Upload } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/contexts/toast-context";
import type { GitAction, GitActionId, GitActions } from "@/git/policy";

interface GraphActionsProps {
  gitActions: GitActions;
  fetchSupported: boolean;
  hasRemote: boolean;
  isFetching: boolean;
  onFetch: () => void;
  refreshSupported: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}

type GraphActionKind = "fetch" | "refresh" | "pull" | "push" | "sync";

interface GraphActionButtonProps {
  kind: GraphActionKind;
  label: string;
  action?: GitAction;
  pending?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedCloudDownload = withUnistyles(CloudDownload);
const ThemedRefreshCcw = withUnistyles(RefreshCcw);
const ThemedDownload = withUnistyles(Download);
const ThemedUpload = withUnistyles(Upload);
const ThemedArrowDownUp = withUnistyles(ArrowDownUp);

const iconColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

function GraphActionIcon({ kind }: { kind: GraphActionKind }) {
  switch (kind) {
    case "fetch":
      return <ThemedCloudDownload size={14} uniProps={iconColorMapping} />;
    case "refresh":
      return <ThemedRefreshCcw size={14} uniProps={iconColorMapping} />;
    case "pull":
      return <ThemedDownload size={14} uniProps={iconColorMapping} />;
    case "push":
      return <ThemedUpload size={14} uniProps={iconColorMapping} />;
    case "sync":
      return <ThemedArrowDownUp size={14} uniProps={iconColorMapping} />;
  }
}

function GraphActionButton({
  kind,
  label,
  action,
  pending = false,
  disabled = false,
  onPress,
}: GraphActionButtonProps) {
  const toast = useToast();
  const resolvedPending = action ? action.status === "pending" : pending;
  const resolvedDisabled = action ? action.disabled : disabled;
  const unavailableMessage = action ? action.unavailableMessage : undefined;
  const accessibilityState = useMemo(
    () => ({ disabled: resolvedPending || resolvedDisabled }),
    [resolvedDisabled, resolvedPending],
  );
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      (Boolean(hovered) || pressed) && styles.buttonActive,
      resolvedDisabled && styles.buttonDisabled,
    ],
    [resolvedDisabled],
  );
  const handlePress = useCallback(() => {
    if (resolvedPending || resolvedDisabled) {
      return;
    }
    if (unavailableMessage) {
      toast.show(unavailableMessage, { durationMs: 3200 });
      return;
    }
    if (action) {
      action.handler();
      return;
    }
    onPress?.();
  }, [action, onPress, resolvedDisabled, resolvedPending, toast, unavailableMessage]);

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={accessibilityState}
          onPress={handlePress}
          style={pressableStyle}
          testID={`git-graph-action-${label.toLowerCase()}`}
        >
          {resolvedPending ? (
            <ThemedActivityIndicator size="small" uniProps={iconColorMapping} />
          ) : (
            <GraphActionIcon kind={kind} />
          )}
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" offset={6} maxWidth={300}>
        <View style={styles.tooltipContent}>
          <Text style={styles.tooltipLabel}>{label}</Text>
          {unavailableMessage ? (
            <Text style={styles.tooltipDescription}>{unavailableMessage}</Text>
          ) : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

function findAction(gitActions: GitActions, id: GitActionId): GitAction | undefined {
  return [
    ...(gitActions.primary ? [gitActions.primary] : []),
    ...gitActions.secondary,
    ...gitActions.menu,
  ].find((action) => action.id === id);
}

export function GraphActions({
  gitActions,
  fetchSupported,
  hasRemote,
  isFetching,
  onFetch,
  refreshSupported,
  isRefreshing,
  onRefresh,
}: GraphActionsProps) {
  const pull = useMemo(() => findAction(gitActions, "pull"), [gitActions]);
  const push = useMemo(() => findAction(gitActions, "push"), [gitActions]);
  const sync = useMemo(() => findAction(gitActions, "pull-and-push"), [gitActions]);

  return (
    <View style={styles.container}>
      {fetchSupported ? (
        <GraphActionButton
          kind="fetch"
          label="Fetch"
          pending={isFetching}
          disabled={!hasRemote || isFetching}
          onPress={onFetch}
        />
      ) : null}
      {refreshSupported ? (
        <GraphActionButton
          kind="refresh"
          label="Refresh"
          pending={isRefreshing}
          disabled={isRefreshing}
          onPress={onRefresh}
        />
      ) : null}
      {pull ? <GraphActionButton kind="pull" label="Pull" action={pull} /> : null}
      {push ? <GraphActionButton kind="push" label="Push" action={push} /> : null}
      {sync ? <GraphActionButton kind="sync" label="Sync" action={sync} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: "auto",
  },
  button: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
  },
  buttonActive: {
    backgroundColor: theme.colors.surface2,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  tooltipContent: {
    gap: theme.spacing[1],
  },
  tooltipLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.popoverForeground,
    fontWeight: theme.fontWeight.medium,
  },
  tooltipDescription: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));
