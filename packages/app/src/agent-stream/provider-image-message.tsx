import { memo, useCallback, useState, type ComponentProps } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown, Images } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { AssistantMarkdownImage } from "@/components/message";
import type { Theme } from "@/styles/theme";

const ThemedImageIcon = withUnistyles(Images);
const ThemedChevronDown = withUnistyles(ChevronDown);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const COLLAPSED_ACCESSIBILITY_STATE = { expanded: false } as const;
const EXPANDED_ACCESSIBILITY_STATE = { expanded: true } as const;

type ProviderImageMessageProps = Pick<
  ComponentProps<typeof AssistantMarkdownImage>,
  "source" | "alt" | "client" | "workspaceRoot" | "serverId"
>;

export const ProviderImageMessage = memo(function ProviderImageMessage(
  imageProps: ProviderImageMessageProps,
) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);

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
  const label = t("message.attachments.viewedImage");

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        aria-expanded={isExpanded}
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
          style={isExpanded ? undefined : styles.collapsedIcon}
        />
      </Pressable>
      {isExpanded ? (
        <AssistantMarkdownImage {...imageProps} hasLeadingContent={false} display="thumbnail" />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    width: "100%",
    gap: theme.spacing[1],
  },
  toggle: {
    minHeight: 36,
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
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
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  collapsedIcon: {
    transform: [{ rotate: "-90deg" }],
  },
}));
