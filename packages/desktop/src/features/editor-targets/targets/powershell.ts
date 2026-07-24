import type { EditorTarget, EditorTargetLaunchInput, EditorTargetRuntime } from "../target.js";

// Windows PowerShell（5.1）随系统安装在 System32，通常也位于 PATH 中；
// 绝对路径候选项用于覆盖 PATH 被精简的环境。
function commands(runtime: EditorTargetRuntime): string[] {
  const candidates = ["powershell.exe", "powershell", "pwsh.exe", "pwsh"];
  const programFiles = runtime.env.ProgramFiles ?? runtime.env.ProgramW6432;
  if (programFiles) {
    candidates.push(`${programFiles}/PowerShell/7/pwsh.exe`);
  }
  if (runtime.env.LOCALAPPDATA) {
    candidates.push(`${runtime.env.LOCALAPPDATA}/Programs/PowerShell/7/pwsh.exe`);
  }
  const systemRoot = runtime.env.SystemRoot ?? runtime.env.SYSTEMROOT ?? runtime.env.windir;
  if (systemRoot) {
    candidates.push(`${systemRoot}/System32/WindowsPowerShell/v1.0/powershell.exe`);
  }
  return candidates;
}

// PowerShell 的单引号字符串通过两个连续单引号表示内部单引号。
function escapeSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

// 打开独立控制台窗口并定位到工作区目录。-WorkingDirectory 仅适用于 pwsh，
// 因此使用 Set-Location 兼容 Windows PowerShell 5.1。
function launchArgs(input: EditorTargetLaunchInput): string[] {
  return [
    "-NoExit",
    "-Command",
    `Set-Location -LiteralPath '${escapeSingleQuoted(input.workspacePath)}'`,
  ];
}

export const powershellTarget: EditorTarget = {
  id: "powershell",
  async describe() {
    return {
      id: this.id,
      label: "PowerShell",
      kind: "terminal",
      icon: { kind: "symbol", name: "terminal" },
    };
  },
  async isInstalled(runtime) {
    return runtime.platform === "win32" && runtime.resolveCommand(commands(runtime)) !== null;
  },
  async launch(input, runtime) {
    const command = runtime.resolveCommand(commands(runtime));
    if (!command) {
      throw new Error("PowerShell 未安装");
    }
    await runtime.spawnDetached({ command, args: launchArgs(input) });
  },
};
