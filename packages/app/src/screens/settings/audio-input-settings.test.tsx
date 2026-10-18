/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { afterEach, expect, it, vi } from "vitest";
import { AudioInputSettingsRows } from "./audio-input-settings";
import {
  APP_SETTINGS_KEY,
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_CLIENT_SETTINGS,
} from "@/hooks/use-settings/storage";
import { i18n } from "@/i18n/i18next";

// 外部原生存储使用 DOM 存储适配器；设置组件、Switch、持久化逻辑及 QueryClient 均参与测试。
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => localStorage.getItem(key),
    setItem: async (key: string, value: string) => localStorage.setItem(key, value),
    removeItem: async (key: string) => localStorage.removeItem(key),
    clear: async () => localStorage.clear(),
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("react-native-unistyles", async () => {
  const { lightTheme } = await import("@/styles/theme");
  return {
    StyleSheet: {
      create: (styles: unknown) => (typeof styles === "function" ? styles(lightTheme) : styles),
    },
    withUnistyles: (Component: unknown) => Component,
  };
});

// 动画库不参与开关行为测试。
vi.mock("react-native-reanimated", async () => {
  const { View } = await import("react-native");
  return {
    default: { View },
    Easing: { bezier: () => (t: number) => t },
    interpolateColor: (value: number, _input: number[], output: string[]) =>
      output[value >= 1 ? 1 : 0],
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useDerivedValue: (factory: () => unknown) => ({ value: factory() }),
    withTiming: (value: number) => value,
  };
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let queryClient: QueryClient | null = null;
afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  queryClient?.clear();
  vi.restoreAllMocks();
  await AsyncStorage.clear();
});

async function renderSettings() {
  await i18n.changeLanguage("zh-CN");
  await AsyncStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(DEFAULT_CLIENT_SETTINGS));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = queryClient;
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client}>
        <AudioInputSettingsRows />
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() =>
    expect(
      host
        ?.querySelector('[data-testid="audio-setting-dictationEnabled"]')
        ?.getAttribute("aria-disabled"),
    ).not.toBe("true"),
  );
}

it("设置显示两个独立开关，关闭一个不会改变另一个，重新挂载保留选择", async () => {
  await renderSettings();
  const dictation = host?.querySelector<HTMLElement>(
    '[data-testid="audio-setting-dictationEnabled"]',
  );
  if (!dictation) throw new Error("听写开关未显示");
  await act(async () => {
    dictation.click();
  });
  await vi.waitFor(() => expect(dictation.getAttribute("aria-checked")).toBe("false"));
  expect(
    host
      ?.querySelector('[data-testid="audio-setting-voiceModeEnabled"]')
      ?.getAttribute("aria-checked"),
  ).toBe("true");
  expect(JSON.parse((await AsyncStorage.getItem(APP_SETTINGS_KEY)) ?? "null")).toMatchObject({
    dictationEnabled: false,
    voiceModeEnabled: true,
  });
  await act(async () => {
    root?.unmount();
  });
  if (!host || !queryClient) throw new Error("设置测试未初始化");
  root = createRoot(host);
  queryClient.removeQueries({ queryKey: APP_SETTINGS_QUERY_KEY });
  const client = queryClient;
  await act(async () => {
    root?.render(
      <QueryClientProvider client={client}>
        <AudioInputSettingsRows />
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() =>
    expect(
      host
        ?.querySelector('[data-testid="audio-setting-dictationEnabled"]')
        ?.getAttribute("aria-checked"),
    ).toBe("false"),
  );
});

it("保存失败显示原因与重试，开关不假装已关闭", async () => {
  await renderSettings();
  const dictation = host?.querySelector<HTMLElement>(
    '[data-testid="audio-setting-dictationEnabled"]',
  );
  if (!dictation) throw new Error("听写开关未显示");
  vi.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("磁盘已满"));
  await act(async () => {
    dictation.click();
  });
  await vi.waitFor(() => expect(host?.textContent).toContain("磁盘已满"));
  expect(dictation.getAttribute("aria-checked")).toBe("true");
  const retry = Array.from(host?.querySelectorAll<HTMLElement>('[role="button"]') ?? []).find(
    (button) => button.textContent === "重试",
  );
  if (!retry) throw new Error("保存失败没有重试入口");
  await act(async () => {
    retry.click();
  });
  await vi.waitFor(() => expect(dictation.getAttribute("aria-checked")).toBe("false"));
  expect(host?.textContent).not.toContain("磁盘已满");
});

it("保存期间显示进度并锁定两个开关，避免重复点击和互相覆盖", async () => {
  await renderSettings();
  const dictation = host?.querySelector<HTMLElement>(
    '[data-testid="audio-setting-dictationEnabled"]',
  );
  const voiceMode = host?.querySelector<HTMLElement>(
    '[data-testid="audio-setting-voiceModeEnabled"]',
  );
  if (!dictation || !voiceMode) throw new Error("语音设置开关未显示");
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const setItem = AsyncStorage.setItem;
  const write = vi.spyOn(AsyncStorage, "setItem").mockImplementationOnce(async (key, value) => {
    await pending;
    await setItem(key, value);
  });
  await act(async () => {
    dictation.click();
  });
  await vi.waitFor(() => expect(host?.textContent).toContain("正在保存"));
  expect(dictation.getAttribute("aria-disabled")).toBe("true");
  expect(voiceMode.getAttribute("aria-disabled")).toBe("true");
  await act(async () => {
    dictation.click();
    voiceMode.click();
  });
  expect(write).toHaveBeenCalledTimes(1);
  if (!release) throw new Error("保存操作尚未开始");
  const finishSave = release;
  await act(async () => {
    finishSave();
  });
  await vi.waitFor(() => expect(dictation.getAttribute("aria-checked")).toBe("false"));
  expect(voiceMode.getAttribute("aria-checked")).toBe("true");
});
