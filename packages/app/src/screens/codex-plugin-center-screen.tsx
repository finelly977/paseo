import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Blocks, ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { HostPicker } from "@/components/hosts/host-picker";
import { HostCodexPluginsPage } from "@/codex-plugins/marketplace-page";
import { useHosts } from "@/runtime/host-runtime";
import { useTranslation } from "react-i18next";

const MutedBlocks = withUnistyles(Blocks);
const MutedChevron = withUnistyles(ChevronDown);
const muted = (theme: import("@/styles/theme").Theme) => ({ color: theme.colors.foregroundMuted });

export function CodexPluginCenterScreen() {
  const { t } = useTranslation();
  const hosts = useHosts();
  const [serverId, setServerId] = useState("");
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  useEffect(() => {
    if (!serverId || !hosts.some((host) => host.serverId === serverId)) {
      setServerId(hosts[0]?.serverId ?? "");
    }
  }, [hosts, serverId]);
  const selectedHost = useMemo(
    () => hosts.find((host) => host.serverId === serverId),
    [hosts, serverId],
  );
  const selectHost = useCallback((next: string) => setServerId(next), []);
  const openPicker = useCallback(() => setOpen(true), []);
  const setPicker = useCallback((next: boolean) => setOpen(next), []);
  const hostOptions = useMemo(
    () => hosts.map((host) => ({ serverId: host.serverId, label: host.label })),
    [hosts],
  );
  const title = t("sidebar.sections.plugins");
  const hostPicker = useMemo(
    () => (
      <HostPicker
        hosts={hostOptions}
        value={serverId}
        onSelect={selectHost}
        open={open}
        onOpenChange={setPicker}
        anchorRef={anchorRef}
        searchable={hosts.length > 10}
        title="选择主机"
        desktopPlacement="bottom-start"
        desktopMinWidth={240}
      >
        <View ref={anchorRef} collapsable={false}>
          <Pressable
            onPress={openPicker}
            accessibilityRole="button"
            accessibilityLabel="选择插件主机"
            style={styles.hostTrigger}
          >
            <Text numberOfLines={1} style={styles.hostLabel}>
              {selectedHost?.label ?? "选择主机"}
            </Text>
            <MutedChevron size={14} uniProps={muted} />
          </Pressable>
        </View>
      </HostPicker>
    ),
    [
      hostOptions,
      serverId,
      selectHost,
      open,
      setPicker,
      anchorRef,
      hosts.length,
      openPicker,
      selectedHost,
    ],
  );
  const header = <MenuHeader title={title} rightContent={hostPicker} />;
  return (
    <View style={styles.screen}>
      {header}
      {serverId ? (
        <HostCodexPluginsPage serverId={serverId} />
      ) : (
        <View style={styles.empty}>
          <MutedBlocks size={28} uniProps={muted} />
          <Text style={styles.emptyTitle}>还没有可用主机</Text>
          <Text style={styles.emptyText}>先连接一个 Paseo 主机，再浏览 Codex 插件市场。</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  hostTrigger: {
    minHeight: 32,
    maxWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  hostLabel: { maxWidth: 180, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[8],
  },
  emptyTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
