import type { SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";

import { createEditorTargetRuntime } from "./runtime.js";

interface SpawnRecord {
  command: string;
  args: string[];
  options: SpawnOptions;
  unrefed: boolean;
}

describe("editor target runtime", () => {
  it("resolves command aliases and safely launches Windows command scripts", async () => {
    const records: SpawnRecord[] = [];
    const runtime = createEditorTargetRuntime({
      platform: "win32",
      env: {
        PATH: "C:/Program Files/Editors & Tools/bin",
        ELECTRON_RUN_AS_NODE: "1",
      },
      pathExists: (targetPath) => targetPath === "C:/Program Files/Editors & Tools/bin/code.cmd",
      spawn: (command, args, options) => {
        const record = { command, args, options, unrefed: false };
        records.push(record);
        const child = {
          once(event: "error" | "spawn", handler: (error?: Error) => void) {
            if (event === "spawn") queueMicrotask(() => handler());
            return child;
          },
          unref() {
            record.unrefed = true;
          },
        };
        return child;
      },
    });

    const command = runtime.resolveCommand(["missing", "code"]);
    if (!command) throw new Error("Expected the editor command to resolve");
    await runtime.spawnDetached({
      command,
      args: ["C:/repo & workspace", "C:/repo/src/file & calculator.ts"],
    });

    expect(records).toEqual([
      {
        command: '"C:/Program Files/Editors & Tools/bin/code.cmd"',
        args: ['"C:/repo & workspace"', '"C:/repo/src/file & calculator.ts"'],
        options: {
          detached: true,
          env: { PATH: "C:/Program Files/Editors & Tools/bin" },
          shell: true,
          stdio: "ignore",
        },
        unrefed: true,
      },
    ]);
  });

  it("通过 Windows start 命令打开可交互的独立控制台", async () => {
    const records: SpawnRecord[] = [];
    const runtime = createEditorTargetRuntime({
      platform: "win32",
      env: {
        PATH: "C:/Windows/System32",
        ELECTRON_RUN_AS_NODE: "1",
      },
      pathExists: (targetPath) => targetPath === "C:/Windows/System32/powershell.exe",
      spawn: (command, args, options) => {
        const record = { command, args, options, unrefed: false };
        records.push(record);
        const child = {
          once(event: "error" | "spawn", handler: (error?: Error) => void) {
            if (event === "spawn") queueMicrotask(() => handler());
            return child;
          },
          unref() {
            record.unrefed = true;
          },
        };
        return child;
      },
    });

    await runtime.openWindowsConsole({
      command: "C:/Windows/System32/powershell.exe",
      args: ["-NoLogo", "-NoExit"],
      cwd: "C:/repo",
    });

    expect(records[0]).toMatchObject({
      command:
        'start "" /D "%PASEO_EDITOR_TARGET_CWD%" "%PASEO_EDITOR_TARGET_COMMAND%" "%PASEO_EDITOR_TARGET_ARG_0%" "%PASEO_EDITOR_TARGET_ARG_1%"',
      args: [],
      options: {
        detached: true,
        env: {
          PATH: "C:/Windows/System32",
          PASEO_EDITOR_TARGET_COMMAND: "C:/Windows/System32/powershell.exe",
          PASEO_EDITOR_TARGET_CWD: "C:/repo",
          PASEO_EDITOR_TARGET_ARG_0: "-NoLogo",
          PASEO_EDITOR_TARGET_ARG_1: "-NoExit",
        },
        shell: true,
        stdio: "ignore",
        windowsHide: true,
      },
      unrefed: true,
    });
  });
});
