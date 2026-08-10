import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AGENT_LIFECYCLE_STATUSES,
  type AgentLifecycleStatus,
} from "@getpaseo/protocol/agent-lifecycle";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";

export function AgentStatusDot({
  status,
  requiresAttention,
  attentionReason,
  pendingPermissionCount,
  showInactive = false,
}: {
  status: string | null | undefined;
  requiresAttention: boolean | null | undefined;
  attentionReason?: "finished" | "error" | "permission" | null;
  pendingPermissionCount?: number;
  showInactive?: boolean;
}) {
  if (!status) {
    return null;
  }
  if (!isAgentLifecycleStatus(status)) {
    return null;
  }

  const bucket = deriveSidebarStateBucket({
    status,
    requiresAttention: Boolean(requiresAttention),
    attentionReason: attentionReason ?? null,
    pendingPermissionCount: pendingPermissionCount ?? 0,
  });
  const colorStyle = getStatusDotColorStyle(bucket, showInactive);

  if (!colorStyle) {
    return null;
  }

  return <View style={[styles.dot, colorStyle]} />;
}

function isAgentLifecycleStatus(value: string): value is AgentLifecycleStatus {
  return AGENT_LIFECYCLE_STATUSES.some((status) => status === value);
}

function getStatusDotColorStyle(
  bucket: ReturnType<typeof deriveSidebarStateBucket>,
  showInactive: boolean,
) {
  if (bucket === "needs_input") return styles.dotNeedsInput;
  if (bucket === "failed") return styles.dotFailed;
  if (bucket === "running") return styles.dotRunning;
  if (bucket === "attention") return styles.dotAttention;
  if (bucket === "done" && showInactive) return styles.dotInactive;
  return null;
}

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
  dotNeedsInput: {
    backgroundColor: theme.colors.palette.amber[500],
  },
  dotFailed: {
    backgroundColor: theme.colors.palette.red[500],
  },
  dotRunning: {
    backgroundColor: theme.colors.palette.blue[500],
  },
  dotAttention: {
    backgroundColor: theme.colors.palette.green[500],
  },
  dotInactive: {
    backgroundColor: theme.colors.border,
  },
}));
