import { memo, useCallback, useEffect, useState, type ComponentProps } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown, Image as ImageIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { AssistantMessage } from "@/components/message";
import type { Theme } from "@/styles/theme";

const ThemedImageIcon = withUnistyles(ImageIcon);
const ThemedChevronDown = withUnistyles(ChevronDown);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const COLLAPSED_ACCESSIBILITY_STATE = { expanded: false } as const;
const EXPANDED_ACCESSIBILITY_STATE = { expanded: true } as const;

type ProviderImageMessageProps = ComponentProps<typeof AssistantMessage> & {
  itemId: string;
};

export const ProviderImageMessage = memo(function ProviderImageMessage({
  itemId,
  ...messageProps
}: ProviderImageMessageProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setIsExpanded(false);
  }, [itemId]);

  const handleToggle = useCallback(() => {
    setIsExpanded((current) => !current);
  }, []);
  const toggleStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.toggle,
      hovered && styles.toggleHovered,
      pressed && styles.togglePressed,
    ],
    [],
  );
  const label = t(isExpanded ? "message.attachments.closeImage" : "composer.attachments.openImage");

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={
          isExpanded ? EXPANDED_ACCESSIBILITY_STATE : COLLAPSED_ACCESSIBILITY_STATE
        }
        testID="provider-image-collapse-toggle"
        onPress={handleToggle}
        style={toggleStyle}
      >
        <ThemedImageIcon size={16} uniProps={foregroundMutedColorMapping} />
        <Text style={styles.label}>{label}</Text>
        <ThemedChevronDown
          size={14}
          uniProps={foregroundMutedColorMapping}
          style={isExpanded ? styles.expandedIcon : undefined}
        />
      </Pressable>
      {isExpanded ? <AssistantMessage {...messageProps} /> : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
  },
  toggle: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  toggleHovered: {
    backgroundColor: theme.colors.surface2,
  },
  togglePressed: {
    opacity: theme.opacity[50],
  },
  label: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  expandedIcon: {
    transform: [{ rotate: "180deg" }],
  },
}));
