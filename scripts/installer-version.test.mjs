import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkWorkspaceVersionConsistency } from "./check-workspace-version-consistency.mjs";
import {
  commitInstallerVersion,
  planInstallerVersion,
  pushPreparedInstallerVersion,
  writeInstallerVersion,
} from "./installer-version.mjs";

const released = (tagName) => ({ tagName, isDraft: false });

test("当前平台已发布时自动使用下一补丁版本", () => {
  assert.equal(
    planInstallerVersion({
      platform: "windows",
      version: "0.2.3",
      releases: [released("windows-installer-v0.2.3")],
    }),
    "0.2.4",
  );
  assert.equal(
    planInstallerVersion({
      platform: "android",
      version: "0.2.3",
      releases: [released("android-apk-v0.2.3")],
    }),
    "0.2.4",
  );
});

test("另一平台可以共用已准备版本，失败重试不持续升版", () => {
  const releases = [released("windows-installer-v0.2.4"), released("android-apk-v0.2.3")];
  assert.equal(planInstallerVersion({ platform: "android", version: "0.2.4", releases }), "0.2.4");
  assert.equal(planInstallerVersion({ platform: "windows", version: "0.2.5", releases }), "0.2.5");
  assert.equal(
    planInstallerVersion({
      platform: "windows",
      version: "0.2.5",
      releases: [...releases, { tagName: "windows-installer-v0.2.5", isDraft: true }],
    }),
    "0.2.5",
  );
});

test("仅参考二开平台发布，落后其他平台时不回退版本", () => {
  assert.equal(
    planInstallerVersion({
      platform: "windows",
      version: "0.2.3",
      releases: [released("v9.9.9"), released("android-apk-v0.3.1")],
    }),
    "0.3.2",
  );
  assert.equal(
    planInstallerVersion({
      platform: "windows",
      version: "0.2.3",
      releases: [released("v9.9.9"), released("desktop-v8.0.0")],
    }),
    "0.2.3",
  );
});

test("不占用其他提交已有的下一版草稿，也不自动跨过版本编码边界", () => {
  assert.throws(
    () =>
      planInstallerVersion({
        platform: "windows",
        version: "0.2.3",
        releases: [
          released("windows-installer-v0.2.3"),
          { tagName: "windows-installer-v0.2.4", isDraft: true },
        ],
      }),
    /草稿/,
  );
  assert.throws(
    () =>
      planInstallerVersion({
        platform: "android",
        version: "0.2.999",
        releases: [released("android-apk-v0.2.999")],
      }),
    /人工/,
  );
});

