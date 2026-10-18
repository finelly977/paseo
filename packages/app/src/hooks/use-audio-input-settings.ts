import { useAppSettings } from "@/hooks/use-settings";

/** 客户端偏好尚未读取或读取失败时，不开放任何录音入口。 */
export function useAudioInputSettings() {
  const { settings, isLoading, error } = useAppSettings();
  const ready = !isLoading && error === null;
  return {
    dictationEnabled: ready && settings.dictationEnabled,
    voiceModeEnabled: ready && settings.voiceModeEnabled,
  };
}
