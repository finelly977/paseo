import { describe, expect, it } from "vitest";
import { createNewWorkspaceDraftTabDescriptor } from "./new-workspace-draft-shell-model";

describe("createNewWorkspaceDraftTabDescriptor", () => {
  it("creates a closeable client-only draft tab without a workspace record", () => {
    expect(createNewWorkspaceDraftTabDescriptor("draft-1")).toEqual({
      key: "draft-1",
      tabId: "draft-1",
      kind: "draft",
      target: { kind: "draft", draftId: "draft-1" },
    });
  });

  it("rejects an empty draft id", () => {
    expect(() => createNewWorkspaceDraftTabDescriptor("  ")).toThrow(
      "新建会话草稿需要有效的草稿标识",
    );
  });
});
