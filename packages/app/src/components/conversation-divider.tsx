import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

export function ConversationDivider({
  children,
  spacing,
  labelPosition,
}: {
  children: ReactNode;
  spacing: number;
  labelPosition: "above" | "center";
}) {
  return (
    <View style={styles.root(spacing, labelPosition)} testID="conversation-divider">
      {labelPosition === "center" && (
        <View style={[styles.track, styles.flexLine]}>
          <View style={styles.line} testID="conversation-divider-line" />
        </View>
      )}
      {children}
      <View style={[styles.track, labelPosition === "above" ? styles.fullLine : styles.flexLine]}>
        <View style={styles.line} testID="conversation-divider-line" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: (spacing: number, labelPosition: "above" | "center") => ({
    width: "100%",
    paddingTop: spacing,
    paddingBottom: spacing,
    flexDirection: labelPosition === "center" ? "row" : "column",
    alignItems: labelPosition === "center" ? "center" : "stretch",
    gap: labelPosition === "center" ? theme.spacing[2] : spacing,
  }),
  // 横线只占自身高度；压缩标签保留自然行高，不能给无标签横线再塞入半行空白。
  track: { justifyContent: "center" },
  line: { height: 1, width: "100%", backgroundColor: theme.colors.border },
  flexLine: { flex: 1 },
  fullLine: { flexShrink: 0, width: "100%" },
}));
