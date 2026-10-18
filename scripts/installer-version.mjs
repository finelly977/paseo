import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkWorkspaceVersionConsistency } from "./check-workspace-version-consistency.mjs";
import { computeNextReleaseVersion } from "./release-version-utils.mjs";

const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionNumber(version) {
  const match = versionPattern.exec(version);
  if (!match || Number(match[2]) > 999 || Number(match[3]) > 999)
    throw new Error("自动安装包升版仅支持 X.Y.Z 正式版本，超过版本编码边界需要人工处理");
  const code = Number(match[1]) * 1_000_000 + Number(match[2]) * 1000 + Number(match[3]);
  if (!Number.isSafeInteger(code) || code <= 0 || code > 2_100_000_000)
    throw new Error("安装包版本超出安卓编码范围，需要人工处理");
  return code;
}

export function planInstallerVersion({ platform, version, releases }) {
  if (platform !== "windows" && platform !== "android")
    throw new Error("安装包平台必须是 windows 或 android");
  const current = versionNumber(version);
  const prefix = platform === "windows" ? "windows-installer-v" : "android-apk-v";
  const tag = `${prefix}${version}`;
  if (releases.some((release) => release.tagName === tag && release.isDraft)) return version;
  let highestVersion = version;
  let highest = current;
  for (const release of releases) {
    if (release.isDraft) continue;
    const match = /^(?:windows-installer|android-apk)-v(\d+\.\d+\.\d+)$/.exec(release.tagName);
    if (!match) continue;
    const numeric = versionNumber(match[1]);
    if (numeric > highest) {
      highest = numeric;
      highestVersion = match[1];
    }
  }
  const alreadyPublished = releases.some((release) => release.tagName === tag && !release.isDraft);
  if (!alreadyPublished && current >= highest) return version;
  const next = computeNextReleaseVersion(highestVersion, "patch");
  versionNumber(next);
  if (releases.some((release) => release.tagName === `${prefix}${next}`))
    throw new Error(`${prefix}${next} 已有草稿，请先检查归属，不能自动覆盖或跳过未完成发布`);
  return next;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assertConsistent(rootDir) {
  const result = checkWorkspaceVersionConsistency(rootDir);
  if (result.errors.length) throw new Error(result.errors.join("\n"));
  return result.rootVersion;
}

export function writeInstallerVersion(rootDir, version) {
  const previousVersion = assertConsistent(rootDir);
  if (versionNumber(version) <= versionNumber(previousVersion))
    throw new Error("自动升版必须递增，不能覆盖或回退版本");
  const rootPackage = readJson(path.join(rootDir, "package.json"));
  const lock = readJson(path.join(rootDir, "package-lock.json"));
  const updates = [];
  rootPackage.version = version;
  updates.push({ file: "package.json", data: rootPackage });
  lock.version = version;
  lock.packages[""].version = version;
  for (const workspace of rootPackage.workspaces) {
    const file = `${workspace}/package.json`;
    const pkg = readJson(path.join(rootDir, file));
    const lockPackage = lock.packages[workspace];
    pkg.version = version;
    lockPackage.version = version;
    const range = pkg.private === true ? "*" : version;
    for (const section of dependencySections) {
      if (!Object.hasOwn(pkg, section)) continue;
      for (const name of Object.keys(pkg[section])) {
        if (!name.startsWith("@getpaseo/")) continue;
        pkg[section][name] = range;
        lockPackage[section][name] = range;
      }
    }
    updates.push({ file, data: pkg });
  }
  updates.push({ file: "package-lock.json", data: lock });
  for (const { file, data } of updates)
    writeFileSync(path.join(rootDir, file), `${JSON.stringify(data, null, 2)}\n`);
  assertConsistent(rootDir);
  return updates.map(({ file }) => file);
}

function preparationPath(rootDir) {
  return path.join(rootDir, ".output", "releases", "version-preparation.json");
}

function sameFiles(actual, expected) {
  return actual.length === expected.length && actual.every((file) => expected.includes(file));
}

function nulList(value) {
  return value.split("\0").filter(Boolean);
}

export function commitInstallerVersion({ rootDir, version, baseCommit, git }) {
  if (
    git(["branch", "--show-current"], true) !== "main" ||
    git(["rev-parse", "HEAD"], true) !== baseCommit ||
    git(["status", "--porcelain"], true)
  )
    throw new Error("升版前源码或分支发生变化，请先提交并同步 main 产品改动，不会自动提交源码");
  const files = writeInstallerVersion(rootDir, version);
  const status = nulList(git(["status", "--porcelain", "-z"], true));
  if (
    !sameFiles(
      status.map((entry) => entry.slice(3)),
      files,
    ) ||
    status.some((entry) => entry.slice(0, 2) !== " M")
  )
    throw new Error("升版期间出现版本文件之外的改动，停止提交；请检查版本文件及其他未提交编辑");
  git(["add", "--", ...files]);
  const staged = nulList(git(["diff", "--cached", "--name-only", "-z"], true));
  if (!sameFiles(staged, files)) throw new Error("暂存区包含本次升版之外的文件，停止提交");
  git(["commit", "-m", `准备安装包版本 ${version}`, "-m", `Paseo-Installer-Version: ${version}`]);
  const commit = git(["rev-parse", "HEAD"], true);
  const record = { version, baseCommit, commit, files };
  const recordPath = preparationPath(rootDir);
  mkdirSync(path.dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  if (git(["status", "--porcelain"], true))
    throw new Error("版本提交后出现其他改动，尚未推送；请先检查并处理");
  return record;
}

export function pushPreparedInstallerVersion({ rootDir, commit, remoteCommit, git }) {
  const recordPath = preparationPath(rootDir);
  if (!existsSync(recordPath))
    throw new Error("main 尚未同步到 origin，请先推送产品改动；脚本只自动推送自己创建的版本提交");
  const record = readJson(recordPath);
  if (
    record.commit !== commit ||
    record.baseCommit !== remoteCommit ||
    record.version !== assertConsistent(rootDir)
  )
    throw new Error(
      "main 与远端或自动升版记录不一致，请先人工同步，不会自动推送产品改动或覆盖远端",
    );
  const parent = git(["rev-parse", `${commit}^`], true);
  const rootPackage = readJson(path.join(rootDir, "package.json"));
  const versionFiles = [
    "package.json",
    "package-lock.json",
    ...rootPackage.workspaces.map((workspace) => `${workspace}/package.json`),
  ];
  const changed = nulList(
    git(["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit], true),
  );
  const message = git(["log", "-1", "--format=%B", commit], true);
  if (
    parent !== record.baseCommit ||
    !sameFiles(changed, versionFiles) ||
    !sameFiles(record.files, versionFiles) ||
    !message.split("\n").includes(`Paseo-Installer-Version: ${record.version}`)
  )
    throw new Error("自动版本提交校验失败，拒绝推送非本次准备的内容");
  if (
    git(["branch", "--show-current"], true) !== "main" ||
    git(["rev-parse", "HEAD"], true) !== commit ||
    git(["status", "--porcelain"], true)
  )
    throw new Error("推送版本前源码发生变化，请先检查工作区");
  git(["push", "origin", `${commit}:refs/heads/main`]);
  return commit;
}
