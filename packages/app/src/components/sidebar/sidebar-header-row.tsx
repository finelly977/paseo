import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { LucideIcon } from "lucide-react-native";
import { HEADER_INNER_HEIGHT, HEADER_INNER_HEIGHT_MOBILE } from "@/constants/layout";
import { COMPACT_LABEL_DATASET } from "@/styles/compact-label";
import { ICON_SIZE } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ShortcutKey } from "@/utils/format-shortcut";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundSidebarColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundSidebar });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type SidebarHeaderRowVariant = "header" | "compact" | "primary";

interface SidebarHeaderRowProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  isActive?: boolean;
  testID?: string;
  nativeID?: string;
  accessibilityLabel?: string;
  /**
   * "header" (default): a sidebar-height row with its own bottom separator —
   * the lone header at the top of a sidebar (settings "Back to workspace").
   * "compact": a workspace-row-height row with no separator, for entries that
   * sit in a header group whose wrapper owns the single divider.
   * "primary": an elevated quiet primary action button at the top of the sidebar
   * (e.g. "New workspace"), anchoring the hierarchy without using accent fill.
   */
  variant?: SidebarHeaderRowVariant;
  shortcutKeys?: ShortcutKey[][] | null;
}

function resolveHeaderRowIconMapping(isHighlighted: boolean, isPrimary: boolean) {
  if (isHighlighted) {
    return foregroundColorMapping;
  }
  return isPrimary ? foregroundSidebarColorMapping : foregroundMutedColorMapping;
}

export function SidebarHeaderRow({
  icon: Icon,
  label,
  onPress,
  isActive = false,
  testID,
  nativeID,
  accessibilityLabel,
  variant = "header",
  shortcutKeys = null,
}: SidebarHeaderRowProps) {
  const ThemedIcon = useMemo(() => withUnistyles(Icon), [Icon]);

  const containerStyle = useMemo(() => {
    if (variant === "primary") return styles.containerPrimary;
    if (variant === "compact") return styles.containerCompact;
    return styles.container;
  }, [variant]);

  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      variant === "compact" && styles.buttonCompact,
      variant === "primary" && styles.buttonPrimary,
      (Boolean(hovered) || isActive) &&
        (variant === "primary" ? styles.buttonPrimaryHovered : styles.buttonHovered),
      variant === "primary" && pressed && styles.buttonPrimaryPressed,
    ],
    [isActive, variant],
  );

  const renderChildren = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => {
      const isHighlighted = Boolean(state.hovered) || isActive;
      const isPrimary = variant === "primary";
      const iconMapping = resolveHeaderRowIconMapping(isHighlighted, isPrimary);
      const showInlineShortcut = Boolean(shortcutKeys && !isPrimary && state.hovered);
      return (
        <>
          <ThemedIcon size={ICON_SIZE.sm} strokeWidth={1.75} uniProps={iconMapping} />
          <SidebarHeaderRowLabel
            label={label}
            isHighlighted={isHighlighted}
            isPrimary={isPrimary}
          />
          {showInlineShortcut ? (
            <View style={styles.shortcut} dataSet={COMPACT_LABEL_DATASET}>
              <Shortcut chord={shortcutKeys!} textStyle={styles.shortcutText} />
            </View>
          ) : null}
        </>
      );
    },
    [ThemedIcon, isActive, label, shortcutKeys, variant],
  );

  const button = (
    <Pressable
      onPress={onPress}
      testID={testID}
      nativeID={nativeID}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={buttonStyle}
    >
      {renderChildren}
    </Pressable>
  );

  return (
    <View style={containerStyle}>
      {variant === "primary" && shortcutKeys ? (
        <Tooltip delayDuration={450} enabledOnMobile={false}>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="bottom" align="center" offset={6}>
            <View style={styles.tooltipRow} dataSet={COMPACT_LABEL_DATASET}>
              <Text style={styles.tooltipText}>{label}</Text>
              <Shortcut chord={shortcutKeys} textStyle={styles.shortcutText} />
            </View>
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </View>
  );
}

function SidebarHeaderRowLabel({
  label,
  isHighlighted,
  isPrimary,
}: {
  label: string;
  isHighlighted: boolean;
  isPrimary: boolean;
}) {
  const labelStyle = useMemo(
    () => [
      styles.label,
      isPrimary && styles.labelPrimary,
      isHighlighted && (isPrimary ? styles.labelPrimaryHighlighted : styles.labelHighlighted),
    ],
    [isHighlighted, isPrimary],
  );
  return (
    <Text numberOfLines={1} style={labelStyle}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: HEADER_INNER_HEIGHT,
    },
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    userSelect: "none",
  },
  containerCompact: {
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    userSelect: "none",
  },
  containerPrimary: {
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    userSelect: "none",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    // Match the sidebar workspace-row shape (height, padding, radius) so the
    // compact header entries sit tight against the workspace list below.
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
  },
  // Compact header entries (New workspace / History) sit tighter than the
  // workspace-row shape the base button mirrors.
  buttonCompact: {
    minHeight: 32,
    paddingVertical: theme.spacing[1.5],
    // Match the project rows' inner padding so the icons align on one vertical
    // edge with the workspace list below (base button uses a wider spacing[3]).
    paddingHorizontal: theme.spacing[2],
  },
  buttonPrimary: {
    justifyContent: "center",
    minHeight: { xs: 38, md: 32 },
    paddingVertical: { xs: theme.spacing[2], md: theme.spacing[1.5] },
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  buttonPrimaryHovered: {
    backgroundColor: theme.colors.surface3,
    borderColor: theme.colors.borderAccent,
  },
  buttonPrimaryPressed: {
    transform: [{ scale: 0.985 }],
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundSidebar,
  },
  labelPrimary: {
    color: theme.colors.foregroundSidebar,
  },
  labelPrimaryHighlighted: {
    color: theme.colors.foreground,
  },
  labelHighlighted: {
    color: theme.colors.foregroundSidebar,
  },
  shortcut: {
    marginLeft: "auto",
    flexShrink: 0,
  },
  shortcutText: {
    fontSize: Math.round(theme.fontSize.base * 0.75),
    lineHeight: Math.ceil(theme.fontSize.base * 0.75 * 1.4),
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: Math.round(theme.fontSize.base * 0.8125),
    color: theme.colors.popoverForeground,
  },
}));
