import { existsSync, statSync } from "node:fs";
import path from "node:path";

const OPEN_PROJECT_FLAG = "--open-project";
const OPEN_PROJECT_FLAG_PREFIX = `${OPEN_PROJECT_FLAG}=`;
const OPEN_PROJECT_IGNORED_ARG_PREFIXES = ["-psn_", "--no-sandbox"];

/**
 * 规范化外部传入的项目路径。
 * Windows 资源管理器通过 `"%V"` 传入磁盘根目录（例如 `D:\`）时，末尾反斜杠会转义结束引号，
 * 导致 argv 收到 `D:"`；这里将其还原为 `D:\`，同时去除外层包裹引号。
 */
export function normalizeOpenProjectCandidatePath(candidate: string): string {
  let normalized = candidate.trim();
  if (normalized.length >= 2 && normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (/^[A-Za-z]:"$/u.test(normalized)) {
    normalized = `${normalized.slice(0, 2)}\\`;
  } else if (normalized.endsWith('"') && !normalized.startsWith('"')) {
    normalized = normalized.slice(0, -1).trim();
  }
  return normalized;
}

function isExistingDirectoryAbsolutePath(candidate: string): boolean {
  if (!path.isAbsolute(candidate) || !existsSync(candidate)) {
    return false;
  }

  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

export function parseOpenProjectPathFromArgv(input: {
  argv: string[];
  isDefaultApp: boolean;
}): string | null {
  const effectiveArgs = input.argv
    .slice(input.isDefaultApp ? 2 : 1)
    .filter((arg) => !OPEN_PROJECT_IGNORED_ARG_PREFIXES.some((prefix) => arg.startsWith(prefix)));

  const inlineFlagArg = effectiveArgs.find((arg) => arg.startsWith(OPEN_PROJECT_FLAG_PREFIX));
  if (inlineFlagArg) {
    const candidate = normalizeOpenProjectCandidatePath(
      inlineFlagArg.slice(OPEN_PROJECT_FLAG_PREFIX.length),
    );
    if (isExistingDirectoryAbsolutePath(candidate)) {
      return candidate;
    }
  }

  const openProjectIndex = effectiveArgs.indexOf(OPEN_PROJECT_FLAG);
  if (openProjectIndex !== -1) {
    const rawFlaggedPath = effectiveArgs[openProjectIndex + 1];
    if (rawFlaggedPath) {
      const candidate = normalizeOpenProjectCandidatePath(rawFlaggedPath);
      if (isExistingDirectoryAbsolutePath(candidate)) {
        return candidate;
      }
    }
  }

  for (const arg of effectiveArgs) {
    if (arg.startsWith("-")) {
      continue;
    }
    const candidate = normalizeOpenProjectCandidatePath(arg);
    if (isExistingDirectoryAbsolutePath(candidate)) {
      return candidate;
    }
  }

  return null;
}
