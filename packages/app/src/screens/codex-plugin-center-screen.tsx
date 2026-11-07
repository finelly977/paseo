import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Blocks, ChevronDown, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { HostPicker } from "@/components/hosts/host-picker";
import { HostCodexPluginsPage } from "@/codex-plugins/marketplace-page";
import { useHosts } from "@/runtime/host-runtime";
import { PluginCenterHeader } from "@/codex-plugins/center-header";
import { PLUGIN_CENTER_MAX_WIDTH, resolvePluginCenterLayout } from "@/codex-plugins/center-layout";
import { useIsCompactFormFactor } from "@/constants/layout";
import { WindowChromeRegion } from "@/utils/desktop-window";
import { navigateToLastWorkspace } from "@/stores/navigation-active-workspace-store";

const MutedBlocks = withUnistyles(Blocks);
const MutedChevron = withUnistyles(ChevronDown);
const muted = (theme: import("@/styles/theme").Theme) => ({ color: theme.colors.foregroundMuted });

export function CodexPluginCenterScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const isCompact = useIsCompactFormFactor();
  const { width } = useWindowDimensions();
  const layout = useMemo(() => resolvePluginCenterLayout(width, isCompact), [width, isCompact]);
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (!navigateToLastWorkspace()) router.replace("/open-project");
  }, [router]);
  const hosts = useHosts();
  const [selectedServerId, setServerId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const selectedHost = useMemo(
    () => hosts.find((host) => host.serverId === selectedServerId) ?? hosts[0],
    [hosts, selectedServerId],
  );
  const serverId = selectedHost?.serverId ?? "";
  const selectHost = useCallback((next: string) => setServerId(next), []);
  const openPicker = useCallback(() => setOpen(true), []);
  const setPicker = useCallback((next: boolean) => setOpen(next), []);
  const hostOptions = useMemo(
    () => hosts.map((host) => ({ serverId: host.serverId, label: host.label })),
    [hosts],
  );
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
  const headerRight = useMemo(
    () => (
      <>
        {hostPicker}
        <Button
          size="sm"
          variant="ghost"
          leftIcon={X}
          onPress={close}
          accessibilityLabel="关闭插件中心"
          testID="codex-plugins-close"
        />
      </>
    ),
    [hostPicker, close],
  );
  const content = (
    <View style={styles.screen}>
      {serverId ? (
        <HostCodexPluginsPage serverId={serverId} layout={layout} headerActions={headerRight} />
      ) : (
        <>
          <PluginCenterHeader navigation={null} actions={headerRight} />
          <View style={styles.empty}>
            <MutedBlocks size={28} uniProps={muted} />
            <Text style={styles.emptyTitle}>还没有可用主机</Text>
            <Text style={styles.emptyText}>先连接一个 Paseo 主机，再浏览 Codex 插件市场。</Text>
          </View>
        </>
      )}
    </View>
  );
  if (isCompact) return content;
  return (
    <AdaptiveModalSheet
      header={null}
      visible={isFocused}
      onClose={close}
      desktopMaxWidth={PLUGIN_CENTER_MAX_WIDTH}
      desktopCardStyle={styles.dialog}
      contentContainerStyle={styles.dialogContent}
      scrollable={false}
      testID="codex-plugins-dialog"
    >
      <WindowChromeRegion corners="none">{content}</WindowChromeRegion>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  dialog: { height: "94%", maxHeight: "94%", overflow: "hidden" },
  dialogContent: { flex: 1, padding: 0, gap: 0 },
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