function createRepository(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "paseo-installer-version-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const rootDir = path.join(directory, "checkout");
  const remote = path.join(directory, "remote.git");
  mkdirSync(rootDir);
  function git(args, capture = false) {
    const result = spawnSync("git", args, { cwd: rootDir, encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}：${result.stderr}`);
    return capture ? result.stdout.trimEnd() : "";
  }
  const version = "0.2.3";
  const workspaces = ["packages/public", "packages/private"];
  const rootPackage = { name: "paseo", private: true, version, workspaces };
  const publicPackage = {
    name: "@getpaseo/public",
    version,
    description: "不能被升版改写的产品信息",
    dependencies: { "@getpaseo/private": version, external: "^1.0.0" },
  };
  const privatePackage = {
    name: "@getpaseo/private",
    version,
    private: true,
    dependencies: { "@getpaseo/public": "*" },
  };
  const external = {
    version: "1.0.0",
    resolved: "https://example.invalid/external.tgz",
    integrity: "原校验元数据",
    dev: true,
  };
  const lock = {
    name: "paseo",
    version,
    lockfileVersion: 3,
    packages: {
      "": { ...rootPackage },
      "packages/public": structuredClone(publicPackage),
      "packages/private": structuredClone(privatePackage),
      "node_modules/external": external,
    },
  };
  function json(relative, value) {
    const target = path.join(rootDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  }
  json("package.json", rootPackage);
  json("packages/public/package.json", publicPackage);
  json("packages/private/package.json", privatePackage);
  json("package-lock.json", lock);
  writeFileSync(path.join(rootDir, ".gitignore"), "/.output/\n");
  writeFileSync(path.join(rootDir, "README.md"), "已提交的产品源代码\n");
  git(["init", "-b", "main"]);
  git(["config", "user.name", "安装包测试"]);
  git(["config", "user.email", "installer-tests@example.invalid"]);
  git(["config", "core.hooksPath", ".git/no-hooks"]);
  git(["add", "--", "."]);
  git(["commit", "-m", "测试初始源码"]);
  git(["init", "--bare", remote]);
  git(["remote", "add", "origin", remote]);
  git(["push", "origin", "main"]);
  return {
    rootDir,
    git,
    json,
    publicPackage,
    privatePackage,
    external,
    baseCommit: git(["rev-parse", "HEAD"], true),
  };
}

test("同步根包、全部工作区、锁文件与内部依赖，不改注册表依赖或产品信息", (t) => {
  const fixture = createRepository(t);
  const files = writeInstallerVersion(fixture.rootDir, "0.2.4");
  assert.deepEqual(files, [
    "package.json",
    "packages/public/package.json",
    "packages/private/package.json",
    "package-lock.json",
  ]);
  assert.deepEqual(checkWorkspaceVersionConsistency(fixture.rootDir), {
    errors: [],
    rootVersion: "0.2.4",
    workspaceCount: 2,
  });
  const read = (file) => JSON.parse(readFileSync(path.join(fixture.rootDir, file), "utf8"));
  assert.deepEqual(read("packages/public/package.json"), {
    ...fixture.publicPackage,
    version: "0.2.4",
    dependencies: { "@getpaseo/private": "0.2.4", external: "^1.0.0" },
  });
  assert.deepEqual(read("packages/private/package.json"), {
    ...fixture.privatePackage,
    version: "0.2.4",
  });
  assert.deepEqual(read("package-lock.json").packages["node_modules/external"], fixture.external);
  assert.equal(
    readFileSync(path.join(fixture.rootDir, "README.md"), "utf8"),
    "已提交的产品源代码\n",
  );
});

test("版本不一致时在写入之前失败，不掩盖非法输入", (t) => {
  const fixture = createRepository(t);
  fixture.json("packages/public/package.json", { ...fixture.publicPackage, version: "0.2.2" });
  assert.throws(() => writeInstallerVersion(fixture.rootDir, "0.2.4"), /版本应为/);
  assert.equal(
    JSON.parse(readFileSync(path.join(fixture.rootDir, "package.json"), "utf8")).version,
    "0.2.3",
  );
});

test("真实本地 Git 只提交版本文件并普通推送 main，不创建上游式标签", (t) => {
  const fixture = createRepository(t);
  const prepared = commitInstallerVersion({ ...fixture, version: "0.2.4" });
  assert.notEqual(prepared.commit, fixture.baseCommit);
  assert.equal(fixture.git(["status", "--porcelain"], true), "");
  pushPreparedInstallerVersion({
    ...fixture,
    commit: prepared.commit,
    remoteCommit: fixture.baseCommit,
  });
  assert.equal(
    fixture.git(["ls-remote", "origin", "refs/heads/main"], true).split(/\s/)[0],
    prepared.commit,
  );
  assert.equal(fixture.git(["tag", "--list"], true), "");
  assert.equal(fixture.git(["show", "HEAD:README.md"], true), "已提交的产品源代码");
  assert.equal(fixture.git(["rev-list", "--count", "HEAD"], true), "2");
});

test("推送中断后重试同一版本提交，不重复升版或产生额外提交", (t) => {
  const fixture = createRepository(t);
  const prepared = commitInstallerVersion({ ...fixture, version: "0.2.4" });
  function disconnected(args, capture) {
    if (args[0] === "push") throw new Error("网络连接中断");
    return fixture.git(args, capture);
  }
  assert.throws(
    () =>
      pushPreparedInstallerVersion({
        ...fixture,
        git: disconnected,
        commit: prepared.commit,
        remoteCommit: fixture.baseCommit,
      }),
    /网络连接中断/,
  );
  assert.equal(
    fixture.git(["ls-remote", "origin", "refs/heads/main"], true).split(/\s/)[0],
    fixture.baseCommit,
  );
  pushPreparedInstallerVersion({
    ...fixture,
    commit: prepared.commit,
    remoteCommit: fixture.baseCommit,
  });
  assert.equal(fixture.git(["rev-list", "--count", "HEAD"], true), "2");
  assert.equal(checkWorkspaceVersionConsistency(fixture.rootDir).rootVersion, "0.2.4");
});

test("升版中途出现用户编辑时不暂存、不提交、不推送产品改动", (t) => {
  const fixture = createRepository(t);
  function edited(args, capture) {
    if (args.includes("-z"))
      writeFileSync(path.join(fixture.rootDir, "README.md"), "用户刚刚编辑的内容\n");
    return fixture.git(args, capture);
  }
  assert.throws(
    () => commitInstallerVersion({ ...fixture, git: edited, version: "0.2.4" }),
    /版本文件之外/,
  );
  assert.equal(fixture.git(["diff", "--cached", "--name-only"], true), "");
  assert.equal(fixture.git(["rev-parse", "HEAD"], true), fixture.baseCommit);
  assert.equal(
    readFileSync(path.join(fixture.rootDir, "README.md"), "utf8"),
    "用户刚刚编辑的内容\n",
  );
});

test("拒绝推送用户自己的未同步提交以及远端已经变化的版本提交", (t) => {
  const fixture = createRepository(t);
  assert.throws(
    () =>
      pushPreparedInstallerVersion({
        ...fixture,
        commit: fixture.baseCommit,
        remoteCommit: "other",
      }),
    /只自动推送/,
  );
  const prepared = commitInstallerVersion({ ...fixture, version: "0.2.4" });
  assert.throws(
    () =>
      pushPreparedInstallerVersion({
        ...fixture,
        commit: prepared.commit,
        remoteCommit: "remote-changed",
      }),
    /不会自动推送产品改动或覆盖远端/,
  );
  assert.equal(
    fixture.git(["ls-remote", "origin", "refs/heads/main"], true).split(/\s/)[0],
    fixture.baseCommit,
  );
});

test("源码未提交或不在 main 时不触碰版本文件", (t) => {
  const fixture = createRepository(t);
  writeFileSync(path.join(fixture.rootDir, "README.md"), "未提交源码\n");
  assert.throws(() => commitInstallerVersion({ ...fixture, version: "0.2.4" }), /不会自动提交源码/);
  assert.equal(checkWorkspaceVersionConsistency(fixture.rootDir).rootVersion, "0.2.3");
  fixture.git(["add", "--", "README.md"]);
  fixture.git(["commit", "-m", "用户产品改动"]);
  const commit = fixture.git(["rev-parse", "HEAD"], true);
  fixture.git(["switch", "-c", "feature/user-work"]);
  assert.throws(
    () => commitInstallerVersion({ ...fixture, baseCommit: commit, version: "0.2.4" }),
    /分支发生变化/,
  );
  assert.equal(checkWorkspaceVersionConsistency(fixture.rootDir).rootVersion, "0.2.3");
});

test("真实仓库全部工作区及锁文件的副本可同步升版，原仓库保持不变", (t) => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "paseo-all-workspaces-version-"));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  const source = new URL("../", import.meta.url);
  const manifestText = readFileSync(new URL("package.json", source), "utf8");
  const manifest = JSON.parse(manifestText);
  const paths = [
    "package.json",
    "package-lock.json",
    ...manifest.workspaces.map((workspace) => `${workspace}/package.json`),
  ];
  for (const relative of paths) {
    const destination = path.join(rootDir, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(new URL(relative, source)));
  }
  const [major, minor, patch] = manifest.version.split(".").map(Number);
  const next = `${major}.${minor}.${patch + 1}`;
  writeInstallerVersion(rootDir, next);
  assert.deepEqual(checkWorkspaceVersionConsistency(rootDir), {
    errors: [],
    rootVersion: next,
    workspaceCount: manifest.workspaces.length,
  });
  assert.equal(readFileSync(new URL("package.json", source), "utf8"), manifestText);
});
