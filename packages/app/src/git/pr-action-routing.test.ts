import { describe, expect, it, vi } from "vitest";
import type { CheckoutPrStatusPayload } from "./pr-status";
import { openOrCreatePullRequest } from "./pr-action-routing";

function makePayload(
  status: CheckoutPrStatusPayload["status"],
  error: CheckoutPrStatusPayload["error"] = null,
): CheckoutPrStatusPayload {
  return {
    cwd: "/repo",
    status,
    githubFeaturesEnabled: true,
    authState: "authenticated",
    forge: "github",
    error,
    requestId: "request",
  };
}

describe("openOrCreatePullRequest", () => {
  it("点击时查询并打开已有 Pull Request", async () => {
    const open = vi.fn();
    const create = vi.fn();

    await openOrCreatePullRequest({
      refetch: async () => ({
        data: makePayload({
          forge: "github",
          url: "https://github.com/acme/repo/pull/2",
          title: "已有 PR",
          state: "OPEN",
          baseRefName: "main",
          headRefName: "feature",
          isMerged: false,
          isDraft: false,
          mergeable: "UNKNOWN",
          checks: [],
        }),
        error: null,
      }),
      open,
      create,
    });

    expect(open).toHaveBeenCalledWith("https://github.com/acme/repo/pull/2");
    expect(create).not.toHaveBeenCalled();
  });

  it("确认没有 Pull Request 后再创建", async () => {
    const create = vi.fn();

    await openOrCreatePullRequest({
      refetch: async () => ({
        data: makePayload(null),
        error: null,
      }),
      open: vi.fn(),
      create,
    });

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("远端查询失败时保留错误", async () => {
    await expect(
      openOrCreatePullRequest({
        refetch: async () => ({
          data: makePayload(null, { code: "UNKNOWN", message: "GitHub 无法访问" }),
          error: null,
        }),
        open: vi.fn(),
        create: vi.fn(),
      }),
    ).rejects.toThrow("GitHub 无法访问");
  });
});
