import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { COMPACT_LABEL_DATASET, COMPACT_LABEL_SCALE } from "@/styles/compact-label";

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
  const fontSize = Math.round(theme.fontSize.base * COMPACT_LABEL_SCALE);
  const diameter = Math.max(20, fontSize + theme.spacing[2]);
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
