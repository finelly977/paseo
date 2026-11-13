import { describe, expect, it } from "vitest";
import { resolvePluginCenterLayout } from "./center-layout";

describe("插件中心首帧布局", () => {
  it.each([
    [1440, false, true, true],
    [1080, false, false, true],
    [960, false, false, true],
    [808, false, false, false],
    [720, false, false, false],
    [390, true, false, false],
  ] as const)("窗口 %s 在第一次渲染即确定侧栏与列数", (width, compact, showRail, twoColumns) => {
    expect(resolvePluginCenterLayout(width, compact)).toEqual({ showRail, twoColumns });
  });
});
