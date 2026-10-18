import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dump, load } from "js-yaml";
import { checkWorkspaceVersionConsistency } from "./check-workspace-version-consistency.mjs";
import {
  commitInstallerVersion,
  planInstallerVersion,
  pushPreparedInstallerVersion,
} from "./installer-version.mjs";

const repo = "finelly977/paseo";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function getInstallerRelease(platform, version) {
  if (platform !== "windows" && platform !== "android") {
    throw new Error("安装包平台必须是 windows 或 android");
  }
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  const code = match && Number(match[1]) * 1_000_000 + Number(match[2]) * 1_000 + Number(match[3]);
  if (
    !match ||
    Number(match[2]) > 999 ||
    Number(match[3]) > 999 ||
    code <= 0 ||
    code > 2_100_000_000
  ) {
    throw new Error("安装包仅支持可编码成安卓版本号的 X.Y.Z 正式版本");
  }
  if (platform === "windows") {
    return {
      platform,
      version,
      tag: `windows-installer-v${version}`,
      title: `Paseo Windows v${version}`,
      installer: `Paseo-Setup-${version}-x64.exe`,
      latest: true,
    };
  }
  return {
    platform,
    version,
    tag: `android-apk-v${version}`,
    title: `Paseo 安卓 v${version}`,
    installer: `Paseo-${version}-android.apk`,
    latest: false,
  };
}

export function assertPublishSource({ origin, branch, changes, commit, remoteCommit }) {
  if (
    !/^(https:\/\/github\.com\/finelly977\/paseo(?:\.git)?|git@github\.com:finelly977\/paseo(?:\.git)?)$/.test(
      origin,
    )
  ) {
    throw new Error("origin 必须指向二开 finelly977/paseo，拒绝向原作者或其他仓库发布");
  }
  if (changes)
    throw new Error(
      "请先提交产品改动并清空工作区，再点击发布；脚本只自动提交自己生成的版本文件，不提交或丢弃其他编辑",
    );
  if (branch !== "main") throw new Error("请先把待发布改动合并到二开 main，再从 main 点击发布");
  if (commit !== remoteCommit)
    throw new Error("本地 main 与 origin/main 不一致，请先同步并推送待发布提交");
}

export function assertReleaseVersion(release, releases) {
  const prefix = release.platform === "windows" ? "windows-installer-v" : "android-apk-v";
  const numeric = (version) =>
    version.split(".").reduce((code, part) => code * 1000 + Number(part), 0);
  for (const published of releases) {
    if (published.isDraft || !published.tagName.startsWith(prefix)) continue;
    const version = published.tagName.slice(prefix.length);
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    if (numeric(version) >= numeric(release.version)) {
      throw new Error(
        `${published.tagName} 已发布，拒绝覆盖或回退。当前草稿或版本规划已过期，请先检查未完成发布`,
      );
    }
  }
}

