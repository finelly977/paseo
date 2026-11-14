import { renderAsync } from "docx-preview";
import { Minus, Plus, RotateCcw } from "lucide-react-native";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { parseExcelWorkbook, toSpreadsheetColumnLabel, type ParsedExcelSheet } from "./excel-model";
import {
  validatePdfPreviewBytes,
  validateWordPreviewBytes,
  type DocumentPreviewKind,
} from "./model";
import { pdfWorkerCode } from "./pdf-worker.gen";
import {
  GlobalWorkerOptions,
  getDocument,
  type PdfDocumentProxy,
  type PdfLoadingTask,
} from "./pdfjs-bundle.gen";

interface DocumentFilePreviewProps {
  kind: DocumentPreviewKind;
  bytes: Uint8Array;
  filename: string;
  mimeType?: string;
}

interface ExcelTableColors {
  surface0: string;
  surface1: string;
  surface2: string;
  border: string;
  foreground: string;
  foregroundMuted: string;
}

const ThemedMinus = withUnistyles(Minus);
const ThemedPlus = withUnistyles(Plus);
const ThemedRotateCcw = withUnistyles(RotateCcw);
const mutedIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function SurfaceViewport({
  surfaceColor,
  children,
}: {
  surfaceColor?: string;
  children: ReactNode;
}) {
  const style = useMemo<CSSProperties>(
    () => ({
      flex: 1,
      minHeight: 0,
      overflow: "auto",
      backgroundColor: surfaceColor,
      position: "relative",
    }),
    [surfaceColor],
  );
  return <div style={style}>{children}</div>;
}

const ThemedWordSurfaceViewport = withUnistyles(SurfaceViewport);
const surface1Mapping = (theme: Theme) => ({ surfaceColor: theme.colors.surface1 });

function PdfViewportHost({
  surfaceColor,
  viewportRef,
  pagesHostRef,
  isLoading,
}: {
  surfaceColor?: string;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  pagesHostRef: React.RefObject<HTMLDivElement | null>;
  isLoading: boolean;
}) {
  const containerStyle = useMemo<CSSProperties>(
    () => ({
      flex: 1,
      minHeight: 0,
      overflow: "auto",
      backgroundColor: surfaceColor,
      position: "relative",
    }),
    [surfaceColor],
  );
  return (
    <div ref={viewportRef} style={containerStyle}>
      {isLoading ? (
        <View style={styles.floatingLoading}>
          <ActivityIndicator size="small" />
          <Text style={styles.loadingText}>正在渲染 PDF…</Text>
        </View>
      ) : null}
      <div ref={pagesHostRef} style={PDF_PAGES_HOST_STYLE} />
    </div>
  );
}

const ThemedPdfViewportHost = withUnistyles(PdfViewportHost);

let pdfWorkerUrl: string | null = null;

