import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";

import {
  buildToolCallPresentation,
  getToolFailureDetail,
  type ToolCallPresentationIcon,
} from "./presentation";

const fakeIcons = {
  brain: (() => null) as ToolCallPresentationIcon,
  eye: (() => null) as ToolCallPresentationIcon,
  wrench: (() => null) as ToolCallPresentationIcon,
};

function fakeResolveIcon(
  toolName: string,
  detail: ToolCallDetail | undefined,
): ToolCallPresentationIcon {
  if (detail?.type === "plan") {
    return fakeIcons.brain;
  }
  if (detail?.type === "read") {
    return fakeIcons.eye;
  }
  if (toolName === "exec_command") {
    return fakeIcons.wrench;
  }
  return fakeIcons.wrench;
}

describe("tool-call presentation", () => {
  it("将单字段错误对象化成可读文本，多字段诊断保持完整", () => {
    const input = {
      toolName: "exec_command",
      status: "failed",
      resolveIcon: fakeResolveIcon,
    } as const;
    expect(
      buildToolCallPresentation({ ...input, error: { message: "路径不存在" } }).errorText,
    ).toBe("路径不存在");
    const diagnostic = { message: "路径不存在", code: "ENOENT", path: "/tmp/work" };
    const detailed = buildToolCallPresentation({ ...input, error: diagnostic });
    expect(detailed.errorText).toBe(JSON.stringify(diagnostic, null, 2));
    expect(detailed.canOpenDetails).toBe(true);
  });

  it("去掉通用或已出现在命令输出的原因，仍保留不同的具体诊断", () => {
    const output = "开始运行\nFailed to start: missing directory\n";
    expect(getToolFailureDetail("Tool call failed", output)).toBeNull();
    expect(getToolFailureDetail("  TOOL CALL FAILED.  ", null)).toBeNull();
    expect(getToolFailureDetail("Failed to start: missing directory", output)).toBeNull();
    expect(getToolFailureDetail("工作目录必须先创建", output)).toBe("工作目录必须先创建");
  });

  it("builds badge, detail, icon, and file-open policy in one model", () => {
    const presentation = buildToolCallPresentation({
      toolName: "read_file",
      status: "completed",
      error: null,
      cwd: "/tmp/repo",
      detail: {
        type: "read",
        filePath: "/tmp/repo/src/index.ts",
        content: "console.log('hi');",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation).toMatchObject({
      displayName: "Read",
      summary: "src/index.ts",
      icon: fakeIcons.eye,
      isLoadingDetails: false,
      hasDetails: true,
      canOpenDetails: true,
      openFilePath: "/tmp/repo/src/index.ts",
      isPlan: false,
    });
  });

  it("marks running calls without meaningful detail as loading details", () => {
    const presentation = buildToolCallPresentation({
      toolName: "exec_command",
      status: "running",
      error: null,
      detail: {
        type: "unknown",
        input: {},
        output: null,
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation).toMatchObject({
      displayName: "Exec command",
      icon: fakeIcons.wrench,
      isLoadingDetails: true,
      hasDetails: false,
      canOpenDetails: true,
      openFilePath: null,
      isPlan: false,
    });
  });

  it("keeps plan calls out of the expandable badge path", () => {
    const presentation = buildToolCallPresentation({
      toolName: "ExitPlanMode",
      status: "completed",
      error: null,
      detail: {
        type: "plan",
        text: "1. Do the thing",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation.isPlan).toBe(true);
    expect(presentation.icon).toBe(fakeIcons.brain);
  });
});
