import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const templates = path.join(root, "node_modules/app-builder-lib/templates/nsis");

function extractMacro(source, name) {
  const macro = source.match(
    new RegExp(`^!macro ${name}(?: [^\\r\\n]*)?\\r?\\n[\\s\\S]*?^!macroend`, "m"),
  );
  assert.ok(macro, `NSIS 模板缺少 ${name}，请重新检查安装器扩展点`);
  return macro[0];
}

test(
  "Windows 安装器同目录手动升级保留快捷方式，首次安装和迁移目录不误保留",
  {
    skip: process.platform !== "win32",
  },
  () => {
    assert.ok(
      process.env.NSIS_MAKENSIS,
      "请用 NSIS_MAKENSIS 指定 electron-builder 的 makensis.exe",
    );
    const outputRoot = path.join(root, ".output/windows-shortcut-upgrade");
    mkdirSync(outputRoot, { recursive: true });
    const output = mkdtempSync(path.join(outputRoot, "nsis-policy-"));
    const exe = path.join(output, "shortcut-policy.exe");
    const results = path.join(output, "results.ini");
    const registryKey = `Software\\PaseoInstallerTests\\${randomUUID()}`;
    const source = readFileSync(path.join(templates, "include/installUtil.nsh"), "utf8");
    const installed = path.join(output, "installed");
    const relocated = path.join(output, "relocated");
    mkdirSync(installed);
    mkdirSync(relocated);
    writeFileSync(path.join(installed, "Paseo.exe"), "原安装目录标记");
    const cases = [
      { name: "first-install", registered: "", target: installed, updated: "0", expected: "false" },
      {
        name: "manual-upgrade",
        registered: installed,
        target: installed,
        updated: "0",
        expected: "true",
      },
      {
        name: "case-and-trailing-slash",
        registered: `${installed}\\`,
        target: installed.toUpperCase(),
        updated: "0",
        expected: "true",
      },
      {
        name: "move-installation",
        registered: installed,
        target: relocated,
        updated: "0",
        expected: "false",
      },
      {
        name: "stale-installation",
        registered: relocated,
        target: relocated,
        updated: "0",
        expected: "false",
      },
      {
        name: "in-app-update",
        registered: installed,
        target: installed,
        updated: "1",
        expected: "true",
      },
      {
        name: "different-install-scope",
        registered: installed,
        target: installed,
        updated: "0",
        shell: "all",
        rootKey: "SHELL_CONTEXT",
        expected: "false",
      },
      {
        name: "explicit-current-user-scope",
        registered: installed,
        target: installed,
        updated: "0",
        shell: "all",
        rootKey: "HKEY_CURRENT_USER",
        expected: "true",
      },
    ];
    const script = `Unicode true
!include "LogicLib.nsh"
Name "Paseo 快捷方式策略测试"
OutFile "${exe}"
RequestExecutionLevel user
SilentInstall silent
!define allowToChangeInstallationDirectory
!define INSTALL_REGISTRY_KEY "${registryKey}"
!define APP_EXECUTABLE_FILENAME "Paseo.exe"
Var updated
Var rootKey
!define isUpdated '"$updated" == "1"'
Var isTryToKeepShortcuts
${extractMacro(source, "readReg")}
${extractMacro(source, "setIsTryToKeepShortcuts")}
Section
  SetShellVarContext current
${cases
  .map(
    (entry) => `
  SetShellVarContext ${entry.shell ?? "current"}
  DeleteRegKey HKCU "${registryKey}"
  WriteRegStr HKCU "${registryKey}" InstallLocation "${entry.registered}"
  StrCpy $INSTDIR "${entry.target}"
  StrCpy $updated "${entry.updated}"
  StrCpy $rootKey "${entry.rootKey ?? "SHELL_CONTEXT"}"
  StrCpy $R5 "sentinel-R5"
  StrCpy $R6 "sentinel-R6"
  !insertmacro setIsTryToKeepShortcuts "$rootKey"
  WriteINIStr "${results}" "results" "${entry.name}" "$isTryToKeepShortcuts"
  WriteINIStr "${results}" "registers" "${entry.name}" "$R5|$R6"
`,
  )
  .join("")}
  DeleteRegKey HKCU "${registryKey}"
SectionEnd
`;
    const scriptPath = path.join(output, "shortcut-policy.nsi");
    writeFileSync(scriptPath, `\uFEFF${script}`);
    execFileSync(process.env.NSIS_MAKENSIS, ["/V2", "/WX", scriptPath], { windowsHide: true });
    execFileSync(exe, [], { windowsHide: true, timeout: 30_000 });
    const actual = readFileSync(results, "utf8");
    for (const entry of cases) {
      assert.match(actual, new RegExp(`${entry.name}=${entry.expected}`), entry.name);
      assert.match(actual, new RegExp(`${entry.name}=sentinel-R5\\|sentinel-R6`), entry.name);
    }
  },
);
