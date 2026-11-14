import { StyleSheet } from "react-native-unistyles";
import { getProviderIcon } from "./provider-icons";

export function ModelProviderGlyph({
  provider,
  size,
  tone = "muted",
}: {
  provider: string;
  size: number;
  tone?: "muted" | "foreground";
}) {
  const Icon = getProviderIcon(provider);
  return (
    <Icon
      size={size}
      color={tone === "foreground" ? styles.foreground.color : styles.muted.color}
    />
  );
}
const styles = StyleSheet.create((theme) => ({
  foreground: { color: theme.colors.foreground },
  muted: { color: theme.colors.foregroundMuted },
}));
