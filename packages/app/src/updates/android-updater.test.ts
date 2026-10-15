import { describe, expect, it, vi } from "vitest";
import { createAndroidUpdater, type AndroidUpdatePort } from "./android-updater";

const release = {
  version: "0.2.3",
  versionCode: 2003,
  url: "https://github.com/finelly977/paseo/releases/download/android-apk-v0.2.3/Paseo-0.2.3-android.apk",
  sha256: "a".repeat(64),
  size: 100,
};
function setup() {
  const port: AndroidUpdatePort = {
    check: vi.fn().mockResolvedValue(release),
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue("installer-opened"),
  };
  return { port, updater: createAndroidUpdater(port) };
}
describe("安卓应用内升级", () => {
  it("防止重复检查和下载，验证通过后才交给系统安装", async () => {
    const { port, updater } = setup();
    await Promise.all([updater.check(), updater.check()]);
    expect(port.check).toHaveBeenCalledTimes(1);
    expect(updater.getSnapshot().phase).toBe("available");
    await Promise.all([updater.downloadAndInstall(), updater.downloadAndInstall()]);
    expect(port.download).toHaveBeenCalledTimes(1);
    expect(port.install).toHaveBeenCalledTimes(1);
    expect(updater.getSnapshot().phase).toBe("ready");
  });
  it("授权未知来源后可继续安装，不重复下载", async () => {
    const { port, updater } = setup();
    vi.mocked(port.install).mockResolvedValueOnce("permission-required");
    await updater.check();
    await updater.downloadAndInstall();
    expect(updater.getSnapshot().hint).toContain("允许 Paseo");
    await updater.install();
    expect(port.download).toHaveBeenCalledTimes(1);
    expect(port.install).toHaveBeenCalledTimes(2);
  });
  it("下载失败保留版本及重试入口，绝不启动安装", async () => {
    const { port, updater } = setup();
    vi.mocked(port.download).mockRejectedValueOnce(new Error("checksum mismatch"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await updater.check();
      await updater.downloadAndInstall();
      expect(port.install).not.toHaveBeenCalled();
      expect(updater.getSnapshot().error).toContain("未安装任何内容");
      await updater.downloadAndInstall();
      expect(port.install).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
  it("检查失败显示错误并允许重试；无新版本明确显示已最新", async () => {
    const { port, updater } = setup();
    vi.mocked(port.check).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(null);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await updater.check();
      expect(updater.getSnapshot().error).toContain("检查失败");
      await updater.check();
      expect(updater.getSnapshot().phase).toBe("current");
    } finally {
      log.mockRestore();
    }
  });
});
