import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseExcelWorkbook, toSpreadsheetColumnLabel } from "./excel-model";
import { getDocumentPreviewKind, validatePdfPreviewBytes, validateWordPreviewBytes } from "./model";

describe("document preview model", () => {
  it("identifies pdf, word, and excel files by extension and mime type", () => {
    expect(getDocumentPreviewKind("reports/q1.pdf")).toBe("pdf");
    expect(getDocumentPreviewKind("docs/spec.docx")).toBe("word");
    expect(getDocumentPreviewKind("docs/legacy.doc")).toBe("word");
    expect(getDocumentPreviewKind("sheets/budget.xlsx")).toBe("excel");
    expect(getDocumentPreviewKind("sheets/old.xls")).toBe("excel");
    expect(getDocumentPreviewKind("sheets/data.ods")).toBe("excel");
    expect(getDocumentPreviewKind("blob", "application/pdf")).toBe("pdf");
    expect(getDocumentPreviewKind("archive.zip", "application/zip")).toBeNull();
  });

  it("validates word and pdf binary headers", () => {
    expect(() => validatePdfPreviewBytes(new TextEncoder().encode("%PDF-1.7\n"))).not.toThrow();
    expect(() => validatePdfPreviewBytes(new Uint8Array([1, 2, 3]))).toThrow(
      "PDF 文件格式无效或已损坏",
    );

    expect(() => validateWordPreviewBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).not.toThrow();
    expect(() =>
      validateWordPreviewBytes(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toThrow("暂不支持旧版 .doc 二进制格式预览");
  });

  it("parses multi-sheet excel workbooks with merges and column labels", () => {
    expect(toSpreadsheetColumnLabel(0)).toBe("A");
    expect(toSpreadsheetColumnLabel(25)).toBe("Z");
    expect(toSpreadsheetColumnLabel(26)).toBe("AA");

    const wb = XLSX.utils.book_new();
    const sheet1 = XLSX.utils.aoa_to_sheet([
      ["项目", "金额", "备注"],
      ["办公", 1200, "已完成"],
    ]);
    sheet1["!merges"] = [{ s: { r: 0, c: 1 }, e: { r: 0, c: 2 } }];
    const sheet2 = XLSX.utils.aoa_to_sheet([["第二页"]]);
    XLSX.utils.book_append_sheet(wb, sheet1, "预算");
    XLSX.utils.book_append_sheet(wb, sheet2, "说明");

    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = parseExcelWorkbook(new Uint8Array(buffer));

    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(["预算", "说明"]);
    expect(parsed.sheets[0].rows).toEqual([
      ["项目", "金额", "备注"],
      ["办公", "1200", "已完成"],
    ]);
    expect(parsed.sheets[0].merges).toEqual([{ startRow: 0, startCol: 1, endRow: 0, endCol: 2 }]);
    expect(parsed.sheets[0].colWidths.length).toBe(3);
    expect(parsed.sheets[1].rows).toEqual([["第二页"]]);
  });
});
