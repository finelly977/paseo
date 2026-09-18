import { describe, expect, it } from "vitest";
import {
  COMMIT_INPUT_MAX_HEIGHT,
  COMMIT_INPUT_MIN_HEIGHT,
  resolveCommitInputHeightFromContent,
} from "./commit-input-height";

describe("resolveCommitInputHeightFromContent", () => {
  it("清空后忽略浏览器残留的旧内容高度并恢复单行高度", () => {
    expect(resolveCommitInputHeightFromContent(96, "")).toBe(COMMIT_INPUT_MIN_HEIGHT);
  });

  it("把非空内容高度限制在输入框允许的范围内", () => {
    expect(resolveCommitInputHeightFromContent(12, "a")).toBe(COMMIT_INPUT_MIN_HEIGHT);
    expect(resolveCommitInputHeightFromContent(64.2, "a")).toBe(65);
    expect(resolveCommitInputHeightFromContent(180, "a")).toBe(COMMIT_INPUT_MAX_HEIGHT);
  });
});
