import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { ChevronDown, Layers } from "lucide-react-native";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { DisclosureChevron } from "@/components/ui/disclosure";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { formatCompletedTurnDuration } from "./completed-turn-process";
import { useTranslation } from "react-i18next";
import type { StreamViewportHandle } from "./strategy";
import { MAX_CHAT_CONTENT_WIDTH } from "@/constants/layout";
import {
  loadNativeHistoryDetails,
  nativeHistoryDetailKey,
  nativeHistoryDetailRevision,
  registerExpandedNativeHistoryDetails,
  useNativeHistoryDetails,
} from "@/timeline/native-history-details";

export function NativeHistoryProcess({
  item,
  client,
  agentId,
  readId,
  expanded,
  onToggle,
  registerAnchor,
  viewport,
  serverId,
  gapAbove,
  gapBelow,
}: {
  item: Extract<StreamItem, { kind: "native_history_process" }>;
  client: DaemonClient | null;
  agentId: string;
  serverId: string;
  readId: string;
  gapAbove: number;
  gapBelow: number;
  expanded: boolean;
  onToggle(input: { turnId: string; itemId: string }): void;
  registerAnchor(input: { turnId: string; node: View }): () => void;
  viewport: React.RefObject<StreamViewportHandle | null>;
}) {
  const { t } = useTranslation();
  const [localError, setLocalError] = useState<string | null>(null);
  const anchorRef = useCallback(
    (node: View | null) => {
      if (node) return registerAnchor({ turnId: item.turnId, node });
    },
    [item.turnId, registerAnchor],
  );
  const key = nativeHistoryDetailKey(serverId, agentId, readId, item.turnId);
  useEffect(() => {
    if (expanded) return registerExpandedNativeHistoryDetails(key);
  }, [expanded, key]);
  const cached = useNativeHistoryDetails((state) => state.entries.get(key));
  const details = cached?.revision === nativeHistoryDetailRevision(item) ? cached : undefined;
  const loading = details?.loading === true;
  const error = localError ?? details?.error ?? null;
  const complete = details?.complete === true;
  const load = useCallback(async () => {
    setLocalError(null);
    if (!client) {
      setLocalError("主机已断开，请连接后重试。");
      return;
    }
    try {
      await loadNativeHistoryDetails({
        serverId,
        agentId,
        readId,
        item,
        client,
        isCurrent: () => {
          const session = useSessionStore.getState().sessions[serverId];
          return (
            session?.client === client &&
            session.agentNativeHistory.get(agentId)?.readId === readId &&
            !session.releasedAgentIds.has(agentId) &&
            (session.agentStreamTail.get(agentId) ?? []).some(
              (entry) =>
                entry.kind === "native_history_process" &&
                entry.turnId === item.turnId &&
                nativeHistoryDetailRevision(entry) === nativeHistoryDetailRevision(item),
            )
          );
        },
        prepare: () => viewport.current?.prepareForHistoryPrepend?.(),
        settle: () => new Promise((resolve) => setTimeout(resolve, 32)),
      });
    } catch (failure) {
      console.error("原生处理过程读取失败", failure);
    }
  }, [client, serverId, agentId, readId, item, viewport]);
  const toggle = useCallback(() => {
    onToggle({ turnId: item.turnId, itemId: item.id });
    if (!expanded && !complete) void load();
  }, [expanded, item.id, item.turnId, complete, load, onToggle]);
  const duration = item.durationMs === null ? null : formatCompletedTurnDuration(item.durationMs);
  const label =
    duration === null
      ? t("agentStream.completedTurn.processed")
      : t("agentStream.completedTurn.processedFor", { duration });
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const rootStyle = useMemo(
    () => [styles.root, { paddingTop: gapAbove, marginBottom: gapBelow }],
    [gapAbove, gapBelow],
  );
  const loadMore = useCallback(() => {
    void load();
  }, [load]);
  if (item.status === "inProgress") return null;
  return (
    <View testID={`native-process-${item.turnId}`} style={rootStyle}>
      <View style={styles.process}>
        <Pressable
          ref={anchorRef}
          onPress={toggle}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          aria-expanded={expanded}
          style={styles.toggle}
        >
          <ThemedLayers size={16} aria-hidden uniProps={processIconColor} />
          <Text style={styles.label}>{label}</Text>
          <DisclosureChevron expanded={expanded} collapsedRotation={-90} expandedRotation={0}>
            <ThemedChevron size={12} uniProps={processIconColor} />
          </DisclosureChevron>
        </Pressable>
        {item.error !== null && (
          <Alert variant="error" title="本轮处理未完成" description={item.error} />
        )}
        {expanded && (
          <View>
            {error && <Alert variant="error" title="加载处理过程失败" description={error} />}
            {(!complete || error !== null) && (
              <Button variant="ghost" loading={loading} disabled={loading} onPress={loadMore}>
                {" "}
                {error ? "重试加载过程" : "正在加载处理过程"}{" "}
              </Button>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    width: "100%",
    maxWidth: MAX_CHAT_CONTENT_WIDTH,
    alignSelf: "center",
  },
  process: {
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base, lineHeight: 22 },
}));

const ThemedChevron = withUnistyles(ChevronDown);
const ThemedLayers = withUnistyles(Layers);
const processIconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