function run(program, args, capture = false, environment = process.env) {
  const result = spawnSync(program, args, {
    cwd: root,
    env: { ...environment, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${program} 执行失败（退出代码 ${result.status}）${capture ? `\n${result.stderr}\n${result.stdout}` : ""}`,
    );
  }
  return capture ? result.stdout.trimEnd() : "";
}

function gh(args, capture = false) {
  return run("gh", [...args, "--repo", repo], capture);
}

function git(args, capture = false) {
  return run("git", args, capture);
}

function inspectSource({ resumeVersionPush = false } = {}) {
  const origin = run("git", ["remote", "get-url", "--push", "origin"], true);
  const branch = run("git", ["branch", "--show-current"], true);
  const changes = run("git", ["status", "--porcelain"], true);
  const commit = run("git", ["rev-parse", "HEAD"], true);
  assertPublishSource({ origin, branch, changes, commit, remoteCommit: commit });
  let remote = run("git", ["ls-remote", "origin", "refs/heads/main"], true);
  let remoteCommit = remote.split(/\s/)[0];
  if (commit !== remoteCommit && resumeVersionPush) {
    console.log("检测到待推送的本次自动版本提交，校验后继续推送，不重复升版。");
    pushPreparedInstallerVersion({ rootDir: root, commit, remoteCommit, git });
    remote = run("git", ["ls-remote", "origin", "refs/heads/main"], true);
    remoteCommit = remote.split(/\s/)[0];
  }
  assertPublishSource({ origin, branch, changes, commit, remoteCommit });
  return commit;
}

function powershell(script, args = []) {
  const environment = {
    ...process.env,
    APP_VARIANT: "production",
    NODE_ENV: "production",
    CI: "1",
    EXPO_NO_TELEMETRY: "1",
  };
  for (const key of ["PASEO_WEB_PLATFORM", "EXPO_PUBLIC_LOCAL_DAEMON", "PASEO_FDROID_BUILD"])
    delete environment[key];
  run(
    "pwsh.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "scripts", script),
      ...args,
    ],
    false,
    environment,
  );
}

export function describeAsset(filePath) {
  const bytes = readFileSync(filePath);
  return {
    name: path.basename(filePath),
    size: bytes.length,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

export function verifyReleaseAssets({ assets, expected }) {
  if (expected.length === 0) throw new Error("安装包资产清单为空，拒绝发布");
  for (const item of expected) {
    const uploaded = assets.find((asset) => asset.name === item.name);
    if (!uploaded || uploaded.size !== item.size || uploaded.digest !== item.digest) {
      throw new Error(`GitHub 资产校验未通过：${item.name}。草稿保留，不会发布错误安装包`);
    }
  }
}

function acquireLock() {
  const lockPath = path.join(root, ".output", "installers-release.lock");
  mkdirSync(path.dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    const { pid } = JSON.parse(readFileSync(lockPath, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`发布锁损坏，请检查：${lockPath}`);
    try {
      process.kill(pid, 0);
      throw new Error("已有安装包构建发布任务正在运行，请等待它结束，不要同时点击两个入口");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      rmSync(lockPath);
    }
  }
  const descriptor = openSync(lockPath, "wx");
  writeFileSync(descriptor, JSON.stringify({ pid: process.pid }));
  closeSync(descriptor);
  return () => rmSync(lockPath);
}

function readDraft(release, commit) {
  const draft = JSON.parse(
    gh(["release", "view", release.tag, "--json", "tagName,targetCommitish,isDraft,assets"], true),
  );
  if (!draft.isDraft)
    throw new Error("该版本已正式发布，不能继续作为草稿覆盖，请重新运行以规划下一版本");
  if (draft.tagName !== release.tag || draft.targetCommitish !== commit) {
    throw new Error("同名草稿不属于当前发布提交，请检查 GitHub 草稿，不会覆盖其他源码的安装包");
  }
  return draft;
}

export function prepareWindowsManifest({ manifestPath, installerPath, version }) {
  const bytes = readFileSync(installerPath);
  const sha512 = createHash("sha512").update(bytes).digest("base64");
  const name = path.basename(installerPath);
  const manifest = load(readFileSync(manifestPath, "utf8"));
  const file = manifest.files[0];
  if (
    manifest.version !== version ||
    manifest.files.length !== 1 ||
    file.url !== name ||
    file.size !== bytes.length ||
    file.sha512 !== sha512 ||
    manifest.path !== name ||
    manifest.sha512 !== sha512
  ) {
    throw new Error("Windows 更新清单与本次安装包不一致，拒绝发布陈旧产物");
  }
  manifest.releaseDate = new Date().toISOString();
  manifest.rolloutHours = 0;
  writeFileSync(manifestPath, dump(manifest, { lineWidth: -1, noRefs: true }));
}

function build(release, directory) {
  let names;
  if (release.platform === "windows") {
    powershell("build-desktop-windows.ps1");
    const output = path.join(root, "packages", "desktop", "release");
    names = [release.installer, `${release.installer}.blockmap`, "latest.yml"];
    prepareWindowsManifest({
      manifestPath: path.join(output, "latest.yml"),
      installerPath: path.join(output, release.installer),
      version: release.version,
    });
    for (const name of names) copyFileSync(path.join(output, name), path.join(directory, name));
  } else {
    powershell("build-android-apk.ps1", ["-OutputDirectory", directory]);
    names = [release.installer];
  }
  const installer = path.join(directory, release.installer);
  const asset = describeAsset(installer);
  const checksum = `${release.installer}.sha256`;
  writeFileSync(path.join(directory, checksum), `${asset.digest.slice(7)}  ${release.installer}\n`);
  return [...names, checksum].map((name) => describeAsset(path.join(directory, name)));
}

export function publishDraft({ release, commit, directory, expected, command }) {
  let draft = JSON.parse(
    command(
      ["release", "view", release.tag, "--json", "tagName,targetCommitish,isDraft,assets"],
      true,
    ),
  );
  if (!draft.isDraft || draft.tagName !== release.tag || draft.targetCommitish !== commit) {
    throw new Error("目标不是当前提交的发布草稿，拒绝修改");
  }
  if (draft.assets.some((asset) => !expected.some((item) => item.name === asset.name))) {
    throw new Error("草稿包含本次构建之外的资产，请先人工检查，不会自动公开未知文件");
  }
  for (const item of expected) {
    const existing = draft.assets.find((asset) => asset.name === item.name);
    if (existing) {
      verifyReleaseAssets({ assets: [existing], expected: [item] });
    } else {
      command(["release", "upload", release.tag, path.join(directory, item.name)]);
    }
  }
  draft = JSON.parse(
    command(["release", "view", release.tag, "--json", "assets,isDraft,targetCommitish"], true),
  );
  if (!draft.isDraft || draft.targetCommitish !== commit)
    throw new Error("上传期间草稿被外部修改，停止发布");
  verifyReleaseAssets({ assets: draft.assets, expected });
  command([
    "release",
    "edit",
    release.tag,
    "--target",
    commit,
    "--draft=false",
    `--latest=${release.latest}`,
  ]);
}

function executeRelease(platform, checkOnly) {
  const consistency = checkWorkspaceVersionConsistency(root);
  if (consistency.errors.length) throw new Error(consistency.errors.join("\n"));
  getInstallerRelease(platform, consistency.rootVersion);
  run("pwsh.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], true);
  let commit = inspectSource({ resumeVersionPush: !checkOnly });
  run("gh", ["auth", "status"]);
  const repository = JSON.parse(run("gh", ["repo", "view", repo, "--json", "isPrivate"], true));
  if (repository.isPrivate)
    throw new Error("应用内更新需要公开 GitHub 发布，二开仓库当前为私有，停止发布");
  const releases = JSON.parse(
    gh(["release", "list", "--limit", "1000", "--json", "tagName,isDraft"], true),
  );
  const version = planInstallerVersion({ platform, version: consistency.rootVersion, releases });
  const release = getInstallerRelease(platform, version);
  assertReleaseVersion(release, releases);
  const existing = releases.find((item) => item.tagName === release.tag);
  if (existing) readDraft(release, commit);
  if (release.platform === "android") powershell("build-android-apk.ps1", ["-CheckOnly"]);
  if (checkOnly) {
    console.log(`检查通过：将发布 ${release.title}，当前源码 ${commit}。`);
    if (version !== consistency.rootVersion)
      console.log(
        `正式运行时将自动升版 ${consistency.rootVersion} → ${version}，仅提交并推送版本文件。`,
      );
    console.log("本次仅检查：未改版本、未提交推送、未构建、未发布。");
    return;
  }
  if (!existing) {
    for (const check of ["typecheck", "lint"]) {
      run("pwsh.exe", ["-NoProfile", "-Command", `& npm.cmd run ${check}; exit $LASTEXITCODE`]);
    }
  }
  if (version !== consistency.rootVersion) {
    if (inspectSource() !== commit) throw new Error("准备升版前源码已变化，停止发布");
    console.log(`自动升版 ${consistency.rootVersion} → ${version}，仅同步、提交和推送版本文件。`);
    const prepared = commitInstallerVersion({ rootDir: root, version, baseCommit: commit, git });
    pushPreparedInstallerVersion({
      rootDir: root,
      commit: prepared.commit,
      remoteCommit: commit,
      git,
    });
    commit = prepared.commit;
    if (inspectSource() !== commit) throw new Error("版本提交未正确同步到 origin/main，停止发布");
  }
  const directory = path.join(root, ".output", "releases", release.tag);
  mkdirSync(directory, { recursive: true });
  const recordPath = path.join(directory, "artifacts.json");
  let expected;
  if (existing) {
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    if (record.commit !== commit) throw new Error("本地续传记录与当前提交不一致，不会复用旧安装包");
    expected = record.assets;
    const local = expected.map((asset) => describeAsset(path.join(directory, asset.name)));
    verifyReleaseAssets({ assets: local, expected });
    console.log("继续校验并上传原草稿，复用上次成功构建的安装包。 ");
  } else {
    console.log(`开始构建：${release.title}。完成后将发布到 https://github.com/${repo}/releases`);
    expected = build(release, directory);
    writeFileSync(recordPath, `${JSON.stringify({ commit, assets: expected }, null, 2)}\n`);
  }
  if (inspectSource() !== commit) throw new Error("构建期间源码提交已变化，拒绝发布，请重新构建");
  if (!existing) {
    const notes = `${release.title}\n\n源码：[${commit.slice(0, 10)}](https://github.com/${repo}/commit/${commit})\n\n${release.platform === "android" ? "安卓 10 及以上，ARM64 手机与 x86_64 模拟器；沿用已分发侧载测试签名，停用上游 OTA。" : "Windows x64 NSIS 安装包，包含自动更新清单和差分文件。"}\n\n当前二开功能见 [功能清单](https://github.com/${repo}/blob/${commit}/docs/fork-features.md)。\n`;
    const notesPath = path.join(directory, "notes.md");
    writeFileSync(notesPath, notes);
    gh([
      "release",
      "create",
      release.tag,
      "--target",
      commit,
      "--draft",
      "--title",
      release.title,
      "--notes-file",
      notesPath,
    ]);
  }
  publishDraft({ release, commit, directory, expected, command: gh });
  console.log(
    `已发布：https://github.com/${repo}/releases/tag/${release.tag}\n本地产物：${directory}`,
  );
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== "--check")) {
    throw new Error(
      "用法：node scripts/publish-installers.mjs windows|android [--check]；--check 只读检查，不改版本、不提交推送、不构建或发布",
    );
  }
  if (process.platform !== "win32")
    throw new Error("这两个本地打包入口需要在已配置构建环境的 Windows 主机运行");
  if (args[1] === "--check") {
    executeRelease(args[0], true);
    return;
  }
  const unlock = acquireLock();
  try {
    executeRelease(args[0], false);
  } finally {
    unlock();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.stack);
    console.error(
      "发布未完成。已准备但未发布的版本会继续使用，不因失败重复升版；若已生成草稿，请保留 .output/releases 中的原产物并重试。仅本流程创建的版本提交会自动继续推送，产品源码仍需先提交并同步；已公开版本不会被覆盖。",
    );
    process.exitCode = 1;
  }
}
