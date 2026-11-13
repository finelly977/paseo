import { afterEach, expect, test, vi } from "vitest";
import { installWebScrollbarStyles } from "./install-web-scrollbar-styles.web";

let stop: (() => void) | undefined;
let host: HTMLDivElement;

afterEach(() => {
  stop?.();
  host.remove();
});

function setup() {
  host = document.createElement("div");
  host.style.cssText = "width:200px;height:200px;overflow:scroll;position:fixed;inset:0";
  const content = document.createElement("div");
  content.style.cssText = "height:220px;width:220px";
  host.append(content);
  document.body.append(host);
  stop = installWebScrollbarStyles();
  return content;
}

test("内容超过 1.25 倍后才显示对应轴的滑块，隐藏不改变布局或滚动能力", async () => {
  const content = setup();
  await new Promise(requestAnimationFrame);
  const width = host.clientWidth;
  expect(host.hasAttribute("data-scrollbar-y")).toBe(false);
  expect(host.hasAttribute("data-scrollbar-x")).toBe(false);
  expect(getComputedStyle(host, "::-webkit-scrollbar-thumb").backgroundColor).toBe(
    "rgba(0, 0, 0, 0)",
  );
  host.scrollTop = 10;
  expect(host.scrollTop).toBe(10);
  content.style.height = "500px";
  await vi.waitFor(() => expect(host.hasAttribute("data-scrollbar-y")).toBe(true));
  expect(host.hasAttribute("data-scrollbar-x")).toBe(false);
  expect(host.clientWidth).toBe(width);
  content.style.width = "500px";
  await vi.waitFor(() => expect(host.hasAttribute("data-scrollbar-x")).toBe(true));
  content.style.height = "220px";
  await vi.waitFor(() => expect(host.hasAttribute("data-scrollbar-y")).toBe(false));
  expect(host.hasAttribute("data-scrollbar-x")).toBe(true);
});

test("新挂载区域、内容文字和可视区尺寸改变后自动重新判断，卸载时清理", async () => {
  setup();
  const nested = document.createElement("div");
  nested.style.cssText = "width:100px;height:80px;overflow:auto;position:fixed;left:300px;top:0";
  host.append(nested);
  nested.textContent = "模型名称 ".repeat(200);
  await vi.waitFor(() => expect(nested.hasAttribute("data-scrollbar-y")).toBe(true));
  nested.textContent = "模型名称";
  await vi.waitFor(() => expect(nested.hasAttribute("data-scrollbar-y")).toBe(false));
  nested.style.height = "5px";
  await vi.waitFor(() => expect(nested.hasAttribute("data-scrollbar-y")).toBe(true));
  if (!stop) throw new Error("滚动条监听未安装");
  stop();
  stop = undefined;
  expect(nested.hasAttribute("data-scrollbar-y")).toBe(false);
});
