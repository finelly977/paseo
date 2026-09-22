import { useCallback, useMemo } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { ServerCog } from "lucide-react-native";
import {
  getCodexProviderInjectionModels,
  type CodexProviderInjection,
} from "@getpaseo/protocol/messages";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentControlIconGlyph } from "@/composer/agent-controls/control";
import { ComposerToolbarGlyph } from "@/composer/agent-controls/glyph";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";

interface CodexProviderInjectionControlProps {
  injections: readonly CodexProviderInjection[];
  selectedInjectionId: string | null;
  selectedModelId: string;
  onSelect: (injectionId: string, model?: string) => void;
  onClose?: () => void;
  disabled?: boolean;
  surface: "toolbar" | "sheet";
  showToolbarLabel?: boolean;
}

function resolveSelectedValue(input: {
  label: string;
  selectedInjection: CodexProviderInjection | null;
  selectedModelId: string;
}): string {
  if (!input.selectedInjection) return input.label;
  if (!input.selectedModelId) return input.selectedInjection.name;
  return `${input.selectedInjection.name} · ${input.selectedModelId}`;
}

function resolveInteractiveStyle(input: { interactive: boolean; isSheet: boolean }) {
  if (!input.interactive) return null;
  return input.isSheet ? styles.sheetRowInteractive : styles.toolbarInteractive;
}

export function CodexProviderInjectionControl({
  injections,
  selectedInjectionId,
  selectedModelId,
  onSelect,
  onClose,
  disabled = false,
  surface,
  showToolbarLabel = true,
}: CodexProviderInjectionControlProps) {
  const { t } = useTranslation();
  const { glyphSize } = useComposerControlLayout();
  const selectedInjection = useMemo(
    () => injections.find((injection) => injection.id === selectedInjectionId) ?? null,
    [injections, selectedInjectionId],
  );
  const label = t("sidebar.workspace.codexProviderInjections.label");
  const selectedValue = resolveSelectedValue({
    label,
    selectedInjection,
    selectedModelId,
  });
  const isSheet = surface === "sheet";
  const resolvedGlyphSize = isSheet ? 16 : glyphSize;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose?.();
    },
    [onClose],
  );
  const triggerStyle = useCallback(
    ({ pressed, hovered = false, open }: PressableStateCallbackType & { open: boolean }) => [
      isSheet ? styles.sheetRow : styles.toolbarControl,
      !isSheet && !showToolbarLabel ? styles.toolbarIconOnly : null,
      resolveInteractiveStyle({
        interactive: hovered || pressed || open,
        isSheet,
      }),
      disabled ? styles.disabled : null,
    ],
    [disabled, isSheet, showToolbarLabel],
  );

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        disabled={disabled}
        style={triggerStyle}
        accessibilityLabel={selectedValue}
        testID="agent-codex-provider-injection-selector"
      >
        {isSheet ? (
          <View style={styles.sheetGlyph}>
            <AgentControlIconGlyph
              icon={ServerCog}
              size={resolvedGlyphSize}
              tone={selectedInjection ? "green" : "muted"}
            />
          </View>
        ) : (
          <ComposerToolbarGlyph size={resolvedGlyphSize}>
            <AgentControlIconGlyph
              icon={ServerCog}
              size={resolvedGlyphSize}
              tone={selectedInjection ? "green" : "muted"}
            />
          </ComposerToolbarGlyph>
        )}
        {isSheet ? (
          <Text style={styles.sheetLabel} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
        {isSheet || showToolbarLabel ? (
          <Text style={isSheet ? styles.sheetValue : styles.toolbarValue} numberOfLines={1}>
            {selectedValue}
          </Text>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" width={240} maxHeight={360} scrollable>
        {injections.map((injection) => (
          <CodexProviderInjectionSubmenu
            key={injection.id}
            injection={injection}
            selectedInjectionId={selectedInjectionId}
            selectedModelId={selectedModelId}
            onSelect={onSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CodexProviderInjectionSubmenu({
  injection,
  selectedInjectionId,
  selectedModelId,
  onSelect,
}: {
  injection: CodexProviderInjection;
  selectedInjectionId: string | null;
  selectedModelId: string;
  onSelect: (injectionId: string, model?: string) => void;
}) {
  const { t } = useTranslation();
  const models = getCodexProviderInjectionModels(injection);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger testID={`draft-codex-provider-injection-${injection.id}`}>
        {injection.name}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent testID={`draft-codex-provider-injection-models-${injection.id}`}>
        {models.length > 0 ? (
          models.map((model) => (
            <CodexProviderInjectionModelItem
              key={model}
              injectionId={injection.id}
              model={model}
              selected={selectedInjectionId === injection.id && selectedModelId === model}
              onSelect={onSelect}
            />
          ))
        ) : (
          <CodexProviderInjectionModelItem
            injectionId={injection.id}
            selected={selectedInjectionId === injection.id}
            onSelect={onSelect}
          >
            {t("sidebar.workspace.codexProviderInjections.keepCurrentModel")}
          </CodexProviderInjectionModelItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function CodexProviderInjectionModelItem({
  injectionId,
  model,
  selected,
  onSelect,
  children,
}: {
  injectionId: string;
  model?: string;
  selected: boolean;
  onSelect: (injectionId: string, model?: string) => void;
  children?: string;
}) {
  const handleSelect = useCallback(
    () => onSelect(injectionId, model),
    [injectionId, model, onSelect],
  );
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {children ?? model}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  toolbarControl: {
    height: 28,
    minWidth: 0,
    maxWidth: 220,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
  },
  toolbarIconOnly: {
    width: 28,
    flexShrink: 0,
    paddingHorizontal: 0,
    justifyContent: "center",
  },
  toolbarInteractive: {
    backgroundColor: theme.colors.surface2,
  },
  toolbarValue: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
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
  },
  sheetValue: {
    maxWidth: "45%",
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  disabled: {
    opacity: 0.5,
  },
}));
