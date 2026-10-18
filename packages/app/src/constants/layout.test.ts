import { describe, expect, test } from "vitest";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  MAX_CHAT_CONTENT_WIDTH,
  MAX_CONTENT_WIDTH,
  WORKSPACE_SECONDARY_HEADER_HEIGHT,
  WORKSPACE_TAB_BAR_HEIGHT,
} from "./layout";

test("桌面主工具栏收至 40 像素，不再缩小标签栏、次级工具栏和移动端导航", () => {
  expect(HEADER_INNER_HEIGHT).toBe(40);
  expect(HEADER_INNER_HEIGHT_MOBILE).toBe(56);
  expect(WORKSPACE_TAB_BAR_HEIGHT).toBe(32);
  expect(WORKSPACE_SECONDARY_HEADER_HEIGHT).toBe(36);
});

describe("对话内容宽度", () => {
  test("正文与输入共用缩窄十分之一的上限，文件和表单宽度不变", () => {
    expect(MAX_CHAT_CONTENT_WIDTH).toBe(738);
    expect(MAX_CHAT_CONTENT_WIDTH).toBe(MAX_CONTENT_WIDTH * 0.9);
    expect(MAX_CONTENT_WIDTH).toBe(820);
  });
});
