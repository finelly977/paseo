import { describe, expect, it } from "vitest";

import {
  USER_MESSAGE_COLLAPSE_CHARACTER_THRESHOLD,
  USER_MESSAGE_COLLAPSE_LINE_THRESHOLD,
  shouldCollapseUserMessage,
} from "./user-message-collapse";

describe("用户消息折叠判定", () => {
  it("普通提示词保持展开", () => {
    expect(shouldCollapseUserMessage("请检查这个文件的实现")).toBe(false);
    expect(shouldCollapseUserMessage("\n  \n")).toBe(false);
  });

  it("多行提示词默认折叠", () => {
    const message = Array.from(
      { length: USER_MESSAGE_COLLAPSE_LINE_THRESHOLD + 1 },
      (_, index) => `第 ${index + 1} 行`,
    ).join("\n");

    expect(shouldCollapseUserMessage(message)).toBe(true);
  });

  it("超长单行提示词默认折叠", () => {
    expect(
      shouldCollapseUserMessage("x".repeat(USER_MESSAGE_COLLAPSE_CHARACTER_THRESHOLD + 1)),
    ).toBe(true);
  });

  it("正好达到阈值时不折叠", () => {
    const message = Array.from({ length: USER_MESSAGE_COLLAPSE_LINE_THRESHOLD }, () => "line").join(
      "\n",
    );
    expect(shouldCollapseUserMessage(message)).toBe(false);
  });
});
