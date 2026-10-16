import React, { type ReactNode } from "react";
import type { StreamFrameChildOrder } from "./strategy";

export function renderCompletedProcessRow(input: {
  order: StreamFrameChildOrder;
  toggle: ReactNode;
  content: ReactNode;
}) {
  // 原生倒置单元使用 column-reverse，入口必须与正文一起遵循行内顺序。
  if (input.order === "footer-then-content")
    return (
      <>
        {input.content}
        {input.toggle}
      </>
    );
  return (
    <>
      {input.toggle}
      {input.content}
    </>
  );
}
