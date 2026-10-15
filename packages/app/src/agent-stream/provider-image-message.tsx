import { memo, useCallback, useState, type ComponentProps } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown, Images } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { AssistantMarkdownImage } from "@/components/message";
import type { Theme } from "@/styles/theme";

const ThemedImageIcon = withUnistyles(Images);
const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
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
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);

  const handleToggle = useCallback(() => {
    setIsExpanded((current) => !current);
  }, []);
  const toggleStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [styles.toggle, pressed && styles.togglePressed],
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
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        hitSlop={6}
        style={toggleStyle}
      >
        <View style={styles.iconSlot}>
          <ThemedImageIcon
            size={12}
            uniProps={isHovered ? foregroundColorMapping : mutedColorMapping}
            style={styles.iconNudge}
          />
        </View>
        <Text style={[styles.label, isHovered && styles.labelActive]}>{label}</Text>
        <ThemedChevronDown
          size={12}
          uniProps={isHovered ? foregroundColorMapping : mutedColorMapping}
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
    minHeight: 32,
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginLeft: -13,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: theme.borderRadius.lg,
  },
  togglePressed: {
    opacity: 0.9,
  },
  iconSlot: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  iconNudge: {
    marginLeft: -1,
  },
  label: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  labelActive: {
    color: theme.colors.foreground,
  },
  collapsedIcon: {
    transform: [{ rotate: "-90deg" }],
  },
}));
