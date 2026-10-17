import React, { useCallback, useMemo } from "react";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RefreshCw, Settings } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedSettings = withUnistyles(Settings);
const ThemedRefresh = withUnistyles(RefreshCw);
const ThemedSpinner = withUnistyles(LoadingSpinner);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface ModelBrowserHeaderActionsProps {
  provider: string;
  providerLabel: string;
  serverId: string | null;
  onRefresh?: (provider: string) => void;
  pending: boolean;
}

function buttonStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.button, (hovered || pressed) && styles.interactive];
}

export function ModelBrowserHeaderActions({
  provider,
  providerLabel,
  serverId,
  onRefresh,
  pending,
}: ModelBrowserHeaderActionsProps) {
  const { t } = useTranslation();
  const openSettings = useCallback(() => {
    if (serverId) useProviderSettingsStore.getState().open({ serverId, provider });
  }, [serverId, provider]);
  const refresh = useCallback(() => onRefresh?.(provider), [onRefresh, provider]);
  const refreshState = useMemo(() => ({ disabled: pending, busy: pending }), [pending]);
  return (
    <View style={styles.row}>
      <Pressable
        onPress={openSettings}
        disabled={!serverId}
        hitSlop={8}
        style={buttonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("modelSelector.openProviderSettings", { provider: providerLabel })}
        testID={`selector-header-settings-${provider}`}
      >
        <ThemedSettings size={ICON_SIZE.sm} uniProps={iconColor} />
      </Pressable>
      {onRefresh ? (
        <Pressable
          onPress={refresh}
          disabled={pending}
          hitSlop={8}
          style={buttonStyle}
          accessibilityRole="button"
          accessibilityState={refreshState}
          accessibilityLabel={pending ? "正在刷新模型列表" : "刷新模型列表"}
          testID={`selector-header-refresh-${provider}`}
        >
          {pending ? (
            <ThemedSpinner size={ICON_SIZE.sm} uniProps={iconColor} />
          ) : (
            <ThemedRefresh size={ICON_SIZE.sm} uniProps={iconColor} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  button: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  interactive: { backgroundColor: theme.colors.surface3 },
}));
