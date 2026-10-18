import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { dump, load } from "js-yaml";
import {
  assertPublishSource,
  assertReleaseVersion,
  describeAsset,
  getInstallerRelease,
  prepareWindowsManifest,
  publishDraft,
} from "./publish-installers.mjs";

test("两个菜单入口使用独立标签，只有 Windows 推进桌面更新", () => {
  assert.deepEqual(getInstallerRelease("windows", "0.2.4"), {
    platform: "windows",
    version: "0.2.4",
    tag: "windows-installer-v0.2.4",
    title: "Paseo Windows v0.2.4",
    installer: "Paseo-Setup-0.2.4-x64.exe",
    latest: true,
  });
  assert.deepEqual(getInstallerRelease("android", "0.2.4"), {
    platform: "android",
    version: "0.2.4",
    tag: "android-apk-v0.2.4",
    title: "Paseo 安卓 v0.2.4",
    installer: "Paseo-0.2.4-android.apk",
    latest: false,
  });
});

test("发布不替用户提交推送产品代码或切分支，源码不符合条件立即失败", () => {
  const source = {
    origin: "https://github.com/finelly977/paseo.git",
    branch: "main",
    changes: "",
    commit: "abc123",
    remoteCommit: "abc123",
  };
  assert.doesNotThrow(() => assertPublishSource(source));
  assert.throws(() => assertPublishSource({ ...source, changes: " M README.md" }), /提交/);
  assert.throws(() => assertPublishSource({ ...source, branch: "fix/demo" }), /main/);
  assert.throws(() => assertPublishSource({ ...source, remoteCommit: "old" }), /推送/);
  assert.throws(
    () => assertPublishSource({ ...source, origin: "https://github.com/getpaseo/paseo.git" }),
    /二开/,
  );
});

test("拒绝未知平台、预发布和不能编码成安卓版本号的版本", () => {
  assert.throws(() => getInstallerRelease("ios", "0.2.4"), /windows 或 android/);
  for (const version of ["0.2.4-beta.1", "v0.2.4", "0.2.1000", "0.1000.0", "01.2.3"]) {
    assert.throws(() => getInstallerRelease("android", version), /正式版本/);
  }
});

test("已公开版本不能覆盖或回退，另一平台与本次草稿不阻止发布", () => {
  const release = getInstallerRelease("windows", "0.2.4");
  assert.throws(
    () => assertReleaseVersion(release, [{ tagName: release.tag, isDraft: false }]),
    /已发布/,
  );
  assert.throws(
    () => assertReleaseVersion(release, [{ tagName: "windows-installer-v0.3.0", isDraft: false }]),
    /回退/,
  );
  assert.doesNotThrow(() =>
    assertReleaseVersion(release, [
      { tagName: "android-apk-v0.3.0", isDraft: false },
      { tagName: release.tag, isDraft: true },
      { tagName: "windows-installer-v0.2.3", isDraft: false },
    ]),
  );
});

