import { useCallback, useMemo } from "react";
import { Pressable, View } from "react-native";
import { Zap } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentFeature } from "@getpaseo/protocol/agent-types";
import { AgentControlIconGlyph } from "./control";

export function FastModeToggle({
  features,
  disabled = false,
  onSetFeature,
}: {
  features: readonly AgentFeature[] | undefined;
  disabled?: boolean;
  onSetFeature: ((featureId: string, value: unknown) => void) | undefined;
}) {
  const feature = features?.find((entry) => entry.id === "fast_mode" && entry.type === "toggle");
  const enabled = Boolean(feature?.value);
  const state = useMemo(() => ({ checked: enabled }), [enabled]);
  const toggle = useCallback(() => onSetFeature?.("fast_mode", !enabled), [onSetFeature, enabled]);
  if (!feature) return null;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Fast"
      accessibilityState={state}
      aria-checked={enabled}
      disabled={disabled || !onSetFeature}
      onPress={toggle}
      style={styles.toggle}
      hitSlop={10}
      testID="thinking-fast-toggle"
    >
      <AgentControlIconGlyph icon={Zap} size={14} tone={enabled ? "yellow" : "muted"} />
    </Pressable>
  );
}

export function FastModeIndicator({ features }: { features: readonly AgentFeature[] | undefined }) {
  const enabled =
    features?.some(
      (feature) => feature.id === "fast_mode" && feature.type === "toggle" && feature.value,
    ) ?? false;
  if (!enabled) return null;
  return (
    <View
      style={styles.icon}
      testID="agent-fast-mode-indicator"
      accessibilityLabel="快速模式已开启"
    >
      <AgentControlIconGlyph icon={Zap} size={14} tone="yellow" />
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { width: 24, height: 24, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  icon: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
});
