export type DocumentPreviewKind = "pdf" | "word" | "excel";

const PDF_EXTENSIONS = new Set(["pdf"]);
const WORD_EXTENSIONS = new Set(["doc", "docx", "docm", "dotx"]);
const EXCEL_EXTENSIONS = new Set(["xls", "xlsx", "xlsm", "xlsb", "ods"]);

const PDF_MIME_TYPES = new Set(["application/pdf"]);
const WORD_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-word.document.macroenabled.12",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
]);
const EXCEL_MIME_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

function extractFileExtension(filePath: string): string | null {
  const normalized = filePath.trim().toLowerCase();
  const slashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const fileName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return null;
  return fileName.slice(dotIndex + 1);
}

export function getDocumentPreviewKind(
  filePath: string,
  mimeType?: string,
): DocumentPreviewKind | null {
  const ext = extractFileExtension(filePath);
  if (ext) {
    if (PDF_EXTENSIONS.has(ext)) return "pdf";
    if (WORD_EXTENSIONS.has(ext)) return "word";
    if (EXCEL_EXTENSIONS.has(ext)) return "excel";
  }
  const normalizedMime = mimeType?.split(";")[0]?.trim().toLowerCase();
  if (normalizedMime) {
    if (PDF_MIME_TYPES.has(normalizedMime)) return "pdf";
    if (WORD_MIME_TYPES.has(normalizedMime)) return "word";
    if (EXCEL_MIME_TYPES.has(normalizedMime)) return "excel";
  }
  return null;
}

export function hasZipMagicBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

export function hasOle2MagicBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  );
}

export function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 1024);
  for (let i = 0; i + 4 < limit; i += 1) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46 &&
      bytes[i + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

export function validateWordPreviewBytes(bytes: Uint8Array): void {
  if (bytes.length === 0) {
    throw new Error("Word 文档为空，无法预览");
  }
  if (hasOle2MagicBytes(bytes)) {
    throw new Error("暂不支持旧版 .doc 二进制格式预览，请转换为 .docx 后查看");
  }
  if (!hasZipMagicBytes(bytes)) {
    throw new Error("Word 文档格式无效或已损坏");
  }
}

export function validatePdfPreviewBytes(bytes: Uint8Array): void {
  if (bytes.length === 0) {
    throw new Error("PDF 文件为空，无法预览");
  }
  if (!hasPdfMagicBytes(bytes)) {
    throw new Error("PDF 文件格式无效或已损坏");
  }
}
