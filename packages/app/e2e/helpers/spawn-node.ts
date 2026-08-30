import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { once } from "node:events";

/**
 * 直接通过当前 Node 进程运行仓库内的 TypeScript 入口，避免 Windows 无法直接执行
 * `node_modules/.bin` 中的 `.cmd` 包装脚本。
 */
export function spawnTsx(entrypoint: string, args: string[], options: SpawnOptions): ChildProcess {
  if (entrypoint.startsWith("-")) {
    throw new Error(`TypeScript 入口必须是文件路径，实际收到：${entrypoint}`);
  }
  return spawn(process.execPath, ["--import", "tsx", "--", entrypoint, ...args], options);
}

/** 终止子进程及其派生进程，并确认它们已经退出。 */
export async function killProcessTree(child: ChildProcess | null): Promise<void> {
  if (!child || hasExited(child)) return;
  const exited = once(child, "exit").then(() => undefined);

  if (process.platform === "win32") {
    const pid = child.pid;
    if (pid === undefined) {
      throw new Error("无法终止没有进程标识的 Windows 进程树");
    }

    const completed = Promise.withResolvers<Error | null>();
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { timeout: 5_000 }, (error) => {
      completed.resolve(error);
    });
    const taskkillError = await completed.promise;
    if (taskkillError && !hasExited(child)) {
      child.kill("SIGKILL");
      await waitForExitOrTimeout(exited, 5_000);
      throw new Error(`终止进程树失败，进程标识：${pid}`, { cause: taskkillError });
    }
    if (!hasExited(child) && !(await waitForExitOrTimeout(exited, 5_000))) {
      throw new Error(`进程树在强制终止后仍未退出，进程标识：${pid}`);
    }
    return;
  }

  child.kill("SIGTERM");
  if (await waitForExitOrTimeout(exited, 5_000)) return;

  child.kill("SIGKILL");
  if (!(await waitForExitOrTimeout(exited, 5_000))) {
    throw new Error(`进程在强制终止后仍未退出，进程标识：${String(child.pid)}`);
  }
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExitOrTimeout(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
  const timedOut = Promise.withResolvers<boolean>();
  const timeout = setTimeout(() => timedOut.resolve(false), timeoutMs);
  try {
    return await Promise.race([exited.then(() => true), timedOut.promise]);
  } finally {
    clearTimeout(timeout);
  }
}
