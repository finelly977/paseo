import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ThinkingSliderProps } from "./thinking-slider.types";

function ThinkingStep({
  option,
  index,
  selected,
  disabled,
  onSelect,
}: {
  option: ThinkingSliderProps["options"][number];
  index: number;
  selected: boolean;
  disabled: boolean;
  onSelect: ThinkingSliderProps["onSelect"];
}) {
  const select = useCallback(() => onSelect(index), [onSelect, index]);
  const state = useMemo(() => ({ selected, disabled }), [selected, disabled]);
  return (
    <Pressable
      onPress={select}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={option.label}
      accessibilityState={state}
      style={[styles.step, selected && styles.selected, disabled && styles.disabled]}
    >
      <Text style={styles.label}>{option.label}</Text>
    </Pressable>
  );
}
export function ThinkingSlider({
  options,
  selectedIndex,
  disabled,
  onSelect,
}: ThinkingSliderProps) {
  return (
    <View style={styles.track}>
      {options.map((option, index) => (
        <ThinkingStep
          key={option.id}
          option={option}
          index={index}
          selected={selectedIndex === index}
          disabled={disabled}
          onSelect={onSelect}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  track: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
  step: {
    minHeight: 44,
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  selected: { backgroundColor: theme.colors.surface3 },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  disabled: { opacity: 0.5 },
}));
