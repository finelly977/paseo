import { useCallback, useMemo, useState } from "react";
import { Image, View, type NativeSyntheticEvent, type ImageErrorEventData } from "react-native";
import { Blocks } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { CodexPlugin } from "@getpaseo/protocol/codex-plugins";
import type { Theme } from "@/styles/theme";

const ThemedBlocks = withUnistyles(Blocks);
const muted = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const sizes = { tiny: 22, list: 28, hero: 48 } as const;

function IconView({
  plugin,
  size = "list",
  dark,
}: {
  plugin: Pick<CodexPlugin, "id" | "title" | "iconUrl" | "iconUrlDark">;
  size?: keyof typeof sizes;
  dark: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const uri = dark
    ? (plugin.iconUrlDark ?? plugin.iconUrl)
    : (plugin.iconUrl ?? plugin.iconUrlDark);
  const source = useMemo(() => (uri ? { uri } : undefined), [uri]);
  const frame = useMemo(() => [styles.frame, { width: sizes[size], height: sizes[size] }], [size]);
  const handleError = useCallback(
    (event: NativeSyntheticEvent<ImageErrorEventData>) => {
      console.error("插件图标加载失败", plugin.id, event.nativeEvent.error);
      setFailed(true);
    },
    [plugin.id],
  );
  return (
    <View style={frame}>
      {source && !failed ? (
        <Image
          source={source}
          style={styles.image}
          resizeMode="contain"
          onError={handleError}
          accessibilityLabel={`${plugin.title} 图标`}
        />
      ) : (
        <ThemedBlocks size={sizes[size] * 0.52} uniProps={muted} />
      )}
    </View>
  );
}

export const PluginIcon = withUnistyles(IconView, (theme) => ({
  dark: theme.colorScheme === "dark",
}));
const styles = StyleSheet.create((theme) => ({
  frame: {
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor: theme.colors.surface1,
  },
  image: { width: "100%", height: "100%" },
}));
