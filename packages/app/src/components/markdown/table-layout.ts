export interface TableContentNode {
  type: string;
  content: string;
  children: readonly TableContentNode[];
}

const WIDE_CHARACTER =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\u3000-\u303F\uFF01-\uFF60]/u;
const ZERO_WIDTH_CHARACTER = /\p{Mark}|\u200D/u;

function visibleText(node: TableContentNode): string {
  if (node.type === "softbreak" || node.type === "hardbreak") return "\n";
  return node.children.length ? node.children.map(visibleText).join("") : node.content;
}

/** 按可见字符估算 em：中日韩文字/表情约一字宽，拉丁字符约半字宽。 */
function cellWidthInEm(node: TableContentNode): number {
  return visibleText(node)
    .split("\n")
    .reduce((maximum, line) => {
      let width = 0;
      for (const character of line) {
        if (!ZERO_WIDTH_CHARACTER.test(character))
          width += WIDE_CHARACTER.test(character) ? 1 : 0.55;
      }
      return Math.max(maximum, width);
    }, 0);
}

export function collectTableColumnDemands(table: TableContentNode): number[] {
  const columns: number[][] = [];
  const headers: number[] = [];
  function visit(node: TableContentNode): void {
    if (node.type === "tr") {
      node.children.forEach((cell, index) => {
        const width = cellWidthInEm(cell);
        (columns[index] ??= []).push(width);
        if (cell.type === "th") headers[index] = width;
      });
      return;
    }
    node.children.forEach(visit);
  }
  visit(table);
  return columns.map((widths, index) => {
    widths.sort((a, b) => a - b);
    const typical = widths[Math.floor((widths.length - 1) * 0.8)];
    // 单个超长地址/代码不独占表宽，同时为短表头保留自然宽度。
    return Math.max(
      3,
      Math.min(
        48,
        Math.max(headers[index] ?? 0, Math.min(widths[widths.length - 1], typical * 1.5 + 4)),
      ),
    );
  });
}

export function allocateTableColumnWidths(
  demands: readonly number[],
  availableWidth: number,
  fontSize: number,
  padding: number,
): number[] {
  if (demands.length === 0) return [];
  const preferred = demands.map((em) => em * fontSize + padding * 2 + 1);
  const minimum = demands.map((em) => Math.min(em, 12) * fontSize + padding * 2 + 1);
  const minimumTotal = minimum.reduce((sum, width) => sum + width, 0);
  const preferredTotal = preferred.reduce((sum, width) => sum + width, 0);
  const budget = Math.max(availableWidth, minimumTotal);
  if (budget >= preferredTotal) {
    return preferred.map((width) => (width * budget) / preferredTotal);
  }
  const growth = budget - minimumTotal;
  return minimum.map(
    (width, index) =>
      width + (growth * (preferred[index] - width)) / (preferredTotal - minimumTotal),
  );
}
