import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ScrollView,
  View,
  StyleSheet as NativeStyleSheet,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ASTNode, RenderRules } from "react-native-markdown-display";
import type { MarkdownStyles } from "./renderer";
import { MarkdownTableCellText } from "@/components/markdown-text-selection";
import {
  allocateTableColumnWidths,
  collectTableColumnDemands,
  type TableContentNode,
} from "./table-layout";

const ColumnWidths = createContext<readonly number[] | null>(null);

export function createMarkdownTableRules(): RenderRules {
  return {
    table: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
      <MarkdownTable
        key={node.key}
        node={node}
        style={styles._VIEW_SAFE_table}
        fontSize={styles.th.fontSize}
        padding={typeof styles.th.padding === "number" ? styles.th.padding : undefined}
      >
        {children}
      </MarkdownTable>
    ),
    th: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
      <MarkdownTableCell key={node.key} column={node.index} style={styles._VIEW_SAFE_th}>
        {children}
      </MarkdownTableCell>
    ),
    td: (node: ASTNode, children: ReactNode[], _parent: ASTNode[], styles: MarkdownStyles) => (
      <MarkdownTableCell key={node.key} column={node.index} style={styles._VIEW_SAFE_td}>
        {children}
      </MarkdownTableCell>
    ),
  };
}

export function MarkdownTable({
  node,
  style,
  fontSize = 14,
  padding = 8,
  children,
}: {
  node: TableContentNode;
  style: StyleProp<ViewStyle>;
  fontSize?: number;
  padding?: number;
  children: ReactNode;
}) {
  const [availableWidth, setAvailableWidth] = useState(0);
  const borderWidth = NativeStyleSheet.flatten(style).borderWidth ?? 0;
  const demands = useMemo(() => collectTableColumnDemands(node), [node]);
  const widths = useMemo(
    () => allocateTableColumnWidths(demands, availableWidth - borderWidth * 2, fontSize, padding),
    [demands, availableWidth, borderWidth, fontSize, padding],
  );
  const layout = useMemo(
    () => ({ width: widths.reduce((sum, width) => sum + width, 0) + borderWidth * 2 }),
    [widths, borderWidth],
  );
  const measure = useCallback((event: LayoutChangeEvent) => {
    setAvailableWidth(event.nativeEvent.layout.width);
  }, []);
  return (
    <View style={styles.container} onLayout={measure} testID="markdown-table-viewport">
      <ScrollView
        horizontal
        nestedScrollEnabled
        directionalLockEnabled
        style={styles.scroll}
        showsHorizontalScrollIndicator
      >
        <ColumnWidths value={widths}>
          <View style={[style, layout]} testID="markdown-content-table">
            {children}
          </View>
        </ColumnWidths>
      </ScrollView>
    </View>
  );
}

export function MarkdownTableCell({
  column,
  style,
  children,
}: {
  column: number;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const widths = useContext(ColumnWidths);
  if (widths === null || widths[column] === undefined)
    throw new Error(`Markdown table column ${column} has no layout`);
  const width = widths[column];
  const layout = useMemo<ViewStyle>(
    () => ({ width, minWidth: 0, flex: 0, flexBasis: "auto", flexGrow: 0, flexShrink: 0 }),
    [width],
  );
  return (
    <MarkdownTableCellText>
      <View style={[style, layout]} testID={`markdown-table-column-${column}`}>
        {children}
      </View>
    </MarkdownTableCellText>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", minWidth: 0 },
  scroll: { flexGrow: 0, flexShrink: 1 },
});
