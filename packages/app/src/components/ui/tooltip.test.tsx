import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { Pressable, Text, View } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@gorhom/portal", () => ({
  Portal: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@gorhom/bottom-sheet", () => ({
  useBottomSheetModalInternal: () => null,
}));

vi.mock("react-native-reanimated", async () => {
  const actualRn = await vi.importActual<typeof import("react-native")>("react-native");
  return {
    default: {
      View: actualRn.View,
    },
    FadeIn: { duration: () => ({}) },
    FadeOut: { duration: () => ({}) },
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) =>
      typeof factory === "function"
        ? (factory as (theme: unknown) => unknown)({
            spacing: { 1: 4, 2: 8 },
            borderRadius: { xl: 12 },
            colors: { popover: "#202224", borderAccent: "#333" },
            borderWidth: { 1: 1 },
            shadow: { md: {} },
          })
        : factory,
  },
}));

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function renderTrigger({
  childDisabled,
  onPress,
}: {
  childDisabled: boolean;
  onPress: () => void;
}): void {
  act(() => {
    root?.render(
      <Tooltip>
        <TooltipTrigger asChild>
          <Pressable disabled={childDisabled} onPress={onPress} testID="trigger">
            <Text>Send</Text>
          </Pressable>
        </TooltipTrigger>
      </Tooltip>,
    );
  });
}

function pressTrigger(): void {
  const trigger = container?.querySelector('[data-testid="trigger"]');
  expect(trigger).not.toBeNull();

  act(() => {
    trigger?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

describe("TooltipTrigger", () => {
  it("keeps an asChild trigger disabled when the child is disabled", () => {
    const onPress = vi.fn();

    renderTrigger({ childDisabled: true, onPress });
    pressTrigger();

    expect(onPress).not.toHaveBeenCalled();
  });

  it("keeps an asChild trigger interactive when the child is not disabled", () => {
    const onPress = vi.fn();

    renderTrigger({ childDisabled: false, onPress });
    pressTrigger();

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("cancels delayed open if pointer leaves an asChild View trigger before delayDuration", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        root?.render(
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <View testID="path-trigger">
                <Text>C:/Users/demo/project</Text>
              </View>
            </TooltipTrigger>
            <TooltipContent testID="path-tooltip">
              <Text>Ctrl click for side pane</Text>
            </TooltipContent>
          </Tooltip>,
        );
      });

      const trigger = container?.querySelector('[data-testid="path-trigger"]');
      expect(trigger).not.toBeNull();

      act(() => {
        trigger?.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
        trigger?.dispatchEvent(new window.MouseEvent("mouseenter", { bubbles: false }));
      });
      act(() => {
        vi.advanceTimersByTime(200);
        trigger?.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));
        trigger?.dispatchEvent(new window.MouseEvent("mouseleave", { bubbles: false }));
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(document.querySelector('[data-testid="path-tooltip"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses an open web tooltip cleanly on mouseleave, scroll, pointermove outside bounds, and window blur", () => {
    vi.useFakeTimers();
    try {
      const scrollHost = document.createElement("div");
      container?.appendChild(scrollHost);
      const localRoot = createRoot(scrollHost);

      const renderHoverTooltip = () => {
        act(() => {
          localRoot.render(
            <Tooltip delayDuration={400}>
              <TooltipTrigger asChild>
                <View testID="path-trigger">
                  <Text>C:/Users/demo/models</Text>
                </View>
              </TooltipTrigger>
              <TooltipContent testID="path-tooltip">
                <Text>Ctrl click for side pane</Text>
              </TooltipContent>
            </Tooltip>,
          );
        });
      };

      renderHoverTooltip();
      const trigger = scrollHost.querySelector('[data-testid="path-trigger"]');
      if (!(trigger instanceof HTMLElement)) {
        throw new Error("Expected path trigger element");
      }
      trigger.getBoundingClientRect = () =>
        ({
          x: 100,
          y: 80,
          left: 100,
          top: 80,
          right: 260,
          bottom: 104,
          width: 160,
          height: 24,
          toJSON: () => ({}),
        }) as DOMRect;

      const openViaHover = () => {
        act(() => {
          trigger.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
          trigger.dispatchEvent(new window.MouseEvent("mouseenter", { bubbles: false }));
        });
        act(() => {
          vi.advanceTimersByTime(400);
        });
        expect(document.querySelector('[data-testid="path-tooltip"]')).not.toBeNull();
      };

      // 1. Direct mouseleave removes tooltip immediately from #overlay-root
      openViaHover();
      act(() => {
        trigger.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));
        trigger.dispatchEvent(new window.MouseEvent("mouseleave", { bubbles: false }));
      });
      expect(document.querySelector('[data-testid="path-tooltip"]')).toBeNull();
      expect(document.getElementById("overlay-root")?.childElementCount ?? 0).toBe(0);

      // 2. Scrolling an ancestor container closes tooltip immediately
      openViaHover();
      act(() => {
        scrollHost.dispatchEvent(new window.Event("scroll", { bubbles: false }));
      });
      expect(document.querySelector('[data-testid="path-tooltip"]')).toBeNull();

      // 3. Pointer moving outside trigger bounds closes tooltip even if pointerleave was missed
      openViaHover();
      act(() => {
        const moveInside = new window.MouseEvent("pointermove", {
          bubbles: true,
          clientX: 140,
          clientY: 90,
        });
        window.dispatchEvent(moveInside);
      });
      expect(document.querySelector('[data-testid="path-tooltip"]')).not.toBeNull();
      act(() => {
        const moveOutside = new window.MouseEvent("pointermove", {
          bubbles: true,
          clientX: 40,
          clientY: 220,
        });
        window.dispatchEvent(moveOutside);
      });
      expect(document.querySelector('[data-testid="path-tooltip"]')).toBeNull();

      // 4. Window blur closes tooltip
      openViaHover();
      act(() => {
        window.dispatchEvent(new window.Event("blur"));
      });
      expect(document.querySelector('[data-testid="path-tooltip"]')).toBeNull();

      act(() => {
        localRoot.unmount();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
