import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { COMPACT_LABEL_DATASET } from "@/styles/compact-label";

export function GitChangeCountBadge({ count, label }: { count: number; label: string }) {
  return (
    <View
      style={styles.container(count < 100)}
      accessibilityLabel={`${label}: ${count}`}
      testID="git-change-count"
    >
      <Text style={styles.text} dataSet={COMPACT_LABEL_DATASET} numberOfLines={1}>
        {count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const fontSize = Math.max(10, Math.round(theme.fontSize.base * 0.625));
  const diameter = Math.max(16, fontSize + 6);
  return {
    container: (round: boolean) => ({
      width: round ? diameter : undefined,
      minWidth: diameter,
      height: diameter,
      paddingHorizontal: round ? 0 : theme.spacing[1],
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.borderRadius.full,
      backgroundColor: theme.colors.scmBadgeBackground,
    }),
    text: {
      fontFamily: theme.fontFamily.ui,
      fontSize,
      lineHeight: diameter,
      fontVariant: ["tabular-nums"],
      textAlign: "center",
      textAlignVertical: "center",
      includeFontPadding: false,
      color: theme.colors.scmBadgeForeground,
    },
  };
});
