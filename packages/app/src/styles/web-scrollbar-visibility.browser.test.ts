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

test("同一批挂载的嵌套区域与动画后的正文尺寸合并更新，重复开合不丢失滚动条", async () => {
  setup();
  const nested = document.createElement("div");
  nested.style.cssText = "width:120px;height:80px;overflow:auto";
  const content = document.createElement("div");
  content.style.height = "400px";
  nested.append(content);
  host.append(nested);
  await expect.poll(() => nested.hasAttribute("data-scrollbar-y")).toBe(true);
  content.style.height = "20px";
  content.append(document.createElement("span"));
  await expect.poll(() => nested.hasAttribute("data-scrollbar-y")).toBe(false);
  content.style.height = "400px";
  await expect.poll(() => nested.hasAttribute("data-scrollbar-y")).toBe(true);
  nested.remove();
  await new Promise(requestAnimationFrame);
  expect(nested.isConnected).toBe(false);
});

test("临时绘制层保留复制的滚动条状态，不测量或修改它", async () => {
  setup();
  const layer = document.createElement("div");
  layer.setAttribute("data-scrollbar-static", "");
  host.append(layer);
  const copy = document.createElement("div");
  copy.style.cssText = "width:120px;height:80px;overflow:auto";
  copy.setAttribute("data-scrollbar-y", "");
  layer.append(copy);
  const real = copy.cloneNode() as HTMLElement;
  host.append(real);
  await expect.poll(() => real.hasAttribute("data-scrollbar-y")).toBe(false);
  expect(copy.hasAttribute("data-scrollbar-y")).toBe(true);
});

test("披露动画期间跳过子树扫描，动画结束移除标记后一次性补测滚动条", async () => {
  setup();
  const disclosure = document.createElement("div");
  disclosure.setAttribute("data-disclosure-animating", "");
  const nested = document.createElement("div");
  nested.style.cssText = "width:120px;height:80px;overflow:auto";
  const content = document.createElement("div");
  content.style.height = "400px";
  nested.append(content);
  disclosure.append(nested);
  host.append(disclosure);

  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  expect(nested.hasAttribute("data-scrollbar-y")).toBe(false);

  disclosure.removeAttribute("data-disclosure-animating");
  await expect.poll(() => nested.hasAttribute("data-scrollbar-y")).toBe(true);
});

test("静态标记节点内的文本更新不触发滚动条重测", async () => {
  setup();
  const timer = document.createElement("span");
  timer.setAttribute("data-scrollbar-static", "");
  timer.textContent = "1s";
  host.append(timer);
  await new Promise(requestAnimationFrame);
  expect(timer.hasAttribute("data-scrollbar-y")).toBe(false);
  timer.textContent = "2s";
  await new Promise(requestAnimationFrame);
  expect(timer.hasAttribute("data-scrollbar-y")).toBe(false);
});
