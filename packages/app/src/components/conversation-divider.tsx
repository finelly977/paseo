import { useMemo, type ReactNode } from "react";
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
  const style = useMemo(
    () => [
      styles.root,
      { paddingVertical: spacing },
      labelPosition === "center" ? styles.center : { gap: spacing },
    ],
    [labelPosition, spacing],
  );
  return (
    <View style={style} testID="conversation-divider">
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
  root: { width: "100%" },
  center: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  line: { height: 1, backgroundColor: theme.colors.border },
  flexLine: { flex: 1 },
  fullLine: { flexShrink: 0, width: "100%" },
}));
