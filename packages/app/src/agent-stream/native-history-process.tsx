import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { ChevronDown } from "lucide-react-native";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { DisclosureChevron, DisclosureContent } from "@/components/ui/disclosure";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { formatCompletedTurnDuration } from "./completed-turn-process";
import { useTranslation } from "react-i18next";
import type { StreamViewportHandle } from "./strategy";
import type { StreamLayoutItem } from "./layout";
import { MAX_CHAT_CONTENT_WIDTH } from "@/constants/layout";
import {
  loadNativeHistoryDetails,
  nativeHistoryDetailKey,
  nativeHistoryDetailRevision,
  registerExpandedNativeHistoryDetails,
  useNativeHistoryDetails,
} from "@/timeline/native-history-details";
import {
  hydrateNativeHistoryDetails,
  nativeHistoryInterruptedReply,
} from "@/timeline/native-history-presentation";

export function NativeHistoryProcess({
  item,
  client,
  agentId,
  readId,
  renderItem,
  renderReply,
  viewport,
  layout,
  serverId,
}: {
  item: Extract<StreamItem, { kind: "native_history_process" }>;
  client: DaemonClient | null;
  agentId: string;
  serverId: string;
  readId: string;
  renderItem(item: StreamLayoutItem): ReactNode;
  renderReply(item: StreamLayoutItem): ReactNode;
  layout: StreamLayoutItem;
  viewport: React.RefObject<StreamViewportHandle | null>;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const root = useRef<View>(null);
  const key = nativeHistoryDetailKey(serverId, agentId, readId, item.turnId);
  useEffect(() => {
    if (expanded) return registerExpandedNativeHistoryDetails(key);
  }, [expanded, key]);
  const cached = useNativeHistoryDetails((state) => state.entries.get(key));
  const details = cached?.revision === nativeHistoryDetailRevision(item) ? cached : undefined;
  const loading = details?.loading === true;
  const error = localError ?? details?.error ?? null;
  const complete = details?.complete === true;
  const preview = useMemo(
    () => (complete && details ? nativeHistoryInterruptedReply(item, details.items) : []),
    [complete, details, item],
  );
  const rows = useMemo(() => {
    if (!expanded || !details) return [];
    const visibleIds = new Set([...item.summaryMessageIds, ...preview.map((entry) => entry.id)]);
    return hydrateNativeHistoryDetails(
      item,
      details.items.filter(
        (entry) =>
          !(
            "messageId" in entry &&
            typeof entry.messageId === "string" &&
            visibleIds.has(entry.messageId)
          ),
      ),
    );
  }, [details, expanded, item, preview]);
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
    const change = () => setExpanded((value) => !value);
    const node = root.current;
    if (node && viewport.current)
      viewport.current.preserveScrollAnchor({
        itemId: item.id,
        measure: (callback) => node.measureInWindow((_x, top) => callback(top)),
        applyChange: change,
      });
    else change();
    if (!expanded && !complete) void load();
  }, [expanded, item.id, complete, load, viewport]);
  const duration =
    item.durationMs === null ? null : formatCompletedTurnDuration(item.durationMs, i18n.language);
  let label = "已中断";
  if (item.status === "completed")
    label =
      duration === null
        ? t("agentStream.completedTurn.processed")
        : t("agentStream.completedTurn.processedFor", { duration });
  if (item.status === "inProgress") label = "处理中";
  if (item.status === "failed") label = "处理失败";
  if ((item.status === "interrupted" || item.status === "failed") && duration !== null)
    label += ` · ${duration}`;
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  const renderRow = useCallback(
    ({ item: row }: { item: StreamItem }) => (
      <View>{renderItem({ ...layout, item: row, completedFooter: null, phase: "complete" })}</View>
    ),
    [layout, renderItem],
  );
  const loadMore = useCallback(() => {
    void load();
  }, [load]);
  return (
    <View
      ref={root}
      collapsable={false}
      testID={`native-process-${item.turnId}`}
      style={styles.root}
    >
      <View style={styles.process}>
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          style={styles.toggle}
        >
          <Text style={styles.label}>{label}</Text>
          <DisclosureChevron expanded={expanded} collapsedRotation={-90} expandedRotation={0}>
            <ThemedChevron size={12} uniProps={chevronColor} />
          </DisclosureChevron>
        </Pressable>
        {item.error !== null && (
          <Alert variant="error" title="本轮处理未完成" description={item.error} />
        )}
        <DisclosureContent expanded={expanded}>
          {() => (
            <View>
              {error && <Alert variant="error" title="加载处理过程失败" description={error} />}
              {rows.length > 0 && (
                <FlatList
                  data={rows}
                  keyExtractor={rowKey}
                  renderItem={renderRow}
                  style={styles.details}
                  initialNumToRender={12}
                  maxToRenderPerBatch={12}
                  windowSize={5}
                  nestedScrollEnabled
                />
              )}
              {(!complete || error !== null) && (
                <Button variant="ghost" loading={loading} disabled={loading} onPress={loadMore}>
                  {" "}
                  {error ? "重试加载过程" : "正在加载处理过程"}{" "}
                </Button>
              )}
            </View>
          )}
        </DisclosureContent>
      </View>
      {preview.map((entry) => (
        <View key={entry.id}>
          {renderReply({
            ...layout,
            item: entry,
            assistantSpacing: "default",
            gapAbove: 8,
            gapBelow: 0,
            phase: "complete",
            completedFooter: {
              kind: "partial",
              itemId: entry.id,
              items: [entry],
              startIndex: 0,
              processItemIds: [],
            },
          })}
        </View>
      ))}
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
  details: { height: 400, maxHeight: 480 },
}));

const rowKey = (row: StreamItem, index: number) => `${row.id}:${index}`;
const ThemedChevron = withUnistyles(ChevronDown);
const chevronColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
