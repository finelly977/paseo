import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useFetchQuery } from "@/data/query";
import { StyleSheet } from "react-native-unistyles";
import { Clock, Ellipsis, X, ArrowUp } from "lucide-react-native";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { ScheduledAgentMessageSummary } from "@getpaseo/protocol/messages";

export function ScheduledMessages({ serverId, agentId }: { serverId: string; agentId: string }) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const query = useFetchQuery({
    queryKey: ["scheduled-agent-messages", serverId, agentId],
    dataShape: "list",
    staleTimeMs: 0,
    enabled: connected && client !== null,
    refetchInterval: 2000,
    queryFn: async () => {
      if (!client) throw new Error("主机已断开连接");
      return client.listScheduledAgentMessages(agentId);
    },
  });
  if (query.isError) return <Text style={styles.error}>读取定时消息失败，正在重试</Text>;
  if (!query.data?.length) return null;
  return (
    <View style={styles.track} testID="scheduled-message-list">
      {query.data.map((message) => (
        <ScheduledMessageRow
          key={message.id}
          message={message}
          serverId={serverId}
          onChange={query.refetch}
        />
      ))}
    </View>
  );
}
function ScheduledMessageRow({
  message,
  serverId,
  onChange,
}: {
  message: ScheduledAgentMessageSummary;
  serverId: string;
  onChange: () => Promise<unknown>;
}) {
  const client = useHostRuntimeClient(serverId);
  const toast = useToast();
  const connected = useHostRuntimeIsConnected(serverId);
  const [pending, setPending] = useState(false);
  const sending = message.status === "sending";
  const attachmentLabel = [
    ...(message.imageCount > 0 ? [`${message.imageCount} 张图片`] : []),
    ...(message.attachmentCount > 0 ? [`${message.attachmentCount} 个附件`] : []),
  ].join(" · ");
  const title = message.text
    ? `${message.text}${message.imageCount || message.attachmentCount ? ` · ${attachmentLabel}` : ""}`
    : attachmentLabel;
  let label = `${new Date(message.sendAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 发送`;
  if (message.status === "failed") label = "发送失败";
  else if (sending) label = "正在发送";
  else if (Date.parse(message.sendAt) <= Date.now()) label = "等待当前回合结束";
  const run = useCallback(
    (action: "cancel" | "send") => {
      if (pending || !client) return;
      setPending(true);
      const operation =
        action === "cancel"
          ? client.cancelScheduledAgentMessage(message.agentId, message.id)
          : client.sendScheduledAgentMessageNow(message.agentId, message.id);
      void operation
        .then(onChange)
        .catch((error) => {
          console.error("[Composer] Scheduled message action failed", error);
          toast.error(error instanceof Error ? error.message : "操作失败，请重试");
        })
        .finally(() => setPending(false));
    },
    [client, message.agentId, message.id, onChange, pending, toast],
  );
  const send = useCallback(() => run("send"), [run]);
  const cancel = useCallback(() => run("cancel"), [run]);
  const clock = useMemo(() => <Clock size={12} color={styles.label.color} />, []);
  const ellipsis = useMemo(() => <Ellipsis size={14} color={styles.label.color} />, []);
  const arrow = useMemo(() => <ArrowUp size={14} color={styles.label.color} />, []);
  const cross = useMemo(() => <X size={14} color={styles.label.color} />, []);
  return (
    <View testID={`scheduled-message-${message.id}`}>
      <View style={styles.row}>
        {clock}
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.text} numberOfLines={1}>
          {title}
        </Text>
        <DropdownMenu>
          <DropdownMenuTrigger
            accessibilityLabel="定时消息操作"
            disabled={pending || sending || !connected}
            style={styles.menu}
          >
            {ellipsis}
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" minWidth={168}>
            <DropdownMenuItem onSelect={send} leading={arrow}>
              {message.status === "failed" ? "重试发送" : "立即发送"}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={cancel} leading={cross}>
              取消发送
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {message.error ? <Text style={styles.error}>{message.error}</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  track: { gap: theme.spacing[1], marginBottom: theme.spacing[2] },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2], minHeight: 28 },
  label: { fontSize: theme.fontSize.xs, color: theme.colors.foregroundMuted },
  text: { flex: 1, minWidth: 0, fontSize: theme.fontSize.xs, color: theme.colors.foreground },
  error: { fontSize: theme.fontSize.xs, color: theme.colors.statusDanger },
  menu: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.base,
  },
}));
