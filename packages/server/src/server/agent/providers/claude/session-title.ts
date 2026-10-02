import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);

// SDK 从进程环境解析配置目录；独立进程避免不同 Claude 档案互相串写。
export async function accessClaudeSessionTitle(input: {
  sessionId: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  title?: string;
}): Promise<string | null> {
  const sdkUrl = import.meta.resolve("@anthropic-ai/claude-agent-sdk");
  const source = `
    const { getSessionInfo, renameSession } = await import(process.argv[1]);
    const input = JSON.parse(process.argv[2]);
    if (input.title !== undefined) await renameSession(input.sessionId, input.title, { dir: input.cwd });
    const session = await getSessionInfo(input.sessionId, { dir: input.cwd });
    if (input.title !== undefined && !session) throw new Error("Claude session not found after rename");
    process.stdout.write(JSON.stringify(session ? session.summary : null));
  `;
  const result = await run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      source,
      sdkUrl,
      JSON.stringify({ sessionId: input.sessionId, cwd: input.cwd, title: input.title }),
    ],
    {
      cwd: input.cwd,
      env: { ...process.env, ...input.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  return z.string().nullable().parse(JSON.parse(result.stdout));
}
