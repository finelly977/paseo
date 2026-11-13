import { useRef, useState, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { View } from "react-native";
import { afterEach, expect, test, vi } from "vitest";
import { useHoverMenu } from "./use-hover-menu";

let root: Root | null = null;
let host: HTMLDivElement;
const contentStyle = { position: "absolute", left: 200, top: 50 } as const;

function HoverSearch() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const activate = useHoverMenu({
    enabled: true,
    open,
    onOpenChange: setOpen,
    triggerRef: trigger as unknown as RefObject<View | null>,
    contentRef: content as unknown as RefObject<View | null>,
  });
  return (
    <>
      <button type="button" ref={trigger} onClick={activate}>
        打开模型
      </button>
      {open ? (
        <div ref={content} style={contentStyle}>
          <input aria-label="搜索模型" />
        </div>
      ) : null}
    </>
  );
}

afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
});

async function openSearch() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<HoverSearch />);
  await vi.waitFor(() => expect(host.querySelector("button")).not.toBeNull());
  const button = host.querySelector("button");
  if (!button) throw new Error("模型入口未挂载");
  button.click();
  await vi.waitFor(() => expect(host.querySelector("input")).not.toBeNull());
  const input = host.querySelector("input");
  if (!input) throw new Error("搜索框未挂载");
  const rect = input.getBoundingClientRect();
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: rect.left + 5,
      clientY: rect.top + 5,
      pointerType: "mouse",
    }),
  );
  return input;
}

test("中文输入时搜索框保持焦点，候选窗及筛选后边界变化不触发悬停关闭", async () => {
  const input = await openSearch();
  input.focus();
  input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }));
  window.dispatchEvent(new Event("blur"));
  document.dispatchEvent(
    new PointerEvent("pointermove", { clientX: 900, clientY: 600, pointerType: "mouse" }),
  );
  await new Promise((resolve) => setTimeout(resolve, 220));
  expect(host.querySelector("input")).toBe(input);
  expect(document.activeElement).toBe(input);
  input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" }));
});

test("未输入时离开菜单仍会收起，聚焦搜索后也能点击入口主动关闭", async () => {
  const input = await openSearch();
  window.dispatchEvent(new Event("blur"));
  await vi.waitFor(() => expect(host.querySelector("input")).toBeNull());
  const button = host.querySelector("button");
  if (!button) throw new Error("模型入口未挂载");
  button.click();
  await vi.waitFor(() => expect(host.querySelector("input")).not.toBeNull());
  const reopened = host.querySelector("input");
  if (!reopened) throw new Error("搜索框未重新挂载");
  expect(reopened).not.toBe(input);
  reopened.focus();
  button.click();
  await vi.waitFor(() => expect(host.querySelector("input")).toBeNull());
});

test("搜索框仅聚焦、未选词时，鼠标移出仍会收起", async () => {
  const input = await openSearch();
  input.focus();
  document.dispatchEvent(
    new PointerEvent("pointermove", { clientX: 900, clientY: 600, pointerType: "mouse" }),
  );
  await vi.waitFor(() => expect(host.querySelector("input")).toBeNull());
});

test("鼠标已在外侧时，输入法选词结束后恢复自动收起", async () => {
  const input = await openSearch();
  input.focus();
  input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  document.dispatchEvent(
    new PointerEvent("pointermove", { clientX: 900, clientY: 600, pointerType: "mouse" }),
  );
  await new Promise((resolve) => setTimeout(resolve, 220));
  expect(host.querySelector("input")).toBe(input);
  input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" }));
  await vi.waitFor(() => expect(host.querySelector("input")).toBeNull());
});