function createDraftFixture(t, platform = "windows") {
  const directory = mkdtempSync(path.join(tmpdir(), "paseo-installer-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = getInstallerRelease(platform, "0.2.4");
  const installerPath = path.join(directory, release.installer);
  writeFileSync(installerPath, "本次测试构建的安装包");
  const expected = [describeAsset(installerPath)];
  const draft = { tagName: release.tag, targetCommitish: "abc123", isDraft: true, assets: [] };
  const calls = [];
  function command(args) {
    calls.push(args);
    if (args[1] === "view") return JSON.stringify(draft);
    if (args[1] === "upload") {
      draft.assets.push(describeAsset(args[3]));
      return "";
    }
    if (args[1] === "edit") {
      draft.isDraft = false;
      return "";
    }
    throw new Error(`未实现的测试发布命令：${args.join(" ")}`);
  }
  return { directory, release, expected, draft, command, calls, commit: "abc123" };
}

test("上传并验证成功后才公开 Windows 版本，同时推进桌面更新", (t) => {
  const fixture = createDraftFixture(t);
  publishDraft(fixture);
  assert.equal(fixture.draft.isDraft, false);
  assert.deepEqual(fixture.draft.assets, fixture.expected);
  assert.deepEqual(
    fixture.calls.map((args) => args[1]),
    ["view", "upload", "view", "edit"],
  );
  assert.deepEqual(fixture.calls.at(-1), [
    "release",
    "edit",
    fixture.release.tag,
    "--target",
    "abc123",
    "--draft=false",
    "--latest=true",
  ]);
});

test("安卓草稿重试复用匹配资产，不重复上传，也不覆盖桌面 latest", (t) => {
  const fixture = createDraftFixture(t, "android");
  fixture.draft.assets.push(fixture.expected[0]);
  publishDraft(fixture);
  assert.deepEqual(
    fixture.calls.map((args) => args[1]),
    ["view", "view", "edit"],
  );
  assert.equal(fixture.calls.at(-1).at(-1), "--latest=false");
});

test("资产摘要错误时保留草稿，不公开、不覆盖已经上传的文件", (t) => {
  const fixture = createDraftFixture(t);
  fixture.draft.assets.push({ ...fixture.expected[0], digest: "sha256:错误摘要" });
  assert.throws(() => publishDraft(fixture), /资产校验未通过/);
  assert.equal(fixture.draft.isDraft, true);
  assert.deepEqual(
    fixture.calls.map((args) => args[1]),
    ["view"],
  );
});

test("上传中断后保留草稿，下次点击只上传缺失文件", (t) => {
  const fixture = createDraftFixture(t);
  const checksum = path.join(fixture.directory, `${fixture.release.installer}.sha256`);
  writeFileSync(checksum, "测试校验文件");
  fixture.expected.push(describeAsset(checksum));
  const command = (args) => {
    if (args[1] === "upload" && args[3] === checksum) throw new Error("网络连接中断");
    return fixture.command(args);
  };
  assert.throws(() => publishDraft({ ...fixture, command }), /网络连接中断/);
  assert.equal(fixture.draft.isDraft, true);
  assert.deepEqual(fixture.draft.assets, [fixture.expected[0]]);
  fixture.calls.length = 0;
  publishDraft(fixture);
  assert.deepEqual(
    fixture.calls.filter((args) => args[1] === "upload"),
    [["release", "upload", fixture.release.tag, checksum]],
  );
  assert.deepEqual(fixture.draft.assets, fixture.expected);
  assert.equal(fixture.draft.isDraft, false);
});

test("拒绝正式版本、其他提交的草稿和额外未知资产", (t) => {
  const published = createDraftFixture(t);
  published.draft.isDraft = false;
  assert.throws(() => publishDraft(published), /不是当前提交的发布草稿/);
  const otherCommit = createDraftFixture(t);
  otherCommit.draft.targetCommitish = "其他源码";
  assert.throws(() => publishDraft(otherCommit), /不是当前提交的发布草稿/);
  const unknown = createDraftFixture(t);
  unknown.draft.assets.push({ name: "不应公开的密钥文件" });
  assert.throws(() => publishDraft(unknown), /之外的资产/);
});

test("Windows 清单必须指向当前安装包，再写入即时更新标记", (t) => {
  const fixture = createDraftFixture(t);
  const installerPath = path.join(fixture.directory, fixture.release.installer);
  const bytes = readFileSync(installerPath);
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  const manifestPath = path.join(fixture.directory, "latest.yml");
  const manifest = {
    version: "0.2.4",
    path: fixture.release.installer,
    sha512,
    files: [{ url: fixture.release.installer, sha512, size: bytes.length }],
  };
  writeFileSync(manifestPath, dump(manifest));
  prepareWindowsManifest({ manifestPath, installerPath, version: "0.2.4" });
  const prepared = load(readFileSync(manifestPath, "utf8"));
  assert.equal(prepared.rolloutHours, 0);
  assert.equal(new Date(prepared.releaseDate).toISOString(), prepared.releaseDate);
  assert.deepEqual(prepared.files, manifest.files);
  writeFileSync(manifestPath, dump({ ...manifest, version: "0.2.3" }));
  assert.throws(
    () => prepareWindowsManifest({ manifestPath, installerPath, version: "0.2.4" }),
    /陈旧产物/,
  );
});

test("根配置暴露两个任务按钮，直接执行跨 shell 的 Node 入口", () => {
  const config = JSON.parse(readFileSync(new URL("../paseo.json", import.meta.url), "utf8"));
  assert.deepEqual(config.scripts["打包并发布 Windows"], {
    command: "node ./scripts/publish-installers.mjs windows",
  });
  assert.deepEqual(config.scripts["打包并发布 Android"], {
    command: "node ./scripts/publish-installers.mjs android",
  });
  assert.equal(config.scripts.desktop.type, "service");
});

test("安卓环境检查使用明确的独立命令，避免参数丢失后误触发完整构建", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(
    pkg.scripts["build:android:apk:check"],
    "pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/build-android-apk.ps1 -CheckOnly",
  );
});
