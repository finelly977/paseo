import { describe, expect, it } from "vitest";
import { resolveDesktopWindowChromeMode, windowChromeModeArgument } from "./chrome";

describe("桌面窗口外观模式", () => {
  it("为不同操作系统选择发布时使用的窗口控件", () => {
    expect(
      resolveDesktopWindowChromeMode({ platform: "darwin", override: undefined, isPackaged: true }),
    ).toBe("native-mac");
    expect(
      resolveDesktopWindowChromeMode({ platform: "win32", override: undefined, isPackaged: true }),
    ).toBe("custom-windows");
    expect(
      resolveDesktopWindowChromeMode({ platform: "linux", override: undefined, isPackaged: true }),
    ).toBe("custom-linux");
  });

  it("开发版本可在 macOS 预览自绘控件", () => {
    expect(
      resolveDesktopWindowChromeMode({
        platform: "darwin",
        override: "windows",
        isPackaged: false,
      }),
    ).toBe("custom-windows");
    expect(
      resolveDesktopWindowChromeMode({ platform: "darwin", override: "linux", isPackaged: false }),
    ).toBe("custom-linux");
  });

  it("拒绝无效值和发布版本中的预览覆盖", () => {
    expect(() =>
      resolveDesktopWindowChromeMode({ platform: "darwin", override: "mac", isPackaged: false }),
    ).toThrow("只能使用 windows 或 linux");
    expect(() =>
      resolveDesktopWindowChromeMode({
        platform: "darwin",
        override: "windows",
        isPackaged: true,
      }),
    ).toThrow("只允许在开发版本中使用");
  });

  it("把已经校验的模式传给预加载脚本", () => {
    expect(windowChromeModeArgument("custom-windows")).toBe(
      "--paseo-window-chrome-mode=custom-windows",
    );
  });
});
