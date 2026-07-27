import { promises as fs } from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "../../../atomic-file.js";
import { claudeProjectDir } from "./project-dir.js";

export const CLAUDE_CLI_ENTRYPOINT = "cli";

const CLAUDE_SDK_ENTRYPOINTS = new Set(["sdk-cli", "sdk-ts", "sdk-python", "sdk-py"]);
const CLAUDE_SDK_ENTRYPOINT_PATTERN = /"entrypoint"\s*:\s*"sdk-(?:cli|ts|python|py)"/;

export interface ClaudeSessionReference {
  cwd: string;
  sessionId: string;
}

export interface ClaudeSessionEntrypointMigrationFailure {
  sessionPath: string;
  error: unknown;
}

export interface ClaudeSessionEntrypointMigrationResult {
  scannedFiles: number;
  migratedFiles: number;
  changedEntries: number;
  missingFiles: number;
  failures: ClaudeSessionEntrypointMigrationFailure[];
}

export function rewriteClaudeSdkEntrypointsAsCli(content: string): {
  content: string;
  changedEntries: number;
} {
  if (!CLAUDE_SDK_ENTRYPOINT_PATTERN.test(content)) {
    return { content, changedEntries: 0 };
  }

  const parts = content.split(/(\r?\n)/);
  let changedEntries = 0;

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    if (!line.trim()) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`Claude 会话文件第 ${index / 2 + 1} 行不是有效 JSON`, { cause: error });
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      !("entrypoint" in parsed) ||
      typeof parsed.entrypoint !== "string" ||
      !CLAUDE_SDK_ENTRYPOINTS.has(parsed.entrypoint)
    ) {
      continue;
    }

    parsed.entrypoint = CLAUDE_CLI_ENTRYPOINT;
    parts[index] = JSON.stringify(parsed);
    changedEntries += 1;
  }

  return {
    content: changedEntries > 0 ? parts.join("") : content,
    changedEntries,
  };
}

export async function migrateClaudeSdkSessionsToCliEntrypoint(options: {
  sessions: Iterable<ClaudeSessionReference>;
  configDir?: string;
}): Promise<ClaudeSessionEntrypointMigrationResult> {
  const result: ClaudeSessionEntrypointMigrationResult = {
    scannedFiles: 0,
    migratedFiles: 0,
    changedEntries: 0,
    missingFiles: 0,
    failures: [],
  };
  const visitedPaths = new Set<string>();

  for (const session of options.sessions) {
    const projectDir = await claudeProjectDir(
      session.cwd,
      options.configDir === undefined ? undefined : { configDir: options.configDir },
    );
    const sessionPath = path.join(projectDir, `${session.sessionId}.jsonl`);
    if (visitedPaths.has(sessionPath)) {
      continue;
    }
    visitedPaths.add(sessionPath);
    result.scannedFiles += 1;

    try {
      const beforeRead = await fs.stat(sessionPath);
      const source = await fs.readFile(sessionPath, "utf8");
      const rewritten = rewriteClaudeSdkEntrypointsAsCli(source);
      if (rewritten.changedEntries === 0) {
        continue;
      }

      const afterRead = await fs.stat(sessionPath);
      if (beforeRead.size !== afterRead.size || beforeRead.mtimeMs !== afterRead.mtimeMs) {
        throw new Error("Claude 会话在迁移读取期间发生变化，已拒绝覆盖");
      }

      await writeFileAtomic(sessionPath, rewritten.content);
      result.migratedFiles += 1;
      result.changedEntries += rewritten.changedEntries;
    } catch (error) {
      if (isMissingFileError(error)) {
        result.missingFiles += 1;
        continue;
      }
      result.failures.push({ sessionPath, error });
    }
  }

  return result;
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}
