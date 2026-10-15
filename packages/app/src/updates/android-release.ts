import { z } from "zod";

export const ANDROID_RELEASES_URL =
  "https://api.github.com/repos/finelly977/paseo/releases?per_page=100";
const releasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    assets: z.array(
      z.object({
        name: z.string(),
        browser_download_url: z.string(),
        size: z.number().int().positive(),
        digest: z.string().nullable(),
      }),
    ),
  }),
);

export interface AndroidRelease {
  version: string;
  versionCode: number;
  url: string;
  sha256: string;
  size: number;
}

export function selectAndroidRelease(input: {
  releases: unknown;
  installedVersionCode: number;
}): AndroidRelease | null {
  const releases = releasesSchema.parse(input.releases);
  const candidates = releases
    .flatMap((release) => {
      if (release.draft || release.prerelease) return [];
      const match = /^android-apk-v(\d+)\.(\d+)\.(\d+)$/.exec(release.tag_name);
      if (!match) return [];
      const [, major, minor, patch] = match;
      if (Number(minor) > 999 || Number(patch) > 999)
        throw new Error("Android release version out of range");
      const versionCode = Number(major) * 1_000_000 + Number(minor) * 1_000 + Number(patch);
      if (!Number.isSafeInteger(versionCode) || versionCode > 2_100_000_000)
        throw new Error("Invalid Android versionCode");
      return [{ release, versionCode, version: `${major}.${minor}.${patch}` }];
    })
    .filter((candidate) => candidate.versionCode > input.installedVersionCode)
    .sort((a, b) => b.versionCode - a.versionCode);
  if (candidates.length === 0) return null;
  const { release, version, versionCode } = candidates[0];
  const asset = release.assets.find((item) => item.name === `Paseo-${version}-android.apk`);
  if (!asset || !asset.digest || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
    throw new Error("Android release APK or SHA256 is missing");
  }
  const expectedUrl = `https://github.com/finelly977/paseo/releases/download/${release.tag_name}/${asset.name}`;
  if (asset.browser_download_url !== expectedUrl || asset.size > 524_288_000) {
    throw new Error("Untrusted Android release asset");
  }
  return {
    version,
    versionCode,
    url: expectedUrl,
    sha256: asset.digest.slice(7),
    size: asset.size,
  };
}

export async function fetchAndroidRelease(
  installedVersionCode: number,
): Promise<AndroidRelease | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(ANDROID_RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub release request failed: ${response.status}`);
    return selectAndroidRelease({ releases: await response.json(), installedVersionCode });
  } finally {
    clearTimeout(timeout);
  }
}
