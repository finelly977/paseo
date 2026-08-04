import { describe, expect, test } from "vitest";

import {
  CheckoutStatusResponseSchema,
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("源代码管理协议", () => {
  test.each([
    "checkout.index.stage.request",
    "checkout.index.unstage.request",
    "checkout.working_tree.discard.request",
  ] as const)("解析 %s 请求", (type) => {
    expect(
      SessionInboundMessageSchema.parse({
        type,
        cwd: "/repo",
        paths: ["src/应用.ts"],
        requestId: "request-1",
      }),
    ).toEqual({ type, cwd: "/repo", paths: ["src/应用.ts"], requestId: "request-1" });
  });

  test("拒绝没有文件的写操作", () => {
    expect(() =>
      SessionInboundMessageSchema.parse({
        type: "checkout.index.stage.request",
        cwd: "/repo",
        paths: [],
        requestId: "request-empty",
      }),
    ).toThrow();
  });

  test.each([
    "checkout.index.stage.response",
    "checkout.index.unstage.response",
    "checkout.working_tree.discard.response",
  ] as const)("解析 %s 响应", (type) => {
    expect(
      SessionOutboundMessageSchema.parse({
        type,
        payload: {
          cwd: "/repo",
          success: true,
          error: null,
          requestId: "request-1",
        },
      }),
    ).toMatchObject({ type, payload: { success: true } });
  });

  test("解析分组后的文件状态", () => {
    const parsed = CheckoutStatusResponseSchema.parse({
      type: "checkout_status_response",
      payload: {
        cwd: "/repo",
        isGit: true,
        isPaseoOwnedWorktree: false,
        repoRoot: "/repo",
        mainRepoRoot: null,
        currentBranch: "main",
        isDirty: true,
        stagedFileCount: 1,
        changes: {
          staged: [
            {
              path: "src/renamed.ts",
              originalPath: "src/old.ts",
              status: "renamed",
            },
          ],
          unstaged: [{ path: "src/new.ts", status: "untracked" }],
          conflicts: [{ path: "src/conflict.ts", status: "conflict" }],
        },
        baseRef: "main",
        aheadBehind: { ahead: 0, behind: 0 },
        aheadOfOrigin: null,
        behindOfOrigin: null,
        hasRemote: false,
        remoteUrl: null,
        error: null,
        requestId: "request-status",
      },
    });

    expect(parsed.payload.changes).toEqual({
      staged: [{ path: "src/renamed.ts", originalPath: "src/old.ts", status: "renamed" }],
      unstaged: [{ path: "src/new.ts", status: "untracked" }],
      conflicts: [{ path: "src/conflict.ts", status: "conflict" }],
    });
  });

  test("仍可解析旧守护进程没有文件分组的状态", () => {
    const parsed = CheckoutStatusResponseSchema.parse({
      type: "checkout_status_response",
      payload: {
        cwd: "/repo",
        isGit: true,
        isPaseoOwnedWorktree: false,
        repoRoot: "/repo",
        mainRepoRoot: null,
        currentBranch: "main",
        isDirty: false,
        stagedFileCount: 0,
        baseRef: "main",
        aheadBehind: null,
        aheadOfOrigin: null,
        behindOfOrigin: null,
        hasRemote: false,
        remoteUrl: null,
        error: null,
        requestId: "request-legacy",
      },
    });

    expect(parsed.payload.changes).toBeUndefined();
  });

  test("解析源代码管理操作能力标记", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server-1",
        features: { checkoutScmOperations: true },
      }).features?.checkoutScmOperations,
    ).toBe(true);
  });
});