function ensurePdfWorkerConfigured(): void {
  if (pdfWorkerUrl) {
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return;
  }
  const blob = new Blob([pdfWorkerCode], { type: "text/javascript" });
  pdfWorkerUrl = URL.createObjectURL(blob);
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export function DocumentFilePreview({ kind, bytes }: DocumentFilePreviewProps) {
  if (kind === "pdf") {
    return <PdfDocumentPreview bytes={bytes} />;
  }
  if (kind === "word") {
    return <WordDocumentPreview bytes={bytes} />;
  }
  return <ExcelDocumentPreview bytes={bytes} />;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.25;

function PdfDocumentPreview({ bytes }: { bytes: Uint8Array }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pagesHostRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PdfDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [zoomMode, setZoomMode] = useState<"fit" | "manual">("fit");
  const [manualScale, setManualScale] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const updateWidth = (nextWidth: number) => {
      if (nextWidth > 0) {
        setContainerWidth(nextWidth);
      }
    };
    updateWidth(node.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      updateWidth(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PdfLoadingTask | null = null;
    let loadedDoc: PdfDocumentProxy | null = null;
    setIsLoading(true);
    setErrorMessage(null);
    setPdfDoc(null);
    setNumPages(0);

    void (async () => {
      validatePdfPreviewBytes(bytes);
      ensurePdfWorkerConfigured();
      loadingTask = getDocument({ data: bytes.slice() });
      const doc = await loadingTask.promise;
      if (cancelled) {
        await doc.destroy();
        return;
      }
      loadedDoc = doc;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
    })().catch((error: unknown) => {
      if (cancelled) return;
      console.error("[文件预览] PDF 解析失败", error);
      setErrorMessage(error instanceof Error ? error.message : "PDF 加载失败");
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      if (loadingTask) {
        void loadingTask.destroy().catch(() => undefined);
      }
      if (loadedDoc) {
        void loadedDoc.destroy().catch(() => undefined);
      }
    };
  }, [bytes]);

  useEffect(() => {
    const host = pagesHostRef.current;
    if (!host || !pdfDoc) return;
    if (zoomMode === "fit" && containerWidth <= 0) return;

    let cancelled = false;
    let activeRenderTask: { cancel(): void } | null = null;
    setIsLoading(true);
    host.innerHTML = "";

    void (async () => {
      const dpr = window.devicePixelRatio || 1;
      const availableWidth = Math.max(240, containerWidth - 32);

      for (let pageIndex = 1; pageIndex <= pdfDoc.numPages; pageIndex += 1) {
        if (cancelled) return;
        const page = await pdfDoc.getPage(pageIndex);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale =
          zoomMode === "fit"
            ? Math.min(2, Math.max(0.4, availableWidth / baseViewport.width))
            : manualScale;
        const cssViewport = page.getViewport({ scale });
        const pixelWidth = Math.max(1, Math.floor(cssViewport.width * dpr));
        const pixelHeight = Math.max(1, Math.floor(cssViewport.height * dpr));

        const pageCard = document.createElement("div");
        pageCard.style.cssText = [
          "background: #ffffff",
          "border-radius: 6px",
          "box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2)",
          "overflow: hidden",
          "flex-shrink: 0",
          `width: ${Math.floor(cssViewport.width)}px`,
          `height: ${Math.floor(cssViewport.height)}px`,
        ].join(";");

        const canvas = document.createElement("canvas");
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = `${Math.floor(cssViewport.width)}px`;
        canvas.style.height = `${Math.floor(cssViewport.height)}px`;
        canvas.style.display = "block";
        pageCard.appendChild(canvas);
        host.appendChild(pageCard);

        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("无法创建 PDF 画布上下文");
        }

        const renderTask = page.render({
          canvasContext: context,
          viewport: cssViewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        activeRenderTask = renderTask;
        await renderTask.promise;
        activeRenderTask = null;
      }
      if (!cancelled) {
        setIsLoading(false);
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      if (error instanceof Error && error.name === "RenderingCancelledException") {
        return;
      }
      console.error("[文件预览] PDF 渲染失败", error);
      setErrorMessage(error instanceof Error ? error.message : "PDF 渲染失败");
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      activeRenderTask?.cancel();
    };
  }, [containerWidth, manualScale, pdfDoc, zoomMode]);

  const handleZoomOut = useCallback(() => {
    setZoomMode("manual");
    setManualScale((prev) => Math.max(ZOOM_MIN, Number((prev - ZOOM_STEP).toFixed(2))));
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoomMode("manual");
    setManualScale((prev) => Math.min(ZOOM_MAX, Number((prev + ZOOM_STEP).toFixed(2))));
  }, []);

  const handleFitWidth = useCallback(() => {
    setZoomMode("fit");
    setManualScale(1);
  }, []);

  return (
    <View style={styles.container} testID="pdf-file-preview">
      <View style={styles.toolbar}>
        <Text style={styles.toolbarMeta}>{numPages > 0 ? `共 ${numPages} 页` : "PDF 文档"}</Text>
        <View style={styles.toolbarSpacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="缩小"
          onPress={handleZoomOut}
          style={styles.iconButton}
        >
          <ThemedMinus size={14} uniProps={mutedIconColorMapping} />
        </Pressable>
        <Text style={styles.zoomLabel}>
          {zoomMode === "fit" ? "适应宽度" : `${Math.round(manualScale * 100)}%`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="放大"
          onPress={handleZoomIn}
          style={styles.iconButton}
        >
          <ThemedPlus size={14} uniProps={mutedIconColorMapping} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="适应宽度"
          onPress={handleFitWidth}
          style={styles.iconButton}
        >
          <ThemedRotateCcw size={13} uniProps={mutedIconColorMapping} />
        </Pressable>
      </View>

      {errorMessage ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : (
        <ThemedPdfViewportHost
          uniProps={surface1Mapping}
          viewportRef={viewportRef}
          pagesHostRef={pagesHostRef}
          isLoading={isLoading}
        />
      )}
    </View>
  );
}

const DOCX_WRAPPER_CSS = `
  .paseo-docx-wrapper {
    background: transparent !important;
    padding: 16px !important;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
  .paseo-docx-wrapper > section.paseo-docx {
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18) !important;
    border-radius: 4px;
    margin-bottom: 0 !important;
    color: #111827;
  }
`;

function WordDocumentPreview({ bytes }: { bytes: Uint8Array }) {
  const contentHostRef = useRef<HTMLDivElement>(null);
  const styleHostRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const contentHost = contentHostRef.current;
    const styleHost = styleHostRef.current;
    if (!contentHost || !styleHost) return;

    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);
    contentHost.innerHTML = "";
    styleHost.innerHTML = "";

    void (async () => {
      validateWordPreviewBytes(bytes);
      await renderAsync(bytes.slice().buffer, contentHost, styleHost, {
        className: "paseo-docx",
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        useBase64URL: true,
      });
      if (!cancelled) {
        setIsLoading(false);
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      console.error("[文件预览] Word 解析失败", error);
      setErrorMessage(error instanceof Error ? error.message : "Word 文档加载失败");
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [bytes]);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(0.6, Number((prev - 0.15).toFixed(2))));
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(2, Number((prev + 0.15).toFixed(2))));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
  }, []);
  const contentZoomStyle = useMemo<CSSProperties>(
    () => ({ zoom, minWidth: "fit-content" }),
    [zoom],
  );

  return (
    <View style={styles.container} testID="word-file-preview">
      <View style={styles.toolbar}>
        <Text style={styles.toolbarMeta}>Word 文档</Text>
        <View style={styles.toolbarSpacer} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="缩小"
          onPress={handleZoomOut}
          style={styles.iconButton}
        >
          <ThemedMinus size={14} uniProps={mutedIconColorMapping} />
        </Pressable>
        <Text style={styles.zoomLabel}>{`${Math.round(zoom * 100)}%`}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="放大"
          onPress={handleZoomIn}
          style={styles.iconButton}
        >
          <ThemedPlus size={14} uniProps={mutedIconColorMapping} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="重置缩放"
          onPress={handleZoomReset}
          style={styles.iconButton}
        >
          <ThemedRotateCcw size={13} uniProps={mutedIconColorMapping} />
        </Pressable>
      </View>

      {errorMessage ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : (
        <ThemedWordSurfaceViewport uniProps={surface1Mapping}>
          <style>{DOCX_WRAPPER_CSS}</style>
          <div ref={styleHostRef} />
          {isLoading ? (
            <View style={styles.floatingLoading}>
              <ActivityIndicator size="small" />
              <Text style={styles.loadingText}>正在解析 Word 文档…</Text>
            </View>
          ) : null}
          <div ref={contentHostRef} style={contentZoomStyle} />
        </ThemedWordSurfaceViewport>
      )}
    </View>
  );
}

function SheetTabButton({
  name,
  index,
  selected,
  onSelect,
}: {
  name: string;
  index: number;
  selected: boolean;
  onSelect: (index: number) => void;
}) {
  const handlePress = useCallback(() => onSelect(index), [index, onSelect]);
  const tabStyle = useMemo(() => [styles.sheetTab, selected && styles.sheetTabActive], [selected]);
  const textStyle = useMemo(
    () => [styles.sheetTabText, selected && styles.sheetTabTextActive],
    [selected],
  );
  return (
    <Pressable accessibilityRole="button" onPress={handlePress} style={tabStyle}>
      <Text numberOfLines={1} style={textStyle}>
        {name}
      </Text>
    </Pressable>
  );
}

function ExcelDocumentPreview({ bytes }: { bytes: Uint8Array }) {
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);

  const parsed = useMemo(() => {
    try {
      return { workbook: parseExcelWorkbook(bytes), error: null };
    } catch (error) {
      console.error("[文件预览] Excel 解析失败", error);
      return {
        workbook: null,
        error: error instanceof Error ? error.message : "Excel 表格解析失败",
      };
    }
  }, [bytes]);

  useEffect(() => {
    setActiveSheetIndex(0);
  }, [bytes]);

  if (parsed.error || !parsed.workbook) {
    return (
      <View style={styles.centerState} testID="excel-file-preview-error">
        <Text style={styles.errorText}>{parsed.error ?? "Excel 表格加载失败"}</Text>
      </View>
    );
  }

  const sheets = parsed.workbook.sheets;
  const safeIndex = activeSheetIndex < sheets.length ? activeSheetIndex : 0;
  const activeSheet = sheets[safeIndex];

  return (
    <View style={styles.container} testID="excel-file-preview">
      <View style={styles.toolbar}>
        <div style={SHEET_TABS_ROW_STYLE}>
          {sheets.map((sheet, index) => (
            <SheetTabButton
              key={sheet.name}
              name={sheet.name}
              index={index}
              selected={index === safeIndex}
              onSelect={setActiveSheetIndex}
            />
          ))}
        </div>
        <Text style={styles.toolbarMeta}>
          {activeSheet.totalRows > 0
            ? `${activeSheet.totalRows} 行 × ${activeSheet.totalCols} 列`
            : "空工作表"}
        </Text>
      </View>

      {activeSheet.truncatedRows || activeSheet.truncatedCols ? (
        <View style={styles.truncationBanner}>
          <Text style={styles.truncationText}>
            {`表格较大，当前仅预览前 ${activeSheet.rowCount} 行 × ${activeSheet.colCount} 列`}
          </Text>
        </View>
      ) : null}

      {activeSheet.rowCount === 0 || activeSheet.colCount === 0 ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyText}>此工作表暂无数据</Text>
        </View>
      ) : (
        <ThemedExcelSheetTable sheet={activeSheet} uniProps={excelTableColorsMapping} />
      )}
    </View>
  );
}

const excelTableColorsMapping = (theme: Theme) => ({
  colors: {
    surface0: theme.colors.surface0,
    surface1: theme.colors.surface1,
    surface2: theme.colors.surface2,
    border: theme.colors.border,
    foreground: theme.colors.foreground,
    foregroundMuted: theme.colors.foregroundMuted,
  },
});

function buildMergeLookup(sheet: ParsedExcelSheet) {
  const spanByStart = new Map<string, { rowSpan: number; colSpan: number }>();
  const coveredCells = new Set<string>();
  for (const merge of sheet.merges) {
    const rowSpan = merge.endRow - merge.startRow + 1;
    const colSpan = merge.endCol - merge.startCol + 1;
    spanByStart.set(`${merge.startRow}:${merge.startCol}`, { rowSpan, colSpan });
    for (let r = merge.startRow; r <= merge.endRow; r += 1) {
      for (let c = merge.startCol; c <= merge.endCol; c += 1) {
        if (r === merge.startRow && c === merge.startCol) continue;
        coveredCells.add(`${r}:${c}`);
      }
    }
  }
  return { spanByStart, coveredCells };
}

function ExcelHeaderCell({
  label,
  width,
  colors,
}: {
  label: string;
  width: number;
  colors: ExcelTableColors;
}) {
  const style = useMemo<CSSProperties>(
    () => ({
      position: "sticky",
      top: 0,
      zIndex: 2,
      width,
      minWidth: width,
      backgroundColor: colors.surface1,
      color: colors.foregroundMuted,
      borderRight: `1px solid ${colors.border}`,
      borderBottom: `1px solid ${colors.border}`,
      padding: "5px 8px",
      textAlign: "center",
      fontWeight: 500,
      userSelect: "none",
    }),
    [colors.border, colors.foregroundMuted, colors.surface1, width],
  );
  return <th style={style}>{label}</th>;
}

function ExcelRowCells({
  row,
  rowIndex,
  columnLabels,
  spanByStart,
  coveredCells,
  colors,
}: {
  row: readonly string[];
  rowIndex: number;
  columnLabels: readonly string[];
  spanByStart: ReadonlyMap<string, { rowSpan: number; colSpan: number }>;
  coveredCells: ReadonlySet<string>;
  colors: ExcelTableColors;
}) {
  const rowNumberStyle = useMemo<CSSProperties>(
    () => ({
      position: "sticky",
      left: 0,
      zIndex: 1,
      backgroundColor: colors.surface1,
      color: colors.foregroundMuted,
      borderRight: `1px solid ${colors.border}`,
      borderBottom: `1px solid ${colors.border}`,
      padding: "4px 6px",
      textAlign: "right",
      fontWeight: 500,
      userSelect: "none",
    }),
    [colors.border, colors.foregroundMuted, colors.surface1],
  );
  const cellStyle = useMemo<CSSProperties>(
    () => ({
      borderRight: `1px solid ${colors.border}`,
      borderBottom: `1px solid ${colors.border}`,
      padding: "4px 8px",
      verticalAlign: "top",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      backgroundColor: rowIndex % 2 === 1 ? colors.surface1 : colors.surface0,
    }),
    [colors.border, colors.surface0, colors.surface1, rowIndex],
  );

  return (
    <tr>
      <td style={rowNumberStyle}>{rowIndex + 1}</td>
      {columnLabels.map((label, colIndex) => {
        const cellKey = `${rowIndex}:${colIndex}`;
        if (coveredCells.has(cellKey)) return null;
        const span = spanByStart.get(cellKey);
        return (
          <td
            key={`col:${label}`}
            rowSpan={span?.rowSpan}
            colSpan={span?.colSpan}
            style={cellStyle}
          >
            {row[colIndex] ?? ""}
          </td>
        );
      })}
    </tr>
  );
}

function ExcelSheetTable({ sheet, colors }: { sheet: ParsedExcelSheet; colors: ExcelTableColors }) {
  const { spanByStart, coveredCells } = useMemo(() => buildMergeLookup(sheet), [sheet]);
  const columnLabels = useMemo(
    () => Array.from({ length: sheet.colCount }, (_, index) => toSpreadsheetColumnLabel(index)),
    [sheet.colCount],
  );
  const scrollStyle = useMemo<CSSProperties>(
    () => ({ flex: 1, minHeight: 0, overflow: "auto", backgroundColor: colors.surface0 }),
    [colors.surface0],
  );
  const tableStyle = useMemo<CSSProperties>(
    () => ({
      borderCollapse: "separate",
      borderSpacing: 0,
      tableLayout: "fixed",
      width: "max-content",
      minWidth: "100%",
      fontSize: 13,
      lineHeight: "18px",
      color: colors.foreground,
      fontVariantNumeric: "tabular-nums",
    }),
    [colors.foreground],
  );
  const cornerStyle = useMemo<CSSProperties>(
    () => ({
      position: "sticky",
      top: 0,
      left: 0,
      zIndex: 3,
      width: 48,
      minWidth: 48,
      backgroundColor: colors.surface2,
      color: colors.foregroundMuted,
      borderRight: `1px solid ${colors.border}`,
      borderBottom: `1px solid ${colors.border}`,
      padding: "5px 6px",
      textAlign: "center",
      fontWeight: 500,
      userSelect: "none",
    }),
    [colors.border, colors.foregroundMuted, colors.surface2],
  );
  const rowNumbers = useMemo(
    () => Array.from({ length: sheet.rows.length }, (_, index) => index),
    [sheet.rows.length],
  );

  return (
    <div style={scrollStyle}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={cornerStyle}>#</th>
            {columnLabels.map((label, colIndex) => (
              <ExcelHeaderCell
                key={label}
                label={label}
                width={sheet.colWidths[colIndex] ?? 96}
                colors={colors}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rowNumbers.map((rowIndex) => (
            <ExcelRowCells
              key={`row:${rowIndex + 1}`}
              row={sheet.rows[rowIndex] ?? []}
              rowIndex={rowIndex}
              columnLabels={columnLabels}
              spanByStart={spanByStart}
              coveredCells={coveredCells}
              colors={colors}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ThemedExcelSheetTable = withUnistyles(ExcelSheetTable);

const PDF_PAGES_HOST_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 16,
  padding: 16,
  minWidth: "fit-content",
};

const SHEET_TABS_ROW_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  overflowX: "auto",
  flex: 1,
  minWidth: 0,
};

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  toolbar: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  toolbarMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    flexShrink: 0,
  },
  toolbarSpacer: {
    flex: 1,
  },
  iconButton: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  zoomLabel: {
    minWidth: 48,
    textAlign: "center",
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  sheetTab: {
    height: 24,
    maxWidth: 160,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  sheetTabActive: {
    backgroundColor: theme.colors.surface2,
  },
  sheetTabText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  sheetTabTextActive: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  truncationBanner: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  truncationText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  floatingLoading: {
    padding: theme.spacing[4],
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  loadingText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
