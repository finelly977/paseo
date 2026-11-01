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
import { hydrateStreamState, type StreamItem } from "@/types/stream";
import { formatCompletedTurnDuration } from "./completed-turn-process";
import { useTranslation } from "react-i18next";
import type { StreamViewportHandle } from "./strategy";
import type { StreamLayoutItem } from "./layout";
import { MAX_CHAT_CONTENT_WIDTH } from "@/constants/layout";

export function NativeHistoryProcess({
  item,
  client,
  agentId,
  readId,
  renderItem,
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
  layout: StreamLayoutItem;
  viewport: React.RefObject<StreamViewportHandle | null>;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<StreamItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<View>(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  const released = useSessionStore(
    (state) => state.sessions[serverId]?.releasedAgentIds.has(agentId) === true,
  );
  useEffect(() => {
    active.current = !released;
    if (released) {
      setRows([]);
      setLoaded(false);
      setCursor(null);
      setExpanded(false);
    }
    return () => {
      active.current = false;
    };
  }, [released]);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      if (!client) throw new Error("主机已断开，请连接后重试。");
      const page = await client.readNativeHistoryTurn({
        agentId,
        readId,
        turnId: item.turnId,
        cursor,
      });
      if (!active.current) return;
      const events = page.items
        .filter(
          (entry) =>
            !(
              "messageId" in entry &&
              typeof entry.messageId === "string" &&
              item.summaryMessageIds.includes(entry.messageId)
            ),
        )
        .map((entry) => ({
          event: { type: "timeline" as const, provider: "codex", item: entry, turnId: item.turnId },
          timestamp: item.timestamp,
        }));
      const entries = hydrateStreamState(events, { source: "canonical" });
      for (const entry of entries) entry.timestampUnknown = item.timestampUnknown;
      setRows((previous) => [...previous, ...entries]);
      setCursor(page.nextCursor);
      setLoaded(true);
    } catch (failure) {
      console.error("原生处理过程读取失败", failure);
      if (active.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      inFlight.current = false;
      if (active.current) setLoading(false);
    }
  }, [client, agentId, readId, item, cursor]);
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
    if (!expanded && !loaded) void load();
  }, [expanded, item.id, loaded, load, viewport]);
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
            {(!loaded || cursor !== null || error !== null) && (
              <Button variant="ghost" loading={loading} disabled={loading} onPress={loadMore}>
                {" "}
                {error ? "重试加载过程" : "加载更多过程"}{" "}
              </Button>
            )}
          </View>
        )}
      </DisclosureContent>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    width: "100%",
    maxWidth: MAX_CHAT_CONTENT_WIDTH,
    alignSelf: "center",
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
