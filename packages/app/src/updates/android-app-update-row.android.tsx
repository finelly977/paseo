import { useCallback, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { requireNativeModule, NativeModule } from "expo";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { StyleSheet } from "react-native-unistyles";
import { fetchAndroidRelease } from "./android-release";
import { createAndroidUpdater } from "./android-updater";

// Expo 的事件映射需要类型别名的隐式索引签名。
// oxlint-disable-next-line typescript-eslint/consistent-type-definitions
type UpdateEvents = {
  downloadProgress: (event: { percent: number }) => void;
};
declare class UpdateModule extends NativeModule<UpdateEvents> {
  getInstalledVersionCode(): number;
  downloadAsync(url: string, sha256: string, size: number, versionCode: number): Promise<void>;
  installAsync(): Promise<"permission-required" | "installer-opened">;
}
const native = requireNativeModule<UpdateModule>("PaseoAppUpdates");
const updater = createAndroidUpdater({
  check: () => fetchAndroidRelease(native.getInstalledVersionCode()),
  download: async (release, progress) => {
    const subscription = native.addListener("downloadProgress", ({ percent }) => progress(percent));
    try {
      await native.downloadAsync(release.url, release.sha256, release.size, release.versionCode);
    } finally {
      subscription.remove();
    }
  },
  install: () => native.installAsync(),
});

export function AndroidAppUpdateRow() {
  const state = useSyncExternalStore(updater.subscribe, updater.getSnapshot);
  useFocusEffect(
    useCallback(() => {
      if (updater.getSnapshot().phase === "idle") void updater.check();
    }, []),
  );
  const busy = state.phase === "checking" || state.phase === "downloading" || state.installing;
  const handleCheck = useCallback(() => {
    void updater.check();
  }, []);
  const handleInstall = useCallback(() => {
    if (state.phase === "ready") void updater.install();
    else void updater.downloadAndInstall();
  }, [state.phase]);
  let installLabel = "下载并安装";
  if (state.phase === "ready") installLabel = "继续安装";
  if (state.phase === "downloading") installLabel = `${state.progress}%`;
  const descriptions = {
    idle: "从 finelly977/paseo 获取安卓安装包。",
    checking: "正在检查 GitHub…",
    current: "已是最新安卓版本。",
    available: `发现 v${state.release?.version}，${Math.ceil((state.release?.size ?? 0) / 1048576)} MB。`,
    downloading: `正在下载 ${state.progress}%，完成后校验并打开系统安装确认。`,
    ready: "安装包已通过完整性、版本与签名校验。",
  };
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.row]}>
      <View>
        <Text style={settingsStyles.rowTitle}>安卓应用更新</Text>
        <Text style={settingsStyles.rowHint}>{descriptions[state.phase]}</Text>
        {state.hint ? <Text style={settingsStyles.rowHint}>{state.hint}</Text> : null}
        {state.error ? <Text style={settingsStyles.rowError}>{state.error}</Text> : null}
      </View>
      <View style={styles.actions}>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || state.phase === "ready"}
          onPress={handleCheck}
        >
          {state.phase === "checking" ? "正在检查…" : "检查更新"}
        </Button>
        {state.phase === "available" || state.phase === "ready" || state.phase === "downloading" ? (
          <Button size="sm" disabled={busy} onPress={handleInstall}>
            {installLabel}
          </Button>
        ) : null}
      </View>
      <Text style={settingsStyles.rowHint}>
        更新保留配对与本地设置，不更新所连接主机。首次安装需要安卓系统确认。
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: { flexDirection: "column", alignItems: "stretch", gap: theme.spacing[3] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
