import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReleaseVersion } from "./release-version-utils.mjs";

const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function getDependencyMap(pkg, section) {
  const value = pkg[section];
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pkg.name ?? "未命名包"} 的 ${section} 必须是对象`);
  }
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareInternalDependencies({
  errors,
  packageName,
  packageJson,
  lockPackage,
  expectedRange,
}) {
  for (const section of dependencySections) {
    const sourceDependencies = getDependencyMap(packageJson, section);
    const lockDependencies = getDependencyMap(lockPackage, section);
    const internalNames = new Set(
      [...Object.keys(sourceDependencies), ...Object.keys(lockDependencies)].filter((name) =>
        name.startsWith("@getpaseo/"),
      ),
    );

    for (const dependencyName of internalNames) {
      const sourceRange = sourceDependencies[dependencyName];
      const lockRange = lockDependencies[dependencyName];

      if (sourceRange !== expectedRange) {
        errors.push(
          `${packageName} 的 ${section}.${dependencyName} 应为 ${expectedRange}，实际为 ${String(sourceRange)}`,
        );
      }
      if (lockRange !== sourceRange) {
        errors.push(
          `package-lock.json 中 ${packageName} 的 ${section}.${dependencyName} 应与源码一致为 ${String(sourceRange)}，实际为 ${String(lockRange)}`,
        );
      }
    }
  }
}

function validateRootPackage(errors, rootPackage) {
  const rootVersion = rootPackage.version;

  if (typeof rootVersion !== "string" || rootVersion.length === 0) {
    errors.push("根 package.json 必须包含非空 version");
  } else {
    try {
      parseReleaseVersion(rootVersion);
    } catch {
      errors.push(`根 package.json 的版本 ${rootVersion} 无效，仅支持 X.Y.Z 或 X.Y.Z-beta.N 格式`);
    }
  }

  if (!Array.isArray(rootPackage.workspaces)) {
    throw new Error("根 package.json 的 workspaces 必须是数组");
  }

  return rootVersion;
}

function validateLockfileRoot(errors, rootPackage, lockfile, rootVersion) {
  if (lockfile.name !== rootPackage.name) {
    errors.push(
      `package-lock.json 根名称应为 ${String(rootPackage.name)}，实际为 ${String(lockfile.name)}`,
    );
  }
  if (lockfile.version !== rootVersion) {
    errors.push(
      `package-lock.json 根版本应为 ${String(rootVersion)}，实际为 ${String(lockfile.version)}`,
    );
  }

  const lockPackages = lockfile.packages;
  if (!isRecord(lockPackages)) {
    throw new Error('package-lock.json 必须包含对象形式的 "packages"');
  }

  const lockRoot = lockPackages[""];
  if (!isRecord(lockRoot)) {
    errors.push('package-lock.json 缺少根包条目 packages[""]');
  } else {
    if (lockRoot.version !== rootVersion) {
      errors.push(
        `package-lock.json 根包条目版本应为 ${String(rootVersion)}，实际为 ${String(lockRoot.version)}`,
      );
    }
    if (JSON.stringify(lockRoot.workspaces) !== JSON.stringify(rootPackage.workspaces)) {
      errors.push("package-lock.json 根包条目的工作区列表与 package.json 不一致");
    }
  }

  return lockPackages;
}

function validateWorkspace({ errors, lockPackages, rootDir, rootVersion, workspacePath }) {
  if (typeof workspacePath !== "string" || workspacePath.length === 0) {
    errors.push(`发现无效的工作区路径：${String(workspacePath)}`);
    return;
  }

  const packagePath = path.join(rootDir, workspacePath, "package.json");
  if (!existsSync(packagePath)) {
    errors.push(`工作区缺少 package.json：${workspacePath}`);
    return;
  }

  const workspacePackage = readJson(packagePath);
  const packageName = workspacePackage.name;
  if (typeof packageName !== "string" || packageName.length === 0) {
    errors.push(`${workspacePath}/package.json 缺少有效的 name`);
    return;
  }

  if (workspacePackage.version !== rootVersion) {
    errors.push(
      `${packageName} 的版本应为 ${String(rootVersion)}，实际为 ${String(workspacePackage.version)}`,
    );
  }

  const lockPackage = lockPackages[workspacePath.replaceAll("\\", "/")];
  if (!isRecord(lockPackage)) {
    errors.push(`package-lock.json 缺少工作区条目：${workspacePath}`);
    return;
  }

  if (lockPackage.version !== workspacePackage.version) {
    errors.push(
      `package-lock.json 中 ${packageName} 的版本应与源码一致为 ${String(workspacePackage.version)}，实际为 ${String(lockPackage.version)}`,
    );
  }

  compareInternalDependencies({
    errors,
    packageName,
    packageJson: workspacePackage,
    lockPackage,
    expectedRange: workspacePackage.private === true ? "*" : rootVersion,
  });
}

export function checkWorkspaceVersionConsistency(rootDir) {
  const rootPackage = readJson(path.join(rootDir, "package.json"));
  const lockfile = readJson(path.join(rootDir, "package-lock.json"));
  const errors = [];
  const rootVersion = validateRootPackage(errors, rootPackage);
  const lockPackages = validateLockfileRoot(errors, rootPackage, lockfile, rootVersion);

  for (const workspacePath of rootPackage.workspaces) {
    validateWorkspace({
      errors,
      lockPackages,
      rootDir,
      rootVersion,
      workspacePath,
    });
  }

  return {
    errors,
    rootVersion,
    workspaceCount: rootPackage.workspaces.length,
  };
}

const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (invokedFilePath === currentFilePath) {
  const rootDir = path.resolve(path.dirname(currentFilePath), "..");
  const result = checkWorkspaceVersionConsistency(rootDir);

  if (result.errors.length > 0) {
    console.error(`版本一致性检查失败，共发现 ${result.errors.length} 项问题：`);
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(
      `版本一致性检查通过：根版本 ${result.rootVersion}，${result.workspaceCount} 个工作区与 package-lock.json 完全一致。`,
    );
  }
}
