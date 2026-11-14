import * as XLSX from "xlsx";

export const MAX_EXCEL_DISPLAY_ROWS = 2000;
export const MAX_EXCEL_DISPLAY_COLS = 80;

export interface ExcelMergeRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface ParsedExcelSheet {
  name: string;
  rows: string[][];
  colWidths: number[];
  merges: ExcelMergeRange[];
  rowCount: number;
  colCount: number;
  totalRows: number;
  totalCols: number;
  truncatedRows: boolean;
  truncatedCols: boolean;
}

export interface ParsedExcelWorkbook {
  sheets: ParsedExcelSheet[];
}

export function toSpreadsheetColumnLabel(index: number): string {
  let current = index + 1;
  let label = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

function formatWorkbookCell(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  const formatted = XLSX.utils.format_cell(cell);
  if (formatted !== undefined && formatted !== null && formatted !== "") {
    return String(formatted);
  }
  if (cell.v instanceof Date) {
    return cell.v.toISOString().slice(0, 10);
  }
  if (cell.v === undefined || cell.v === null) {
    return "";
  }
  return String(cell.v);
}

function resolveSheetColumnWidths(
  sheet: XLSX.WorkSheet,
  rows: string[][],
  colCount: number,
): number[] {
  const rawCols = Array.isArray(sheet["!cols"]) ? sheet["!cols"] : [];
  const widths = Array.from({ length: colCount }, () => 96);
  const sampleRows = Math.min(rows.length, 60);
  for (let col = 0; col < colCount; col += 1) {
    const colInfo = rawCols[col];
    let charWidth = 0;
    if (typeof colInfo?.wch === "number" && Number.isFinite(colInfo.wch)) {
      charWidth = Math.max(charWidth, colInfo.wch);
    }
    for (let row = 0; row < sampleRows; row += 1) {
      const value = rows[row]?.[col] ?? "";
      if (value.length > 0) {
        const lines = value.split(/\r?\n/);
        for (const line of lines) {
          charWidth = Math.max(charWidth, estimateDisplayWidth(line));
        }
      }
    }
    const pixelWidth = Math.round(charWidth * 8 + 20);
    widths[col] = Math.max(72, Math.min(260, pixelWidth));
  }
  return widths;
}

function estimateDisplayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    width += code > 0xff ? 1.8 : 1;
  }
  return width;
}

function parseSheetMerges(
  sheet: XLSX.WorkSheet,
  rowCount: number,
  colCount: number,
): ExcelMergeRange[] {
  const rawMerges = Array.isArray(sheet["!merges"]) ? sheet["!merges"] : [];
  const merges: ExcelMergeRange[] = [];
  for (const merge of rawMerges) {
    if (merge.s.r >= rowCount || merge.s.c >= colCount) continue;
    merges.push({
      startRow: merge.s.r,
      startCol: merge.s.c,
      endRow: Math.min(merge.e.r, rowCount - 1),
      endCol: Math.min(merge.e.c, colCount - 1),
    });
  }
  return merges;
}

function parseWorksheet(name: string, sheet: XLSX.WorkSheet): ParsedExcelSheet {
  const ref = sheet["!ref"];
  if (!ref) {
    return {
      name,
      rows: [],
      colWidths: [],
      merges: [],
      rowCount: 0,
      colCount: 0,
      totalRows: 0,
      totalCols: 0,
      truncatedRows: false,
      truncatedCols: false,
    };
  }
  const range = XLSX.utils.decode_range(ref);
  const totalRows = Math.max(0, range.e.r + 1);
  const totalCols = Math.max(0, range.e.c + 1);
  const rowCount = Math.min(totalRows, MAX_EXCEL_DISPLAY_ROWS);
  const colCount = Math.min(totalCols, MAX_EXCEL_DISPLAY_COLS);
  const rows: string[][] = [];
  for (let r = 0; r < rowCount; r += 1) {
    const rowValues: string[] = [];
    for (let c = 0; c < colCount; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr] as XLSX.CellObject | undefined;
      rowValues.push(formatWorkbookCell(cell));
    }
    rows.push(rowValues);
  }
  while (rows.length > 0 && rows[rows.length - 1].every((value) => value === "")) {
    rows.pop();
  }
  const effectiveRowCount = rows.length;
  let effectiveColCount = 0;
  for (const row of rows) {
    for (let c = row.length - 1; c >= 0; c -= 1) {
      if (row[c] !== "") {
        effectiveColCount = Math.max(effectiveColCount, c + 1);
        break;
      }
    }
  }
  const trimmedRows = rows.map((row) => row.slice(0, effectiveColCount));
  const merges = parseSheetMerges(sheet, effectiveRowCount, effectiveColCount);
  const colWidths = resolveSheetColumnWidths(sheet, trimmedRows, effectiveColCount);
  return {
    name,
    rows: trimmedRows,
    colWidths,
    merges,
    rowCount: effectiveRowCount,
    colCount: effectiveColCount,
    totalRows,
    totalCols,
    truncatedRows: totalRows > MAX_EXCEL_DISPLAY_ROWS,
    truncatedCols: totalCols > MAX_EXCEL_DISPLAY_COLS,
  };
}

export function parseExcelWorkbook(bytes: Uint8Array): ParsedExcelWorkbook {
  if (bytes.length === 0) {
    throw new Error("Excel 文件为空，无法预览");
  }
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true, cellNF: true });
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error("Excel 工作簿不包含任何工作表");
  }
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) {
      throw new Error(`工作表 ${name} 数据缺失`);
    }
    return parseWorksheet(name, sheet);
  });
  return { sheets };
}
