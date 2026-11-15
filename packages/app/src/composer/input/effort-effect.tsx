import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { EffortEffectProps } from "./effort-effect.types";

export function EffortEffect({ active }: EffortEffectProps) {
  return active ? (
    <View pointerEvents="none" accessibilityElementsHidden style={styles.wash} />
  ) : null;
}

const styles = StyleSheet.create((theme) => ({
  wash: {
    position: "absolute",
    inset: 0,
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: theme.colors.palette.purple[300],
    opacity: 0.1,
  },
}));
