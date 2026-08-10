import { forwardRef, useCallback, type ComponentType } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ComboboxTrigger } from "@/components/ui/combobox-trigger";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import type { Theme } from "@/styles/theme";

export interface AgentControlIconProps {
  size?: number;
  color?: string;
}

export type AgentControlIcon = ComponentType<AgentControlIconProps>;
export type AgentControlIconTone = "muted" | "foreground" | "blue" | "green" | "yellow";

interface ThemedAgentControlIconProps extends AgentControlIconProps {
  icon: AgentControlIcon;
  tone: AgentControlIconTone;
  mutedColor: string;
  foregroundColor: string;
  blueColor: string;
  greenColor: string;
  yellowColor: string;
}

function resolveAgentControlIconColor(props: ThemedAgentControlIconProps): string {
  if (props.tone === "foreground") return props.foregroundColor;
  if (props.tone === "blue") return props.blueColor;
  if (props.tone === "green") return props.greenColor;
  if (props.tone === "yellow") return props.yellowColor;
  return props.mutedColor;
}

function AgentControlIconView(props: ThemedAgentControlIconProps) {
  const { icon: Icon, size } = props;
  return <Icon size={size} color={resolveAgentControlIconColor(props)} />;
}

const ThemedAgentControlIcon = withUnistyles(AgentControlIconView);
const agentControlIconColorMapping = (theme: Theme) => ({
  mutedColor: theme.colors.foregroundMuted,
  foregroundColor: theme.colors.foreground,
  blueColor: theme.colors.palette.blue[400],
  greenColor: theme.colors.palette.green[400],
  yellowColor: theme.colors.palette.yellow[400],
});

export function AgentControlIconGlyph({
  icon,
  size,
  tone = "muted",
}: {
  icon: AgentControlIcon;
  size: number;
  tone?: AgentControlIconTone;
}) {
  return (
    <ThemedAgentControlIcon
      icon={icon}
      size={size}
      tone={tone}
      uniProps={agentControlIconColorMapping}
    />
  );
}

interface AgentControlTriggerProps {
  icon: AgentControlIcon;
  iconTone?: AgentControlIconTone;
  surface: "toolbar" | "sheet";
  label: string;
  value?: string;
  showToolbarLabel?: boolean;
  showCaret?: boolean;
  open?: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}

export const AgentControlTrigger = forwardRef<View, AgentControlTriggerProps>(
  function AgentControlTrigger(
    {
      icon: Icon,
      iconTone = "muted",
      surface,
      label,
      value,
      showToolbarLabel = true,
      showCaret = false,
      open = false,
      disabled = false,
      onPress,
      accessibilityLabel,
      testID,
    },
    ref,
  ) {
    const { glyphSize } = useComposerControlLayout();
    const isSheet = surface === "sheet";
    const resolvedGlyphSize = isSheet ? 16 : glyphSize;
    const showValue = isSheet || showToolbarLabel;
    const triggerStyle = useCallback(
      ({ pressed, hovered }: PressableStateCallbackType) => [
        isSheet ? styles.sheetRow : styles.toolbarControl,
        !isSheet && !showToolbarLabel && styles.toolbarIconOnly,
        hovered && (isSheet ? styles.sheetRowInteractive : styles.hovered),
        (pressed || open) && (isSheet ? styles.sheetRowInteractive : styles.pressed),
        disabled && styles.disabled,
      ],
      [disabled, isSheet, open, showToolbarLabel],
    );

    return (
      <ComboboxTrigger
        ref={ref}
        collapsable={false}
        disabled={disabled}
        onPress={onPress}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        chevron={showCaret ? undefined : null}
      >
        {isSheet ? (
          <View style={styles.sheetGlyph}>
            <AgentControlIconGlyph icon={Icon} size={resolvedGlyphSize} tone={iconTone} />
          </View>
        ) : (
          <ComposerToolbarGlyph size={resolvedGlyphSize}>
            <AgentControlIconGlyph icon={Icon} size={resolvedGlyphSize} tone={iconTone} />
          </ComposerToolbarGlyph>
        )}
        {isSheet ? (
          <Text style={styles.sheetLabel} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        {showValue ? (
          <Text style={isSheet ? styles.sheetValue : styles.toolbarValue} numberOfLines={1}>
            {value ?? label}
          </Text>
        ) : null}
      </ComboboxTrigger>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  toolbarControl: {
    height: 28,
    minWidth: 0,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: "transparent",
  },
  toolbarIconOnly: {
    width: 28,
    flexShrink: 0,
    paddingHorizontal: 0,
    justifyContent: "center",
  },
  toolbarValue: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  sheetRow: {
    minHeight: 44,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginHorizontal: -theme.spacing[1],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: theme.colors.surface1,
  },
  sheetRowInteractive: {
    backgroundColor: theme.colors.surface2,
  },
  sheetGlyph: {
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  sheetValue: {
    maxWidth: "45%",
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  hovered: {
    backgroundColor: theme.colors.surface2,
  },
  pressed: {
    backgroundColor: theme.colors.surface0,
  },
  disabled: {
    opacity: 0.5,
  },
}));
