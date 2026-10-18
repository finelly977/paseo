import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { View, Text } from "react-native";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownTable, MarkdownTableCell } from "./table";
import type { TableContentNode } from "./table-layout";

const rows = [
  ["能力", "当前状态及证据", "缺口或下一步"],
  [
    "改名、归档",
    "已支持原生改名、归档以及释放运行时流程",
    "保留既有完整恢复及去重约束，不退化为只读尾页",
  ],
  [
    "模型与思考",
    "目录读取有效模型并同步当前值",
    "官方新增档位必须按目录识别，不能假设一律叫 priority",
  ],
];
const node: TableContentNode = {
  type: "table",
  content: "",
  children: rows.map((row, index) => ({
    type: "tr",
    content: "",
    children: row.map((content) => ({ type: index ? "td" : "th", content, children: [] })),
  })),
};
const rowStyle = { flexDirection: "row" as const };
const tableStyle = { borderWidth: 1 };
const cellStyle = { padding: 8, flex: 1 };
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

function TableFixture() {
  return (
    <MarkdownTable node={node} style={tableStyle} fontSize={14} padding={8}>
      {rows.map((row) => (
        <View key={row.join("|")} style={rowStyle}>
          {row.map((text, column) => (
            <MarkdownTableCell key={text} column={column} style={cellStyle}>
              <Text>{text}</Text>
            </MarkdownTableCell>
          ))}
        </View>
      ))}
    </MarkdownTable>
  );
}

function widths(): number[] {
  if (!host) throw new Error("未挂载表格");
  const container = host;
  return [0, 1, 2].map((column) => {
    const cells = [
      ...container.querySelectorAll<HTMLElement>(`[data-testid="markdown-table-column-${column}"]`),
    ];
    if (cells.length !== 3) throw new Error("表格单元格未完整渲染");
    const measured = cells.map((cell) => cell.getBoundingClientRect());
    expect(measured[1].width).toBeCloseTo(measured[0].width);
    expect(measured[2].x).toBeCloseTo(measured[0].x);
    return measured[0].width;
  });
}

it("真实布局按内容分配、表头正文对齐，收窄及重新放宽时同步重排", async () => {
  host = document.createElement("div");
  host.style.width = "1000px";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<TableFixture />);
  await vi.waitFor(() =>
    expect(widths().reduce((sum, width) => sum + width, 0)).toBeCloseTo(998, 0),
  );
  const desktop = widths();
  expect(desktop[0]).toBeLessThan(desktop[1] * 0.7);
  expect(desktop[2]).toBeGreaterThan(desktop[0]);
  host.style.width = "320px";
  await vi.waitFor(() => expect(widths().reduce((sum, width) => sum + width, 0)).toBeLessThan(998));
  expect(widths().reduce((sum, width) => sum + width, 0)).toBeGreaterThan(320);
  expect(host.getBoundingClientRect().width).toBe(320);
  host.style.width = "900px";
  await vi.waitFor(() =>
    expect(widths().reduce((sum, width) => sum + width, 0)).toBeCloseTo(898, 0),
  );
});
