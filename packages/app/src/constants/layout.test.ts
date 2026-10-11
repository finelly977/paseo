import { describe, expect, test } from "vitest";
import { MAX_CHAT_CONTENT_WIDTH, MAX_CONTENT_WIDTH } from "./layout";

describe("对话内容宽度", () => {
  test("正文与输入共用缩窄十分之一的上限，文件和表单宽度不变", () => {
    expect(MAX_CHAT_CONTENT_WIDTH).toBe(738);
    expect(MAX_CHAT_CONTENT_WIDTH).toBe(MAX_CONTENT_WIDTH * 0.9);
    expect(MAX_CONTENT_WIDTH).toBe(820);
  });
});
