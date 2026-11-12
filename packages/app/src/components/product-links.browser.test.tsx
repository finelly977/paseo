import React from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { expect, test, vi } from "vitest";
import { CommunityLinks } from "./community-links";

test("欢迎页的社区入口仅打开二开仓库，不展示原作者的赞助或社群", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "zh-CN", resources: {} });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const find = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (id: string) => {
    const element = find(id);
    if (!element) throw new Error(`缺少导航入口：${id}`);
    element.click();
  };

  try {
    root.render(
      <I18nextProvider i18n={i18n}>
        <CommunityLinks />
      </I18nextProvider>,
    );
    await expect.poll(() => find("community-links-github-star")).not.toBeNull();
    expect(find("community-links-sponsor")).toBeNull();
    expect(find("community-links-discord")).toBeNull();
    click("community-links-github-star");
    expect(open).toHaveBeenLastCalledWith(
      "https://github.com/finelly977/paseo",
      "_blank",
      "noopener,noreferrer",
    );
  } finally {
    root.unmount();
    host.remove();
    open.mockRestore();
  }
});
