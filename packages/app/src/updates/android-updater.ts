import type { AndroidRelease } from "./android-release";

export interface AndroidUpdatePort {
  check: () => Promise<AndroidRelease | null>;
  download: (release: AndroidRelease, progress: (percent: number) => void) => Promise<void>;
  install: () => Promise<"permission-required" | "installer-opened">;
}

export interface AndroidUpdateState {
  phase: "idle" | "checking" | "current" | "available" | "downloading" | "ready";
  release: AndroidRelease | null;
  progress: number;
  installing: boolean;
  hint: string | null;
  error: string | null;
}

export function createAndroidUpdater(port: AndroidUpdatePort) {
  let state: AndroidUpdateState = {
    phase: "idle",
    release: null,
    progress: 0,
    installing: false,
    hint: null,
    error: null,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<AndroidUpdateState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const install = async () => {
    if (state.phase !== "ready" || state.installing) return;
    update({ installing: true, error: null });
    try {
      const result = await port.install();
      update({
        hint:
          result === "permission-required"
            ? "请允许 Paseo 安装应用，返回后点击“继续安装”。"
            : "已打开系统安装确认。安装完成后重新打开 Paseo。",
      });
    } catch (error) {
      console.error("[AndroidUpdater] Cannot open installer", error);
      update({ error: "无法打开安装确认，请重试。" });
    } finally {
      update({ installing: false });
    }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check: async () => {
      if (state.phase === "checking" || state.phase === "downloading" || state.phase === "ready")
        return;
      const previousPhase = state.phase;
      update({ phase: "checking", error: null, hint: null });
      try {
        const release = await port.check();
        update({ phase: release ? "available" : "current", release });
      } catch (error) {
        console.error("[AndroidUpdater] GitHub update check failed", error);
        update({ phase: previousPhase, error: "检查失败，请确认能访问 GitHub 后重试。" });
      }
    },
    downloadAndInstall: async () => {
      if (state.phase !== "available" || !state.release) return;
      const release = state.release;
      update({ phase: "downloading", progress: 0, error: null, hint: null });
      try {
        await port.download(release, (progress) => update({ progress }));
        update({ phase: "ready" });
      } catch (error) {
        console.error("[AndroidUpdater] APK download or validation failed", error);
        update({ phase: "available", error: "下载或安全校验失败，未安装任何内容。请重新下载。" });
        return;
      }
      await install();
    },
    install,
  };
}
