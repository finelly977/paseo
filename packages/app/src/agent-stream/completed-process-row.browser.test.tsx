import React, { useState, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderCompletedProcessRow } from "./completed-process-row";
import type { StreamFrameChildOrder } from "./strategy";

let root: Root | null = null;
let host: HTMLDivElement;
const FORWARD_STYLE = { display: "flex", flexDirection: "column" } as const;
const INVERTED_STYLE = { display: "flex", flexDirection: "column-reverse" } as const;
const PROCESS_STYLE = { height: 400 };
afterEach(() => {
  root?.unmount();
  host.remove();
});

function ProcessFixture({ order }: { order: StreamFrameChildOrder }) {
  const [expanded, setExpanded] = useState(false);
  const onToggle = useCallback(() => setExpanded((value) => !value), []);
  const toggle = (
    <button type="button" data-toggle onClick={onToggle}>
      已处理
    </button>
  );
  const content = expanded ? (
    <div data-process style={PROCESS_STYLE}>
      第一条过程回复
    </div>
  ) : null;
  return (
    <div style={order === "footer-then-content" ? INVERTED_STYLE : FORWARD_STYLE}>
      {renderCompletedProcessRow({ order, toggle, content })}
    </div>
  );
}

describe("完成过程入口顺序", () => {
  it.each(["content-then-footer", "footer-then-content"] as const)(
    "%s 展开后入口仍在首条过程之前",
    async (order) => {
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      root.render(<ProcessFixture order={order} />);
      await vi.waitFor(() => expect(host.querySelector("[data-toggle]")).not.toBeNull());
      const toggle = host.querySelector<HTMLButtonElement>("[data-toggle]");
      if (!toggle) throw new Error("未渲染过程入口");
      const initialTop = toggle.getBoundingClientRect().top;
      toggle.click();
      await vi.waitFor(() => expect(host.querySelector("[data-process]")).not.toBeNull());
      const process = host.querySelector<HTMLElement>("[data-process]");
      if (!process) throw new Error("过程未展开");
      expect(toggle.getBoundingClientRect().top).toBe(initialTop);
      expect(toggle.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        process.getBoundingClientRect().top,
      );
    },
  );
});
