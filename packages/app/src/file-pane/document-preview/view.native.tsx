import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { WebView } from "react-native-webview";
import { parseExcelWorkbook, toSpreadsheetColumnLabel, type ParsedExcelSheet } from "./excel-model";
import {
  validatePdfPreviewBytes,
  validateWordPreviewBytes,
  type DocumentPreviewKind,
} from "./model";

interface DocumentFilePreviewProps {
  kind: DocumentPreviewKind;
  bytes: Uint8Array;
  filename: string;
  mimeType?: string;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return globalThis.btoa(binary);
}

export function DocumentFilePreview({ kind, bytes }: DocumentFilePreviewProps) {
  if (kind === "excel") {
    return <ExcelNativePreview bytes={bytes} />;
  }
  if (kind === "pdf") {
    return <PdfNativePreview bytes={bytes} />;
  }
  return <WordNativePreview bytes={bytes} />;
}

function PdfNativePreview({ bytes }: { bytes: Uint8Array }) {
  const validation = useMemo(() => {
    try {
      validatePdfPreviewBytes(bytes);
      return {
        ok: true as const,
        source: { uri: `data:application/pdf;base64,${encodeBase64(bytes)}` },
      };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "PDF 加载失败",
      };
    }
  }, [bytes]);

  if (!validation.ok) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.errorText}>{validation.error}</Text>
      </View>
    );
  }

  if (Platform.OS === "ios") {
    return <WebView source={validation.source} style={styles.webview} />;
  }

  return (
    <View style={styles.centerState}>
      <Text style={styles.emptyText}>请在桌面端或网页端预览 PDF 文档</Text>
    </View>
  );
}

function WordNativePreview({ bytes }: { bytes: Uint8Array }) {
  const validation = useMemo(() => {
    try {
      validateWordPreviewBytes(bytes);
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Word 文档加载失败",
      };
    }
  }, [bytes]);

  if (!validation.ok) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.errorText}>{validation.error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.centerState}>
      <Text style={styles.emptyText}>请在桌面端或网页端预览 Word 文档</Text>
    </View>
  );
}

function NativeSheetTabButton({
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
    <Pressable onPress={handlePress} style={tabStyle}>
      <Text style={textStyle}>{name}</Text>
    </Pressable>
  );
}

function ExcelNativePreview({ bytes }: { bytes: Uint8Array }) {
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const parsed = useMemo(() => {
    try {
      return { workbook: parseExcelWorkbook(bytes), error: null };
    } catch (error) {
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
      <View style={styles.centerState}>
        <Text style={styles.errorText}>{parsed.error ?? "Excel 表格加载失败"}</Text>
      </View>
    );
  }

  const sheets = parsed.workbook.sheets;
  const safeIndex = activeSheetIndex < sheets.length ? activeSheetIndex : 0;
  const activeSheet = sheets[safeIndex];

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.sheetTabRow}>
            {sheets.map((sheet, index) => (
              <NativeSheetTabButton
                key={sheet.name}
                name={sheet.name}
                index={index}
                selected={index === safeIndex}
                onSelect={setActiveSheetIndex}
              />
            ))}
          </View>
        </ScrollView>
      </View>
      {activeSheet.rowCount === 0 || activeSheet.colCount === 0 ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyText}>此工作表暂无数据</Text>
        </View>
      ) : (
        <NativeExcelSheetGrid sheet={activeSheet} />
      )}
    </View>
  );
}

interface NativeExcelRowEntry {
  rowIndex: number;
  cells: string[];
}

function NativeExcelHeaderCell({ label, width }: { label: string; width: number }) {
  const style = useMemo(() => [styles.dataCell, styles.headerCell, { width }], [width]);
  return (
    <View style={style}>
      <Text style={styles.headerText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function NativeExcelDataCell({ value, width }: { value: string; width: number }) {
  const style = useMemo(() => [styles.dataCell, { width }], [width]);
  return (
    <View style={style}>
      <Text selectable style={styles.cellText}>
        {value}
      </Text>
    </View>
  );
}

function NativeExcelRow({
  entry,
  columnLabels,
  colWidths,
}: {
  entry: NativeExcelRowEntry;
  columnLabels: readonly string[];
  colWidths: readonly number[];
}) {
  return (
    <View style={styles.gridRow}>
      <View style={ROW_NUMBER_HEADER_STYLE}>
        <Text style={styles.headerText}>{entry.rowIndex + 1}</Text>
      </View>
      {columnLabels.map((label, colIndex) => (
        <NativeExcelDataCell
          key={`col:${label}`}
          value={entry.cells[colIndex] ?? ""}
          width={colWidths[colIndex] ?? 96}
        />
      ))}
    </View>
  );
}

function extractNativeExcelRowKey(entry: NativeExcelRowEntry): string {
  return `row:${entry.rowIndex + 1}`;
}

function NativeExcelSheetGrid({ sheet }: { sheet: ParsedExcelSheet }) {
  const columnLabels = useMemo(
    () => Array.from({ length: sheet.colCount }, (_, index) => toSpreadsheetColumnLabel(index)),
    [sheet.colCount],
  );
  const rowEntries = useMemo<NativeExcelRowEntry[]>(
    () => sheet.rows.map((cells, rowIndex) => ({ rowIndex, cells })),
    [sheet.rows],
  );
  const renderRow = useCallback(
    ({ item }: ListRenderItemInfo<NativeExcelRowEntry>) => (
      <NativeExcelRow entry={item} columnLabels={columnLabels} colWidths={sheet.colWidths} />
    ),
    [columnLabels, sheet.colWidths],
  );
  return (
    <ScrollView horizontal style={styles.container}>
      <View style={styles.container}>
        <View style={styles.gridHeaderRow}>
          <View style={ROW_NUMBER_HEADER_STYLE}>
            <Text style={styles.headerText}>#</Text>
          </View>
          {columnLabels.map((label, colIndex) => (
            <NativeExcelHeaderCell
              key={label}
              label={label}
              width={sheet.colWidths[colIndex] ?? 96}
            />
          ))}
        </View>
        <FlatList
          data={rowEntries}
          keyExtractor={extractNativeExcelRowKey}
          initialNumToRender={30}
          renderItem={renderRow}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 },
  webview: { flex: 1, backgroundColor: theme.colors.surface0 },
  toolbar: {
    minHeight: 36,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  sheetTabRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  sheetTab: {
    height: 26,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    justifyContent: "center",
  },
  sheetTabActive: { backgroundColor: theme.colors.surface2 },
  sheetTabText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  sheetTabTextActive: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
  gridHeaderRow: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface1,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  gridRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowNumberCell: {
    width: 44,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: theme.spacing[1],
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dataCell: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  headerCell: { backgroundColor: theme.colors.surface1 },
  headerText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  cellText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  errorText: { color: theme.colors.destructive, fontSize: theme.fontSize.sm, textAlign: "center" },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));

const ROW_NUMBER_HEADER_STYLE = [styles.rowNumberCell, styles.headerCell];
