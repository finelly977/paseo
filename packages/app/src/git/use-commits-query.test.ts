import { describe, expect, it, vi } from "vitest";
import { resolveCheckoutCommitsQueryResult, type CheckoutCommitsData } from "./use-commits-query";

vi.hoisted(() => {
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
});

const EMPTY_COMMITS: CheckoutCommitsData = {
  baseRef: "main",
  commits: [],
  availableRefs: [],
  headSha: null,
  currentRef: null,
  upstreamRef: null,
};
const PAGINATION = {
  hasNextPage: false,
  isFetchingNextPage: false,
  loadMore: () => {},
};

describe("resolveCheckoutCommitsQueryResult", () => {
  it("stays idle while the collapsed section has never loaded", () => {
    expect(
      resolveCheckoutCommitsQueryResult({
        enabled: false,
        capabilityPresent: true,
        canFetch: true,
        data: undefined,
        isPlaceholderData: false,
        error: null,
        pagination: PAGINATION,
      }),
    ).toEqual({ status: "idle" });
  });

  it("reports loading instead of an empty result while the first request is pending", () => {
    expect(
      resolveCheckoutCommitsQueryResult({
        enabled: true,
        capabilityPresent: true,
        canFetch: true,
        data: undefined,
        isPlaceholderData: false,
        error: null,
        pagination: PAGINATION,
      }),
    ).toEqual({ status: "loading" });
  });

  it("types an empty commit list as loaded data", () => {
    expect(
      resolveCheckoutCommitsQueryResult({
        enabled: true,
        capabilityPresent: true,
        canFetch: true,
        data: EMPTY_COMMITS,
        isPlaceholderData: false,
        error: null,
        pagination: PAGINATION,
      }),
    ).toEqual({ status: "loaded", data: EMPTY_COMMITS, ...PAGINATION });
  });

  it("surfaces a cold-load error", () => {
    const error = new Error("git log failed");
    expect(
      resolveCheckoutCommitsQueryResult({
        enabled: true,
        capabilityPresent: true,
        canFetch: true,
        data: undefined,
        isPlaceholderData: false,
        error,
        pagination: PAGINATION,
      }),
    ).toEqual({ status: "error", error });
  });

  it("keeps cached data available while collapsed", () => {
    expect(
      resolveCheckoutCommitsQueryResult({
        enabled: false,
        capabilityPresent: true,
        canFetch: true,
        data: EMPTY_COMMITS,
        isPlaceholderData: false,
        error: null,
        pagination: PAGINATION,
      }),
    ).toEqual({ status: "loaded", data: EMPTY_COMMITS, ...PAGINATION });
  });

  it("keeps previous-checkout placeholder data in loading state", () => {
    expect(
      resolveCheckoutCommitsQueryResult({
        enabled: true,
        capabilityPresent: true,
        canFetch: true,
        data: EMPTY_COMMITS,
        isPlaceholderData: true,
        error: null,
        pagination: PAGINATION,
      }),
    ).toEqual({ status: "loading" });
  });
});
