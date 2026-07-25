import { describe, expect, test } from "vitest";

import { focusNotificationTargetWindow } from "./notification-window";

interface FakeWindowState {
  minimized: boolean;
  maximized: boolean;
  visible: boolean;
}

function createFakeWindow(initial: FakeWindowState) {
  const state = { ...initial };
  const calls: string[] = [];
  return {
    state,
    calls,
    window: {
      isMinimized: () => state.minimized,
      isMaximized: () => state.maximized,
      isVisible: () => state.visible,
      restore: () => {
        calls.push("restore");
        state.minimized = false;
        state.visible = true;
      },
      show: () => {
        calls.push("show");
        state.visible = true;
        if (state.minimized) {
          state.minimized = false;
          state.maximized = false;
        }
      },
      maximize: () => {
        calls.push("maximize");
        state.maximized = true;
      },
      focus: () => {
        calls.push("focus");
      },
    },
  };
}

describe("通知点击窗口恢复", () => {
  test("先恢复最小化窗口，避免显示操作丢失原最大化状态", () => {
    const fake = createFakeWindow({ minimized: true, maximized: true, visible: false });

    focusNotificationTargetWindow(fake.window);

    expect(fake.state).toEqual({ minimized: false, maximized: true, visible: true });
    expect(fake.calls).toEqual(["restore", "focus"]);
  });

  test("重新显示隐藏窗口后恢复它原有的最大化状态", () => {
    const fake = createFakeWindow({ minimized: false, maximized: true, visible: false });
    const originalShow = fake.window.show;
    fake.window.show = () => {
      originalShow();
      fake.state.maximized = false;
    };

    focusNotificationTargetWindow(fake.window);

    expect(fake.state).toEqual({ minimized: false, maximized: true, visible: true });
    expect(fake.calls).toEqual(["show", "maximize", "focus"]);
  });
});
