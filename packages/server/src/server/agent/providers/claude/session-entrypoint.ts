import { promises as fs } from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "../../../atomic-file.js";
import { claudeProjectDir } from "./project-dir.js";

export const CLAUDE_CLI_ENTRYPOINT = "cli";

const CLAUDE_SDK_ENTRYPOINTS = new Set(["sdk-cli", "sdk-ts", "sdk-python", "sdk-py"]);
const CLAUDE_SDK_ENTRYPOINT_PATTERN = /"entrypoint"\s*:\s*"sdk-(?:cli|ts|python|py)"/;
const CLAUDE_SDK_ENTRYPOINT_TOKEN_PATTERN = /"entrypoint"\s*:\s*"(sdk-(?:cli|ts|python|py))"/g;

interface ClaudeEntrypointByteRewrite {
  offset: number;
  source: Buffer;
  replacement: Buffer;
}

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

export type ClaudeSessionEntrypointRewriteResult =
  | { status: "missing"; sessionPath: string }
  | { status: "unchanged"; sessionPath: string; changedEntries: 0 }
  | { status: "migrated"; sessionPath: string; changedEntries: number };

export function rewriteClaudeSdkEntrypointsAsCli(content: string): {
  content: string;
  changedEntries: number;
} {
  const rewrites = collectClaudeEntrypointByteRewrites(content);
  if (rewrites.length === 0) {
    return { content, changedEntries: 0 };
  }

  const rewritten = Buffer.from(content, "utf8");
  for (const rewrite of rewrites) {
    rewrite.replacement.copy(rewritten, rewrite.offset);
  }
  return { content: rewritten.toString("utf8"), changedEntries: rewrites.length };
}

function collectClaudeEntrypointByteRewrites(content: string): ClaudeEntrypointByteRewrite[] {
  if (!CLAUDE_SDK_ENTRYPOINT_PATTERN.test(content)) {
    return [];
  }

  const parts = content.split(/(\r?\n)/);
  const rewrites: ClaudeEntrypointByteRewrite[] = [];
  let contentByteOffset = 0;

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    if (!line.trim() || !CLAUDE_SDK_ENTRYPOINT_PATTERN.test(line)) {
      contentByteOffset += Buffer.byteLength(line + (parts[index + 1] ?? ""), "utf8");
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
      contentByteOffset += Buffer.byteLength(line + (parts[index + 1] ?? ""), "utf8");
      continue;
    }

    CLAUDE_SDK_ENTRYPOINT_TOKEN_PATTERN.lastIndex = 0;
    let matchedTopLevelToken = false;
    for (const match of line.matchAll(CLAUDE_SDK_ENTRYPOINT_TOKEN_PATTERN)) {
      if (match.index === undefined || jsonDepthAt(line, match.index) !== 1) {
        continue;
      }
      const sdkEntrypoint = match[1];
      const sourceToken = `"${sdkEntrypoint}"`;
      const tokenOffsetInMatch = match[0].lastIndexOf(sourceToken);
      if (tokenOffsetInMatch < 0) {
        throw new Error(`Claude 会话文件第 ${index / 2 + 1} 行的来源标识无法定位`);
      }
      const tokenCharacterOffset = match.index + tokenOffsetInMatch;
      const source = Buffer.from(sourceToken, "utf8");
      const cliToken = `"${CLAUDE_CLI_ENTRYPOINT}"`;
      const replacement = Buffer.from(cliToken.padEnd(source.length, " "), "utf8");
      rewrites.push({
        offset: contentByteOffset + Buffer.byteLength(line.slice(0, tokenCharacterOffset), "utf8"),
        source,
        replacement,
      });
      matchedTopLevelToken = true;
      break;
    }
    if (!matchedTopLevelToken) {
      throw new Error(`Claude 会话文件第 ${index / 2 + 1} 行的顶层来源标识无法定位`);
    }
    contentByteOffset += Buffer.byteLength(line + (parts[index + 1] ?? ""), "utf8");
  }

  return rewrites;
}

function jsonDepthAt(source: string, end: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < end; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === "]") {
      depth -= 1;
    }
  }
  return depth;
}

export async function rewriteActiveClaudeSessionEntrypointAsCli(options: {
  session: ClaudeSessionReference;
  configDir?: string;
}): Promise<ClaudeSessionEntrypointRewriteResult> {
  const projectDir = await claudeProjectDir(
    options.session.cwd,
    options.configDir === undefined ? undefined : { configDir: options.configDir },
  );
  const sessionPath = path.join(projectDir, `${options.session.sessionId}.jsonl`);

  let sourceContent: string;
  try {
    sourceContent = await fs.readFile(sessionPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return { status: "missing", sessionPath };
    }
    throw error;
  }

  const rewrites = collectClaudeEntrypointByteRewrites(sourceContent);
  if (rewrites.length === 0) {
    return { status: "unchanged", sessionPath, changedEntries: 0 };
  }

  const handle = await fs.open(sessionPath, "r+");
  try {
    for (const rewrite of rewrites) {
      const current = Buffer.alloc(rewrite.source.length);
      const { bytesRead } = await handle.read(current, 0, current.length, rewrite.offset);
      if (bytesRead !== current.length || !current.equals(rewrite.source)) {
        throw new Error("Claude 会话在来源转换期间修改了已有记录，已拒绝覆盖");
      }
    }

    const touchedRewrites: ClaudeEntrypointByteRewrite[] = [];
    try {
      for (const rewrite of rewrites) {
        touchedRewrites.push(rewrite);
        await writeBufferFully(handle, rewrite.replacement, rewrite.offset);
      }
      await handle.sync();
    } catch (error) {
      try {
        for (const rewrite of touchedRewrites.toReversed()) {
          await writeBufferFully(handle, rewrite.source, rewrite.offset);
        }
        await handle.sync();
      } catch (rollbackError) {
        throw Object.assign(
          new Error("Claude 会话来源转换失败且无法恢复已写入的来源标识", {
            cause: rollbackError,
          }),
          { conversionError: error },
        );
      }
      throw error;
    }
  } finally {
    await handle.close();
  }
  return {
    status: "migrated",
    sessionPath,
    changedEntries: rewrites.length,
  };
}

async function writeBufferFully(
  handle: Awaited<ReturnType<typeof fs.open>>,
  content: Buffer,
  offset: number,
): Promise<void> {
  let bytesWritten = 0;
  while (bytesWritten < content.length) {
    const write = await handle.write(
      content,
      bytesWritten,
      content.length - bytesWritten,
      offset + bytesWritten,
    );
    if (write.bytesWritten === 0) {
      throw new Error("Claude 会话来源转换未能写入完整记录");
    }
    bytesWritten += write.bytesWritten;
  }
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
