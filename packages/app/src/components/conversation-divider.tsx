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
  // 标签分割线与无标签横线共用一个文字行高，避免实际横线两侧留白相差半行。
  track: { height: theme.fontSize.base * 1.5, justifyContent: "center" },
  line: { height: 1, width: "100%", backgroundColor: theme.colors.border },
  flexLine: { flex: 1 },
  fullLine: { flexShrink: 0, width: "100%" },
}));
