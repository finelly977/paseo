import { describe, expect, it, vi } from "vitest";
import { activateDropdownMenuTrigger } from "./dropdown-menu-trigger";

describe("下拉菜单触发器", () => {
  it("打开菜单时阻止父级目录行同时响应点击", () => {
    const calls: string[] = [];
    const setOpen = vi.fn((open: boolean) => calls.push(`open:${open}`));
    const onPress = vi.fn(() => calls.push("press"));

    activateDropdownMenuTrigger({
      event: { stopPropagation: () => calls.push("stop") },
      disabled: false,
      open: false,
      setOpen,
      onPress,
    });

    expect(calls).toEqual(["stop", "press", "open:true"]);
    expect(setOpen).toHaveBeenCalledWith(true);
  });
});
