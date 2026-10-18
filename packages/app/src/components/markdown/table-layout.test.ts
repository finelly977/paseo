import { describe, expect, it } from "vitest";
import {
  collectTableColumnDemands,
  allocateTableColumnWidths,
  type TableContentNode,
} from "./table-layout";

function cell(text: string, type = "td"): TableContentNode {
  return { type, content: "", children: [{ type: "text", content: text, children: [] }] };
}
function table(rows: TableContentNode[][]): TableContentNode {
  return {
    type: "table",
    content: "",
    children: [
      {
        type: "tbody",
        content: "",
        children: rows.map((children) => ({ type: "tr", content: "", children })),
      },
    ],
  };
}

describe("Markdown 内容列宽", () => {
  it("短能力名收窄，较长证据与说明获得更多空间，分配不浪费总宽度", () => {
    const demands = collectTableColumnDemands(
      table([
        [cell("能力", "th"), cell("当前状态及证据", "th"), cell("缺口或下一步", "th")],
        [
          cell("改名、归档"),
          cell("已支持 thread/name/set；原生归档与释放运行时流程"),
          cell("保留既有完整恢复及去重约束，不退化为只读尾页"),
        ],
        [
          cell("模型、思考、Fast"),
          cell("模型目录读取服务档位并将实际值同步到当前会话"),
          cell("官方新增档位必须按目录识别，不能假设一律叫 priority"),
        ],
      ]),
    );
    const widths = allocateTableColumnWidths(demands, 1000, 14, 8);
    expect(widths[0]).toBeLessThan(widths[1] * 0.7);
    expect(widths[0]).toBeLessThan(widths[2] * 0.7);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(1000);
  });

  it("列宽依据所有行而非只看首行，长表头也参与分配", () => {
    const demand = collectTableColumnDemands(
      table([
        [cell("名", "th"), cell("这是一项较长的说明标题", "th")],
        [cell("短"), cell("短")],
        [cell("正文里也可能有更长的项目名称"), cell("短")],
      ]),
    );
    expect(demand[0]).toBeGreaterThan(3);
    expect(demand[1]).toBeGreaterThan(10);
  });

  it("使用链接文字和代码可见内容，不因链接地址或 Markdown 标记给列加宽", () => {
    const link: TableContentNode = {
      type: "link",
      content: "",
      children: [{ type: "text", content: "说明", children: [] }],
    };
    const node = table([[{ type: "td", content: "", children: [link] }, cell("说明")]]);
    expect(collectTableColumnDemands(node)).toEqual([3, 3]);
    const latin = collectTableColumnDemands(table([[cell("ABCD"), cell("中文宽度")]]));
    expect(latin).toEqual([3, 4]);
  });

  it("单个异常长代码不独占表宽，仍保留两列说明的空间", () => {
    const rows = Array.from({ length: 10 }, () => [
      cell("状态"),
      cell("普通说明文字"),
      cell("需要检查的后续步骤"),
    ]);
    rows.push([cell("x".repeat(2000)), cell("说明"), cell("步骤")]);
    const widths = allocateTableColumnWidths(collectTableColumnDemands(table(rows)), 900, 14, 8);
    expect(widths[0]).toBeLessThan(900 * 0.4);
    expect(widths[2]).toBeGreaterThan(widths[0]);
  });

  it("窄屏长表保留可读列宽并横向滚动，短数值表仍能容纳在屏幕内", () => {
    const wide = allocateTableColumnWidths([8, 40, 48], 320, 14, 8);
    expect(wide.reduce((sum, width) => sum + width, 0)).toBeGreaterThan(320);
    expect(wide[1]).toBeGreaterThanOrEqual(12 * 14);
    const compact = allocateTableColumnWidths([3, 3, 3], 320, 14, 8);
    expect(compact.reduce((sum, width) => sum + width, 0)).toBeCloseTo(320);
  });

  it("相同内容的列保持同宽，字号和内边距调整后仍不产生非法尺寸", () => {
    expect(allocateTableColumnWidths([3, 3], 400, 14, 8)).toEqual([200, 200]);
    expect(allocateTableColumnWidths([], 400, 14, 8)).toEqual([]);
    const widths = allocateTableColumnWidths([3, 48], 320, 24, 12);
    expect(widths.every((width) => Number.isFinite(width) && width > 0)).toBe(true);
    expect(widths[1]).toBeGreaterThan(widths[0]);
  });
});
