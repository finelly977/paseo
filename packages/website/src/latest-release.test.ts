import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLatestAndroidVersionFromReleases,
  getLatestReleaseInfo,
  type GitHubRelease,
} from "./latest-release";
import { downloadUrls, getDownloadOptions } from "./downloads";

function release({
  version,
  hasApk,
  prerelease = false,
}: {
  version: string;
  hasApk: boolean;
  prerelease?: boolean;
}): GitHubRelease {
  const tag = `v${version}`;
  return {
    tag_name: tag,
    assets: hasApk ? [{ name: `paseo-${tag}-android.apk` }] : [],
    prerelease,
    draft: false,
  };
}

describe("getLatestAndroidVersionFromReleases", () => {
  it("selects the latest stable release that contains an Android APK", () => {
    const releases = [
      release({ version: "0.1.109", hasApk: true, prerelease: true }),
      release({ version: "0.1.108", hasApk: false }),
      release({ version: "0.1.107", hasApk: true }),
    ];

    expect(getLatestAndroidVersionFromReleases(releases)).toBe("0.1.107");
  });
});

describe("二开网站发布来源", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("从二开仓库读取发布数据，并生成同一仓库的下载地址", async () => {
    const fetchRelease = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            tag_name: "v0.2.5",
            prerelease: false,
            draft: false,
            assets: [
              { name: "Paseo-0.2.5-arm64.dmg" },
              { name: "Paseo-x86_64.AppImage" },
              { name: "Paseo-Setup-0.2.5-x64.exe" },
            ],
          },
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetchRelease);
    const info = await getLatestReleaseInfo({ cache: null, waitUntil: vi.fn() });
    expect(fetchRelease).toHaveBeenCalledWith(
      "https://api.github.com/repos/finelly977/paseo/releases?per_page=10",
      expect.any(Object),
    );
    const urls = downloadUrls(info);
    expect(urls.windowsExeX64).toBe(
      "https://github.com/finelly977/paseo/releases/download/v0.2.5/Paseo-Setup-0.2.5-x64.exe",
    );
    expect(urls.macAppleSilicon).toBe(
      "https://github.com/finelly977/paseo/releases/download/v0.2.5/Paseo-0.2.5-arm64.dmg",
    );
  });

  it("二开发布读取失败时明确报错，不切回原作者的发布源", async () => {
    const fetchRelease = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));
    vi.stubGlobal("fetch", fetchRelease);
    await expect(getLatestReleaseInfo({ cache: null, waitUntil: vi.fn() })).rejects.toThrow(
      "github releases 404",
    );
    expect(fetchRelease).toHaveBeenCalledTimes(1);
  });

  it("只发布 Windows 与 Android 时仍能加载，且不生成其他平台下载链接", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              tag_name: "v0.2.5",
              prerelease: false,
              draft: false,
              assets: [{ name: "Paseo-Setup-0.2.5-x64.exe" }, { name: "paseo-v0.2.5-android.apk" }],
            },
          ]),
        ),
      ),
    );
    const info = await getLatestReleaseInfo({ cache: null, waitUntil: vi.fn() });
    expect(downloadUrls(info)).toEqual({
      macAppleSilicon: null,
      macIntel: null,
      linuxAppImage: null,
      linuxDeb: null,
      linuxRpm: null,
      windowsExeX64:
        "https://github.com/finelly977/paseo/releases/download/v0.2.5/Paseo-Setup-0.2.5-x64.exe",
      windowsExeArm64: null,
      androidApk:
        "https://github.com/finelly977/paseo/releases/download/v0.2.5/paseo-v0.2.5-android.apk",
    });
    expect(getDownloadOptions(info).map((option) => option.platform)).toEqual(["windows"]);
  });

  it("保留二开 Windows 安装器的真实标签，不拼成不存在的 v 标签", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              tag_name: "windows-installer-v0.2.5",
              prerelease: false,
              draft: false,
              assets: [{ name: "Paseo-Setup-0.2.5-x64.exe" }],
            },
          ]),
        ),
      ),
    );
    const info = await getLatestReleaseInfo({ cache: null, waitUntil: vi.fn() });
    expect(info.version).toBe("0.2.5");
    expect(downloadUrls(info).windowsExeX64).toBe(
      "https://github.com/finelly977/paseo/releases/download/windows-installer-v0.2.5/Paseo-Setup-0.2.5-x64.exe",
    );
  });
});
