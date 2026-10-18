import React, { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";

type AudioInputSetting = "dictationEnabled" | "voiceModeEnabled";
interface SaveError {
  key: AudioInputSetting;
  value: boolean;
  message: string;
}

function AudioInputSettingRow({
  settingKey,
  value,
  disabled,
  pending,
  error,
  onChange,
}: {
  settingKey: AudioInputSetting;
  value: boolean;
  disabled: boolean;
  pending: boolean;
  error: SaveError | null;
  onChange(key: AudioInputSetting, value: boolean): void;
}) {
  const { t } = useTranslation();
  const label = t(
    settingKey === "dictationEnabled" ? "audioInput.dictation.label" : "audioInput.voiceMode.label",
  );
  const description = t(
    settingKey === "dictationEnabled"
      ? "audioInput.dictation.description"
      : "audioInput.voiceMode.description",
  );
  const change = useCallback((next: boolean) => onChange(settingKey, next), [onChange, settingKey]);
  const retry = useCallback(() => {
    if (error) onChange(settingKey, error.value);
  }, [error, onChange, settingKey]);
  return (
    <View
      style={[settingsStyles.row, settingsStyles.rowBorder]}
      testID={`audio-setting-row-${settingKey}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{label}</Text>
        <Text style={settingsStyles.rowHint}>{pending ? t("audioInput.saving") : description}</Text>
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {t("common.errors.unableToSave")}：{error.message}
          </Text>
        ) : null}
      </View>
      {error ? (
        <Button size="xs" variant="ghost" onPress={retry} disabled={disabled}>
          {t("common.actions.retry")}
        </Button>
      ) : null}
      <Switch
        value={value}
        onValueChange={change}
        disabled={disabled}
        accessibilityLabel={label}
        testID={`audio-setting-${settingKey}`}
      />
    </View>
  );
}

export function AudioInputSettingsRows() {
  const { settings, isLoading, error: loadError, updateSettings } = useAppSettings();
  const [pending, setPending] = useState<AudioInputSetting | null>(null);
  const [error, setError] = useState<SaveError | null>(null);
  const saving = useRef(false);
  const change = useCallback(
    async (key: AudioInputSetting, value: boolean) => {
      if (saving.current) return;
      saving.current = true;
      setPending(key);
      setError(null);
      try {
        await updateSettings({ [key]: value });
      } catch (saveError) {
        console.error("[AudioInputSettings] Failed to save setting", saveError);
        setError({
          key,
          value,
          message: saveError instanceof Error ? saveError.message : String(saveError),
        });
      } finally {
        saving.current = false;
        setPending(null);
      }
    },
    [updateSettings],
  );
  const disabled = isLoading || loadError !== null || pending !== null;
  return (
    <>
      <AudioInputSettingRow
        settingKey="dictationEnabled"
        value={settings.dictationEnabled}
        disabled={disabled}
        pending={pending === "dictationEnabled"}
        error={error?.key === "dictationEnabled" ? error : null}
        onChange={change}
      />
      <AudioInputSettingRow
        settingKey="voiceModeEnabled"
        value={settings.voiceModeEnabled}
        disabled={disabled}
        pending={pending === "voiceModeEnabled"}
        error={error?.key === "voiceModeEnabled" ? error : null}
        onChange={change}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.xs },
}));
