import { describe, expect, it } from "vitest";
import {
  intersectWindowChromeCorners,
  resolveHasOwnedWindowChromeObstruction,
  resolveWindowChromeObstruction,
  resolveWindowChromeSafeArea,
} from "@/utils/desktop-window";
import { getDesktopWindowControlsPresentation } from "@/desktop/window-chrome-presentation";

describe("window chrome", () => {
  it("has no corner obstruction outside Electron or in fullscreen", () => {
    expect(resolveWindowChromeObstruction({ mode: null, isFullscreen: false })).toEqual({
      topLeft: null,
      topRight: null,
    });
    expect(resolveWindowChromeObstruction({ mode: "native-mac", isFullscreen: true })).toEqual({
      topLeft: null,
      topRight: null,
    });
  });

  it("places native controls in their physical top corner", () => {
    expect(resolveWindowChromeObstruction({ mode: "native-mac", isFullscreen: false })).toEqual({
      topLeft: { width: 78, height: 45 },
      topRight: null,
    });
    expect(resolveWindowChromeObstruction({ mode: "custom-windows", isFullscreen: false })).toEqual(
      { topLeft: null, topRight: { width: 138, height: 40 } },
    );
    expect(resolveWindowChromeObstruction({ mode: "custom-linux", isFullscreen: false })).toEqual({
      topLeft: null,
      topRight: { width: 108, height: 40 },
    });
  });

  it("窗口控件随 40 像素主工具栏收紧，保留按钮宽度和图标尺寸", () => {
    expect(getDesktopWindowControlsPresentation("custom-windows")).toEqual({
      controlWidth: 46,
      railHeight: 40,
      controlHeight: 39,
      glyphSize: 16,
      glyphStrokeWidth: 1,
      hoverShape: "control",
    });
    expect(getDesktopWindowControlsPresentation("custom-linux")).toEqual({
      controlWidth: 36,
      railHeight: 40,
      controlHeight: 39,
      glyphSize: 14,
      glyphStrokeWidth: 1.5,
      hoverShape: "circle",
    });
  });

  it("insets and reserves only claimed corners", () => {
    const obstruction = { topLeft: { width: 80, height: 28 }, topRight: { width: 48, height: 32 } };
    expect(
      resolveWindowChromeSafeArea({ obstruction, corners: "top-left", placement: "inline" }),
    ).toEqual({ paddingLeft: 80, paddingRight: 0 });
    expect(
      resolveWindowChromeSafeArea({ obstruction, corners: "top-right", placement: "below" }),
    ).toEqual({ height: 32 });
    expect(
      resolveWindowChromeSafeArea({ obstruction, corners: "both", placement: "below" }),
    ).toEqual({ height: 32 });
    expect(
      resolveWindowChromeSafeArea({ obstruction, corners: "top-right", placement: "inline" }),
    ).toEqual({ paddingLeft: 0, paddingRight: 48 });
  });

  it("intersects identical and empty corner claims", () => {
    expect(intersectWindowChromeCorners("both", "both")).toBe("both");
    expect(intersectWindowChromeCorners("top-left", "top-left")).toBe("top-left");
    expect(intersectWindowChromeCorners("none", "both")).toBe("none");
    expect(intersectWindowChromeCorners("both", "none")).toBe("none");
    expect(intersectWindowChromeCorners("both", "top-left")).toBe("top-left");
    expect(intersectWindowChromeCorners("top-right", "both")).toBe("top-right");
    expect(intersectWindowChromeCorners("top-left", "top-right")).toBe("none");
  });

  it("reports an obstruction only when the surface owns its corner", () => {
    const obstruction = {
      topLeft: { width: 78, height: 45 },
      topRight: { width: 140, height: 48 },
    };

    expect(
      resolveHasOwnedWindowChromeObstruction({
        obstruction,
        corners: "top-left",
        corner: "top-left",
      }),
    ).toBe(true);
    expect(
      resolveHasOwnedWindowChromeObstruction({
        obstruction,
        corners: "top-left",
        corner: "top-right",
      }),
    ).toBe(false);
    expect(
      resolveHasOwnedWindowChromeObstruction({
        obstruction: { topLeft: null, topRight: null },
        corners: "both",
        corner: "top-right",
      }),
    ).toBe(false);
  });
});
