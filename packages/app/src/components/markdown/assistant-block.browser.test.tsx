import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AssistantMessageBlockContainer } from "./assistant-block";
import { MAX_CHAT_CONTENT_WIDTH } from "@/constants/layout";
import {
  clearAssistantMessageHeightEstimateCache,
  estimateAssistantMessageHeightFromCache,
} from "@/utils/assistant-message-height-estimate";

const blockStyle = { height: "85.25px" };
const tallerBlockStyle = { height: "125.5px" };
let root: Root | null = null;
let host: HTMLDivElement;

afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
  vi.restoreAllMocks();
  clearAssistantMessageHeightEstimateCache();
});

it("正文块进入视口及增高时直接缓存尺寸，不为每段遍历祖先位置", async () => {
  host = document.createElement("div");
  host.style.width = `${MAX_CHAT_CONTENT_WIDTH - 16}px`;
  document.body.appendChild(host);
  const absolutePositionRead = vi.spyOn(HTMLElement.prototype, "offsetLeft", "get");
  root = createRoot(host);
  root.render(
    <AssistantMessageBlockContainer block="实测正文" marginBottom={8}>
      <div data-testid="block-content" style={blockStyle}>
        实测正文
      </div>
    </AssistantMessageBlockContainer>,
  );
  await expect.poll(() => estimateAssistantMessageHeightFromCache("实测正文")).toBe(110);
  expect(absolutePositionRead).not.toHaveBeenCalled();
  root.render(
    <AssistantMessageBlockContainer block="实测正文" marginBottom={8}>
      <div data-testid="block-content" style={tallerBlockStyle}>
        实测正文
      </div>
    </AssistantMessageBlockContainer>,
  );
  await expect.poll(() => estimateAssistantMessageHeightFromCache("实测正文")).toBe(150);
  host.style.display = "none";
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(estimateAssistantMessageHeightFromCache("实测正文")).toBe(150);
  host.style.display = "block";
  await expect.poll(() => host.getBoundingClientRect().width).toBe(MAX_CHAT_CONTENT_WIDTH - 16);
  expect(absolutePositionRead).not.toHaveBeenCalled();
});

it("复用正文块节点更新文本后，尺寸缓存归属新文本，隐藏期间保留最近有效高度", async () => {
  host = document.createElement("div");
  host.style.width = `${MAX_CHAT_CONTENT_WIDTH - 16}px`;
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <AssistantMessageBlockContainer block="旧正文" marginBottom={0}>
      <div style={blockStyle}>旧正文</div>
    </AssistantMessageBlockContainer>,
  );
  await expect.poll(() => estimateAssistantMessageHeightFromCache("旧正文")).toBe(110);
  root.render(
    <AssistantMessageBlockContainer block="新正文" marginBottom={0}>
      <div style={tallerBlockStyle}>新正文</div>
    </AssistantMessageBlockContainer>,
  );
  await expect.poll(() => estimateAssistantMessageHeightFromCache("新正文")).toBe(150);
  expect(estimateAssistantMessageHeightFromCache("旧正文")).toBe(110);
  host.style.display = "none";
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  expect(estimateAssistantMessageHeightFromCache("新正文")).toBe(150);
  host.style.display = "block";
  await expect.poll(() => host.getBoundingClientRect().width).toBe(MAX_CHAT_CONTENT_WIDTH - 16);
  expect(estimateAssistantMessageHeightFromCache("新正文")).toBe(150);
});
