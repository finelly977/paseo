import { describe, expect, it, vi } from "vitest";
import { activateDropdownMenuTrigger } from "./dropdown-menu-trigger";

describe("下拉菜单触发器", () => {
  it("打开菜单时阻止父级目录行同时响应点击", () => {
    const calls: string[] = [];
    const activateMenu = vi.fn(() => calls.push("open"));
    const onPress = vi.fn(() => calls.push("press"));

    activateDropdownMenuTrigger({
      event: { stopPropagation: () => calls.push("stop") },
      disabled: false,
      activateMenu,
      onPress,
    });

    expect(calls).toEqual(["stop", "press", "open"]);
    expect(activateMenu).toHaveBeenCalledOnce();
  });
});
