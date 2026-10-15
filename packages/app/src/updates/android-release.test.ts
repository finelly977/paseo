import { describe, expect, it, vi } from "vitest";
import { fetchAndroidRelease, selectAndroidRelease } from "./android-release";

const release = (version: string) => ({
  tag_name: `android-apk-v${version}`,
  draft: false,
  prerelease: false,
  assets: [
    {
      name: `Paseo-${version}-android.apk`,
      size: 100,
      browser_download_url: `https://github.com/finelly977/paseo/releases/download/android-apk-v${version}/Paseo-${version}-android.apk`,
      digest: `sha256:${"a".repeat(64)}`,
    },
  ],
});
describe("二开安卓发布源", () => {
  it("只选择版本最高且高于已安装版本的安卓正式包", () => {
    const releases = [
      release("0.2.3"),
      release("0.2.5"),
      { ...release("0.2.9"), prerelease: true },
      { ...release("0.2.8"), draft: true },
      { ...release("9.0.0"), tag_name: "v9.0.0" },
    ];
    expect(selectAndroidRelease({ releases, installedVersionCode: 2002 })?.versionCode).toBe(2005);
    expect(selectAndroidRelease({ releases, installedVersionCode: 2005 })).toBeNull();
  });
  it.each(["digest", "url", "missing", "size"])("拒绝不可信或不完整的包：%s", (kind) => {
    const item = release("0.2.3");
    if (kind === "digest") item.assets[0].digest = "sha256:bad";
    if (kind === "url") item.assets[0].browser_download_url = "https://example.com/update.apk";
    if (kind === "missing") item.assets = [];
    if (kind === "size") item.assets[0].size = 600_000_000;
    expect(() => selectAndroidRelease({ releases: [item], installedVersionCode: 2002 })).toThrow();
  });
  it("不将 GitHub 请求失败伪装成已是最新", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    try {
      await expect(fetchAndroidRelease(2002)).rejects.toThrow("403");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
