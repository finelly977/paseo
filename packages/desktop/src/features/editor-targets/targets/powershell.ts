import type { EditorTarget, EditorTargetRuntime } from "../target.js";

// 优先使用 PowerShell 7；绝对路径候选项用于覆盖桌面应用 PATH 被精简的环境。
// 只有找不到 pwsh 时才回退到系统自带的 Windows PowerShell 5.1。
function commands(runtime: EditorTargetRuntime): string[] {
  const candidates = ["pwsh.exe", "pwsh"];
  const programFiles = runtime.env.ProgramFiles ?? runtime.env.ProgramW6432;
  if (programFiles) {
    candidates.push(`${programFiles}/PowerShell/7/pwsh.exe`);
  }
  if (runtime.env.LOCALAPPDATA) {
    candidates.push(`${runtime.env.LOCALAPPDATA}/Programs/PowerShell/7/pwsh.exe`);
  }
  candidates.push("powershell.exe", "powershell");
  const systemRoot = runtime.env.SystemRoot ?? runtime.env.SYSTEMROOT ?? runtime.env.windir;
  if (systemRoot) {
    candidates.push(`${systemRoot}/System32/WindowsPowerShell/v1.0/powershell.exe`);
  }
  return candidates;
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
    // 直接分离 PowerShell 会把标准输入输出连接到空设备，交互式进程会随即退出。
    // 通过 Windows 的 start 命令创建真正独立的控制台，同时把工作目录直接传入。
    await runtime.openWindowsConsole({
      command,
      args: ["-NoLogo", "-NoExit"],
      cwd: input.workspacePath,
    });
  },
};
