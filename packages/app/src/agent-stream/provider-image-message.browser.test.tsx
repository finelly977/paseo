import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

vi.mock("@/components/message", () => ({
  AssistantMarkdownImage: ({ source, alt }: { source: string; alt: string }) => (
    <img src={source} alt={alt} />
  ),
}));
vi.mock("lucide-react-native", () => ({
  ChevronDown: (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />,
  Images: (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />,
}));

import { ProviderImageMessage } from "./provider-image-message";

let root: Root | null = null;
let host: HTMLDivElement;
const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({
    lng: "zh-CN",
    resources: {
      "zh-CN": { translation: { message: { attachments: { viewedImage: "已查看 1 张图像" } } } },
    },
  });
});

afterEach(() => {
  root?.unmount();
  root = null;
  host.remove();
});

test("已查看图像默认收起，用户点击后才挂载预览", async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <I18nextProvider i18n={i18n}>
      <ProviderImageMessage
        source="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
        alt="预览"
        client={null}
        workspaceRoot="C:\\repo"
        serverId="host"
      />
    </I18nextProvider>,
  );

  await vi.waitFor(() =>
    expect(host.querySelector('[data-testid="provider-image-collapse-toggle"]')).not.toBeNull(),
  );
  const toggle = host.querySelector<HTMLElement>('[data-testid="provider-image-collapse-toggle"]');
  if (!toggle) throw new Error("图片折叠入口未渲染");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector('[data-testid="provider-image-collapse-content"] img')).toBeNull();

  toggle.click();
  await vi.waitFor(() => expect(toggle.getAttribute("aria-expanded")).toBe("true"));
  expect(host.querySelector('[data-testid="provider-image-collapse-content"]')).not.toBeNull();
});
