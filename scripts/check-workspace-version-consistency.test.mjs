import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkWorkspaceVersionConsistency } from "./check-workspace-version-consistency.mjs";

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture() {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "paseo-version-check-"));
  const version = "1.2.3-beta.1";
  const workspaces = ["packages/public", "packages/private"];
  const publicPackage = {
    name: "@getpaseo/public",
    version,
    dependencies: {
      "@getpaseo/private": version,
    },
  };
  const privatePackage = {
    name: "@getpaseo/private",
    version,
    private: true,
    dependencies: {
      "@getpaseo/public": "*",
    },
  };
  const rootPackage = {
    name: "paseo",
    version,
    private: true,
    workspaces,
  };
  const lockfile = {
    name: "paseo",
    version,
    lockfileVersion: 3,
    packages: {
      "": {
        name: "paseo",
        version,
        workspaces,
      },
      "packages/public": structuredClone(publicPackage),
      "packages/private": structuredClone(privatePackage),
    },
  };

  writeJson(path.join(rootDir, "package.json"), rootPackage);
  writeJson(path.join(rootDir, "package-lock.json"), lockfile);
  writeJson(path.join(rootDir, "packages/public/package.json"), publicPackage);
  writeJson(path.join(rootDir, "packages/private/package.json"), privatePackage);

  return { rootDir, rootPackage, lockfile, publicPackage, privatePackage };
}

test("接受完全一致的工作区版本和内部依赖", () => {
  const fixture = createFixture();
  try {
    assert.deepEqual(checkWorkspaceVersionConsistency(fixture.rootDir), {
      errors: [],
      rootVersion: "1.2.3-beta.1",
      workspaceCount: 2,
    });
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("一次报告源码、锁文件和内部依赖的全部版本差异", () => {
  const fixture = createFixture();
  try {
    fixture.publicPackage.version = "1.2.2";
    fixture.privatePackage.dependencies["@getpaseo/public"] = "1.2.3-beta.1";
    fixture.lockfile.version = "1.2.2";
    fixture.lockfile.packages["packages/public"].dependencies["@getpaseo/private"] = "1.2.2";

    writeJson(path.join(fixture.rootDir, "packages/public/package.json"), fixture.publicPackage);
    writeJson(path.join(fixture.rootDir, "packages/private/package.json"), fixture.privatePackage);
    writeJson(path.join(fixture.rootDir, "package-lock.json"), fixture.lockfile);

    const { errors } = checkWorkspaceVersionConsistency(fixture.rootDir);
    assert.ok(errors.some((error) => error.includes("package-lock.json 根版本")));
    assert.ok(errors.some((error) => error.includes("@getpaseo/public 的版本")));
    assert.ok(errors.some((error) => error.includes("@getpaseo/private 的 dependencies")));
    assert.ok(errors.some((error) => error.includes("package-lock.json 中 @getpaseo/public")));
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});

test("拒绝发布流程不支持的版本格式", () => {
  const fixture = createFixture();
  try {
    fixture.rootPackage.version = "1.2.3-preview.1";
    writeJson(path.join(fixture.rootDir, "package.json"), fixture.rootPackage);

    const { errors } = checkWorkspaceVersionConsistency(fixture.rootDir);
    assert.ok(errors.some((error) => error.includes("仅支持 X.Y.Z 或 X.Y.Z-beta.N 格式")));
  } finally {
    rmSync(fixture.rootDir, { recursive: true, force: true });
  }
});
