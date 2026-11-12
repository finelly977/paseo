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
        <View style={[styles.line, styles.flexLine]} testID="conversation-divider-line" />
      )}
      {children}
      <View
        style={[styles.line, labelPosition === "above" ? styles.fullLine : styles.flexLine]}
        testID="conversation-divider-line"
      />
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
  line: { height: 1, backgroundColor: theme.colors.border },
  flexLine: { flex: 1 },
  fullLine: { flexShrink: 0, width: "100%" },
}));
