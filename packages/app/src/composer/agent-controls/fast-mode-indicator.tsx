import { View } from "react-native";
import { Zap } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentFeature } from "@getpaseo/protocol/agent-types";
import { AgentControlIconGlyph } from "./control";

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
  icon: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
});
