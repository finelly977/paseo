/**
 * @vitest-environment jsdom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProviderUsage } from "./use-provider-usage";

const runtime = vi.hoisted(() => ({
  client: {
    listProviderUsage: vi.fn(async () => ({
      requestId: "request-1",
      fetchedAt: "2026-09-18T00:00:00.000Z",
      providers: [],
    })),
  },
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => runtime.client,
  useHostRuntimeIsConnected: () => true,
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sessions: {
        "server-1": {
          serverInfo: { features: { providerUsageList: true } },
        },
      },
    }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useProviderUsage", () => {
  beforeEach(() => {
    runtime.client.listProviderUsage.mockClear();
  });

  it("关闭后既不自动探测，也不允许手动刷新触发探测", async () => {
    const { result } = renderHook(() => useProviderUsage("server-1", { enabled: false }), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(runtime.client.listProviderUsage).not.toHaveBeenCalled();
  });

  it("重新启用后恢复账户额度探测", async () => {
    const { rerender } = renderHook(({ enabled }) => useProviderUsage("server-1", { enabled }), {
      initialProps: { enabled: false },
      wrapper: createWrapper(),
    });

    rerender({ enabled: true });

    await waitFor(() => expect(runtime.client.listProviderUsage).toHaveBeenCalledTimes(1));
  });
});
