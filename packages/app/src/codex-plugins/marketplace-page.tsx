import { useCallback, useDeferredValue, useMemo, useReducer, useRef, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Check, Plus, RefreshCw } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  CodexMarketplace,
  CodexPlugin,
  CodexPluginAction,
  CodexPluginActionResult,
  CodexPluginCatalogInput,
} from "@getpaseo/protocol/codex-plugins";
import { useFetchQuery } from "@/data/query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { settingsStyles } from "@/styles/settings";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { agentCommandsQueryRoot } from "@/hooks/agent-commands-query";
import { confirmDialog } from "@/utils/confirm-dialog";
import { openExternalUrl } from "@/utils/open-external-url";
import { PluginIcon } from "./plugin-icon";
import { PluginDetail } from "./plugin-detail";
import { CatalogLoading, InstalledLoading } from "./marketplace-loading";
import { PluginCenterHeader } from "./center-header";
import { PLUGIN_CENTER_RAIL_WIDTH, type PluginCenterLayout } from "./center-layout";

export type MarketClient = Pick<
  DaemonClient,
  "getCodexPluginCatalog" | "manageCodexPlugin" | "getCodexPluginDetail"
>;
export interface PluginSelection {
  plugin: CodexPlugin;
  marketplace: Pick<CodexMarketplace, "name" | "title" | "path">;
}
type MarketView = "official" | "local" | "installed" | "sources";
interface ViewState {
  view: MarketView;
  query: string;
  offset: number;
  source: string;
  selection: PluginSelection | null;
}
type ViewAction =
  | { type: "view"; value: MarketView }
  | { type: "query" | "source"; value: string }
  | { type: "offset"; value: number }
  | { type: "select"; value: PluginSelection | null };
const initial: ViewState = { view: "official", query: "", offset: 0, source: "", selection: null };
const views = [
  { value: "official", label: "公开" },
  { value: "local", label: "本地" },
  { value: "installed", label: "已安装" },
  { value: "sources", label: "市场来源" },
] satisfies Array<{ value: MarketView; label: string }>;
export const marketQueryRoot = (serverId: string) => ["codexPluginMarket", serverId] as const;
function reducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "view":
      return { ...state, view: action.value, offset: 0, selection: null };
    case "query":
      return { ...state, query: action.value, offset: 0 };
    case "source":
      return { ...state, source: action.value };
    case "offset":
      return { ...state, offset: action.value };
    case "select":
      return { ...state, selection: action.value };
  }
}

export function HostCodexPluginsPage({
  serverId,
  layout,
  headerActions,
}: {
  serverId: string;
  layout: PluginCenterLayout;
  headerActions: ReactNode;
}) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  // COMPAT(codexPluginMarket): 2026-11-07 新增，2027-05-07 后移除旧主机门控。
  const supported = useHostFeature(serverId, "codexPluginMarket");
  if (!client || !connected || !supported)
    return (
      <View style={styles.panel}>
        <PluginCenterHeader navigation={null} actions={headerActions} />
        <View style={styles.state}>
          <Alert
            title={
              !client || !connected
                ? "连接主机后管理 Codex 插件"
                : "请启用并更新主机的 Codex 和 Paseo 后使用插件市场"
            }
          />
        </View>
      </View>
    );
  return (
    <CodexPluginMarketplacePanel
      key={serverId}
      serverId={serverId}
      client={client}
      layout={layout}
      headerActions={headerActions}
    />
  );
}
async function confirmAction(action: CodexPluginAction): Promise<boolean> {
  if (action.kind === "install" || action.kind === "add_marketplace")
    return confirmDialog({
      title: "确认添加 Codex 扩展",
      message: "插件可以包含技能、MCP 服务和脚本，将安装到当前主机的 Codex 目录。是否继续？",
      confirmLabel: "继续",
      cancelLabel: "取消",
    });
  if (action.kind === "uninstall" || action.kind === "remove_marketplace")
    return confirmDialog({
      title: "确认移除",
      message: "将由 Codex 移除此插件或市场来源，不会删除 Paseo 的对话记录。",
      confirmLabel: "移除",
      cancelLabel: "取消",
      destructive: true,
    });
  return true;
}

export function CodexPluginMarketplacePanel({
  serverId,
  client,
  layout,
  headerActions,
}: {
  serverId: string;
  client: MarketClient;
  layout: PluginCenterLayout;
  headerActions: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, initial);
  const queryClient = useQueryClient();
  const submitting = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const listOffset = useRef(0);
  const search = useDeferredValue(state.query);
  const sourceView = state.view === "sources";
  const scope = state.view === "sources" ? "local" : state.view;
  const input = useMemo<CodexPluginCatalogInput>(
    () => ({
      scope,
      force: false,
      query: sourceView ? "" : search,
      installedOnly: state.view === "installed",
      offset: state.offset,
    }),
    [scope, sourceView, search, state.view, state.offset],
  );
  const key = useMemo(() => [...marketQueryRoot(serverId), input], [serverId, input]);
  const catalog = useFetchQuery({
    queryKey: key,
    queryFn: () => client.getCodexPluginCatalog(input),
    staleTimeMs: 60_000,
    dataShape: "value",
    retry: false,
  });
  const refresh = useMutation({
    mutationFn: () => client.getCodexPluginCatalog({ ...input, force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      void queryClient.invalidateQueries({ queryKey: [...marketQueryRoot(serverId), "rail"] });
    },
  });
  const action = useMutation({
    mutationFn: async (value: CodexPluginAction) =>
      (await confirmAction(value)) ? client.manageCodexPlugin(value) : null,
    onSuccess: (result, value) => {
      if (result === null) return;
      void queryClient.invalidateQueries({ queryKey: marketQueryRoot(serverId) });
      void queryClient.invalidateQueries({ queryKey: agentCommandsQueryRoot(serverId) });
      if (value.kind === "add_marketplace") dispatch({ type: "source", value: "" });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const run = useCallback(
    (value: CodexPluginAction) => {
      if (submitting.current) return;
      submitting.current = true;
      action.mutate(value);
    },
    [action],
  );
  const select = useCallback((value: PluginSelection) => {
    dispatch({ type: "select", value });
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, []);
  const back = useCallback(() => {
    dispatch({ type: "select", value: null });
    requestAnimationFrame(() =>
      scroll.current?.scrollTo({ y: listOffset.current, animated: false }),
    );
  }, []);
  const trackScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (state.selection === null) listOffset.current = event.nativeEvent.contentOffset.y;
    },
    [state.selection],
  );
  const changeView = useCallback((value: MarketView) => dispatch({ type: "view", value }), []);
  const changeQuery = useCallback((value: string) => dispatch({ type: "query", value }), []);
  const changeSource = useCallback((value: string) => dispatch({ type: "source", value }), []);
  const retry = useCallback(() => {
    if (action.isError && action.variables) run(action.variables);
    else if (refresh.isError) refresh.mutate();
    else void catalog.refetch();
  }, [action, refresh, catalog, run]);
  const add = useCallback(
    () => run({ kind: "add_marketplace", source: state.source.trim() }),
    [state.source, run],
  );
  const doRefresh = useCallback(() => refresh.mutate(), [refresh]);
  const previous = useCallback(
    () => dispatch({ type: "offset", value: Math.max(0, state.offset - 50) }),
    [state.offset],
  );
  const next = useCallback(() => {
    if (catalog.data && catalog.data.nextOffset !== null)
      dispatch({ type: "offset", value: catalog.data.nextOffset });
  }, [catalog.data]);
  const busy = action.isPending || refresh.isPending;
  const error = action.error ?? refresh.error ?? catalog.error;
  const navigation = useMemo(
    () => (state.selection ? { title: state.selection.plugin.title, onBack: back } : null),
    [state.selection, back],
  );
  const { showRail, twoColumns } = layout;
  return (
    <View style={styles.panel}>
      <PluginCenterHeader navigation={navigation} actions={headerActions} />
      <View style={styles.center} testID="codex-plugin-market">
        {showRail ? (
          <InstalledRail client={client} serverId={serverId} onOpen={select} onView={changeView} />
        ) : null}
        <ScrollView
          ref={scroll}
          onScroll={trackScroll}
          scrollEventThrottle={80}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.canvas}>
            {error ? (
              <Alert
                variant="error"
                title="操作未完成"
                description={error.message}
                testID="codex-market-error"
              >
                <Button size="sm" variant="outline" onPress={retry} disabled={busy}>
                  重试
                </Button>
              </Alert>
            ) : null}
            {action.isPending ? <Text style={styles.muted}>正在处理，请稍候...</Text> : null}
            {action.data ? <ActionResult result={action.data} /> : null}
            {state.selection ? (
              <PluginDetail
                selection={state.selection}
                client={client}
                serverId={serverId}
                onAction={run}
                busy={busy}
              />
            ) : (
              <>
                <MarketHeading
                  query={state.query}
                  onQuery={changeQuery}
                  onRefresh={doRefresh}
                  disabled={busy || catalog.isFetching}
                />
                <SegmentedControl
                  options={views}
                  value={state.view}
                  onValueChange={changeView}
                  size="sm"
                  testID="codex-market-views"
                />
                <Text style={styles.authHint}>
                  安装到当前主机 · 市场使用独立 ChatGPT 登录，正文可继续使用第三方模型
                </Text>
                <CatalogBody
                  data={catalog.data}
                  pending={catalog.isPending}
                  sources={sourceView}
                  busy={busy}
                  onAction={run}
                  onOpen={select}
                  twoColumns={twoColumns}
                />
                {sourceView ? (
                  <MarketSourceForm
                    source={state.source}
                    resetKey={action.status}
                    onChange={changeSource}
                    onAdd={add}
                    busy={busy}
                  />
                ) : null}
                {catalog.data && !sourceView ? (
                  <View style={styles.pager}>
                    <Text
                      style={styles.muted}
                    >{`共 ${catalog.data.total} 项 · 第 ${Math.floor(state.offset / 50) + 1} 页`}</Text>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={previous}
                      disabled={catalog.isFetching || state.offset === 0}
                    >
                      上一页
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={next}
                      disabled={catalog.isFetching || catalog.data.nextOffset === null}
                    >
                      下一页
                    </Button>
                  </View>
                ) : null}
              </>
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function MarketSourceForm({
  source,
  resetKey,
  onChange,
  onAdd,
  busy,
}: {
  source: string;
  resetKey: string;
  onChange(value: string): void;
  onAdd(): void;
  busy: boolean;
}) {
  return (
    <View style={styles.sourceForm}>
      <Field label="添加市场来源">
        <FormTextInput
          initialValue={source}
          resetKey={resetKey}
          onChangeText={onChange}
          editable={!busy}
          placeholder="owner/repo 或主机本地目录"
          size="sm"
          testID="codex-market-source"
        />
      </Field>
      <Button
        size="sm"
        variant="outline"
        leftIcon={Plus}
        onPress={onAdd}
        disabled={busy || !source.trim()}
        testID="codex-market-add-source"
      >
        添加来源
      </Button>
    </View>
  );
}

function MarketHeading({
  query,
  onQuery,
  onRefresh,
  disabled,
}: {
  query: string;
  onQuery(value: string): void;
  onRefresh(): void;
  disabled: boolean;
}) {
  return (
    <View style={styles.heading}>
      <View style={styles.headingText}>
        <Text style={styles.title}>插件</Text>
        <Text style={styles.subtitle}>连接插件，让 Codex 在你的各类工具中协同工作</Text>
      </View>
      <View style={styles.headingActions}>
        <View style={styles.search}>
          <FormTextInput
            initialValue={query}
            onChangeText={onQuery}
            placeholder="搜索插件"
            accessibilityLabel="搜索 Codex 插件"
            size="sm"
            testID="codex-market-search"
            style={styles.controlText}
          />
        </View>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={RefreshCw}
          onPress={onRefresh}
          disabled={disabled}
          accessibilityLabel="刷新插件目录"
          testID="codex-market-refresh"
          textStyle={styles.controlText}
        />
      </View>
    </View>
  );
}
function cardMainStyle({ hovered }: { hovered?: boolean }) {
  return [styles.cardMain, hovered && styles.hover];
}
function installedStyle({ hovered }: { hovered?: boolean }) {
  return [styles.installedItem, hovered && styles.hover];
}

function CatalogBody({
  data,
  pending,
  sources,
  busy,
  onAction,
  onOpen,
  twoColumns,
}: {
  data: Awaited<ReturnType<MarketClient["getCodexPluginCatalog"]>> | undefined;
  pending: boolean;
  sources: boolean;
  busy: boolean;
  onAction(action: CodexPluginAction): void;
  onOpen(value: PluginSelection): void;
  twoColumns: boolean;
}) {
  if (pending) return <CatalogLoading twoColumns={twoColumns} sources={sources} />;
  if (!data) return null;
  if (sources)
    return (
      <>
        {data.errors.map((item) => (
          <Alert
            key={item.path}
            variant="error"
            title="部分来源加载失败"
            description={`${item.path}：${item.message}`}
          />
        ))}
        {data.marketplaces.map((marketplace) => (
          <SourceRow
            key={marketplace.name}
            marketplace={marketplace}
            busy={busy}
            onAction={onAction}
          />
        ))}
      </>
    );
  const entries = data.marketplaces.flatMap((marketplace) =>
    marketplace.plugins.map((plugin) => ({ plugin, marketplace })),
  );
  const categories = [...new Set(entries.map((entry) => entry.plugin.category ?? "探索插件"))];
  return (
    <>
      {data.errors.map((item) => (
        <Alert
          key={item.path}
          variant="error"
          title="部分来源加载失败"
          description={`${item.path}：${item.message}`}
        />
      ))}
      {data.total === 0 ? (
        <View style={styles.state}>
          <Text style={styles.muted}>没有匹配的插件</Text>
          <Text style={styles.muted}>检查搜索内容，或确认当前主机的 ChatGPT 登录有效</Text>
        </View>
      ) : null}
      {categories.map((category) => (
        <View style={styles.category} key={category}>
          <Text style={styles.categoryTitle}>{category}</Text>
          <View style={styles.grid}>
            {entries
              .filter((entry) => (entry.plugin.category ?? "探索插件") === category)
              .map((entry) => (
                <PluginCard
                  key={entry.plugin.id}
                  selection={entry}
                  busy={busy}
                  onAction={onAction}
                  onOpen={onOpen}
                  twoColumns={twoColumns}
                />
              ))}
          </View>
        </View>
      ))}
    </>
  );
}
function PluginCard({
  selection,
  busy,
  onAction,
  onOpen,
  twoColumns,
}: {
  selection: PluginSelection;
  busy: boolean;
  onAction(action: CodexPluginAction): void;
  onOpen(value: PluginSelection): void;
  twoColumns: boolean;
}) {
  const { plugin, marketplace } = selection;
  const open = useCallback(() => onOpen(selection), [onOpen, selection]);
  const install = useCallback(
    () =>
      onAction({
        kind: "install",
        marketplaceName: marketplace.name,
        marketplacePath: marketplace.path,
        pluginName: plugin.name,
        remotePluginId: plugin.remotePluginId,
      }),
    [onAction, marketplace, plugin.name, plugin.remotePluginId],
  );
  const cardStyle = useMemo(() => [styles.card, twoColumns && styles.cardTwo], [twoColumns]);
  const unavailable = plugin.installPolicy === "NOT_AVAILABLE" || plugin.disabledReason !== null;
  return (
    <View style={cardStyle} testID={`codex-plugin-${plugin.id}`}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`查看 ${plugin.title} 详情`}
        style={cardMainStyle}
      >
        <PluginIcon key={plugin.id} plugin={plugin} />
        <View style={styles.cardText}>
          <Text numberOfLines={1} style={styles.cardTitle}>
            {plugin.title}
          </Text>
          <Text numberOfLines={2} style={styles.cardDescription}>
            {plugin.description || plugin.name}
          </Text>
        </View>
      </Pressable>
      <Button
        size="sm"
        variant="ghost"
        leftIcon={plugin.installed ? Check : Plus}
        onPress={plugin.installed ? open : install}
        disabled={busy || unavailable}
        accessibilityLabel={plugin.installed ? `管理 ${plugin.title}` : `安装 ${plugin.title}`}
      />
    </View>
  );
}
function InstalledRail({
  client,
  serverId,
  onOpen,
  onView,
}: {
  client: MarketClient;
  serverId: string;
  onOpen(value: PluginSelection): void;
  onView(value: MarketView): void;
}) {
  const local = useFetchQuery({
    queryKey: [...marketQueryRoot(serverId), "rail", "local"],
    queryFn: () =>
      client.getCodexPluginCatalog({ scope: "local", force: false, installedOnly: true }),
    dataShape: "value",
    staleTimeMs: 60_000,
    retry: false,
  });
  const official = useFetchQuery({
    queryKey: [...marketQueryRoot(serverId), "rail", "official"],
    queryFn: () =>
      client.getCodexPluginCatalog({ scope: "official", force: false, installedOnly: true }),
    dataShape: "value",
    staleTimeMs: 60_000,
    retry: false,
  });
  const marketplaces = [
    ...(local.data?.marketplaces ?? []),
    ...(official.data?.marketplaces ?? []),
  ];
  const seen = new Set<string>();
  const entries = marketplaces
    .flatMap((marketplace) => marketplace.plugins.map((plugin) => ({ plugin, marketplace })))
    .filter((entry) => {
      if (seen.has(entry.plugin.id)) return false;
      seen.add(entry.plugin.id);
      return true;
    });
  const showAll = useCallback(() => onView("installed"), [onView]);
  return (
    <View style={styles.rail}>
      <Text style={styles.railTitle}>已安装</Text>
      <ScrollView contentContainerStyle={styles.railItems}>
        {entries.slice(0, 30).map((entry) => (
          <InstalledItem key={entry.plugin.id} selection={entry} onOpen={onOpen} />
        ))}
        {entries.length === 0 && (local.isPending || official.isPending) ? (
          <InstalledLoading />
        ) : null}
        {entries.length === 0 &&
        !local.isPending &&
        !official.isPending &&
        !local.error &&
        !official.error ? (
          <Text style={styles.muted}>暂无已安装插件</Text>
        ) : null}
        {local.error || official.error ? (
          <Text style={settingsStyles.rowError}>部分插件读取失败，请刷新目录</Text>
        ) : null}
        {entries.length > 30 ? (
          <Button size="sm" variant="ghost" onPress={showAll}>
            查看全部
          </Button>
        ) : null}
      </ScrollView>
    </View>
  );
}
function InstalledItem({
  selection,
  onOpen,
}: {
  selection: PluginSelection;
  onOpen(value: PluginSelection): void;
}) {
  const open = useCallback(() => onOpen(selection), [selection, onOpen]);
  return (
    <Pressable
      onPress={open}
      style={installedStyle}
      accessibilityRole="button"
      accessibilityLabel={`查看 ${selection.plugin.title} 详情`}
    >
      <PluginIcon plugin={selection.plugin} size="tiny" />
      <Text style={styles.installedName} numberOfLines={1}>
        {selection.plugin.title}
      </Text>
    </Pressable>
  );
}
function SourceRow({
  marketplace,
  busy,
  onAction,
}: {
  marketplace: CodexMarketplace;
  busy: boolean;
  onAction(action: CodexPluginAction): void;
}) {
  const refresh = useCallback(
    () => onAction({ kind: "refresh_marketplace", name: marketplace.name }),
    [marketplace.name, onAction],
  );
  const remove = useCallback(
    () => onAction({ kind: "remove_marketplace", name: marketplace.name }),
    [marketplace.name, onAction],
  );
  return (
    <View style={styles.sourceRow} testID={`codex-market-source-${marketplace.name}`}>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{marketplace.title}</Text>
        <Text style={styles.muted}>{marketplace.path}</Text>
      </View>
      <Button size="sm" variant="outline" onPress={refresh} disabled={busy}>
        刷新来源
      </Button>
      <Button size="sm" variant="outline" onPress={remove} disabled={busy}>
        移除来源
      </Button>
    </View>
  );
}
function ActionResult({ result }: { result: CodexPluginActionResult }) {
  return (
    <Alert
      variant="success"
      title="操作完成"
      description={
        result.restartRequired
          ? "插件配置已保存，新会话会自动读取；已有会话可手动重新加载，不会自动重启正在进行的对话。"
          : "市场来源已刷新"
      }
    >
      {result.authApps.map((app) => (
        <AuthApp key={app.name} name={app.name} url={app.url} />
      ))}
    </Alert>
  );
}
function AuthApp({ name, url }: { name: string; url: string | null }) {
  const auth = useMutation({
    mutationFn: async () => {
      if (url === null) throw new Error("请在官方客户端完成此插件的授权");
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("授权地址格式无效");
      await openExternalUrl(url);
    },
  });
  const open = useCallback(() => auth.mutate(), [auth]);
  return (
    <View>
      <Button
        size="sm"
        variant="outline"
        onPress={open}
        disabled={auth.isPending}
      >{`连接 ${name}`}</Button>
      {auth.error ? <Text style={settingsStyles.rowError}>{auth.error.message}</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  panel: { flex: 1, minHeight: 0 },
  center: { flex: 1, flexDirection: "row", minHeight: 0 },
  scroll: { flex: 1 },
  content: { flexGrow: 1, padding: theme.spacing[4] },
  canvas: {
    width: "100%",
    maxWidth: 1120,
    alignSelf: "center",
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[8],
  },
  heading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[4],
    flexWrap: "wrap",
    paddingTop: theme.spacing[2],
  },
  headingText: { flex: 1, minWidth: 220, gap: theme.spacing[2] },
  title: {
    fontSize: theme.fontSize.base * 0.875,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: theme.fontSize.base * 0.875,
    color: theme.colors.foregroundMuted,
    lineHeight: 20,
  },
  controlText: { fontSize: theme.fontSize.base * 0.875 },
  headingActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  search: { width: 220 },
  authHint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base * 0.8125 },
  category: { gap: theme.spacing[3] },
  categoryTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base * 0.875,
    fontWeight: theme.fontWeight.medium,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: "4%", rowGap: theme.spacing[2] },
  card: { width: "100%", flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  cardTwo: { width: "48%" },
  cardMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  cardText: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
  cardTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base * 0.875 },
  cardDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base * 0.8125,
    lineHeight: 18,
  },
  hover: { backgroundColor: theme.colors.surface2 },
  rail: {
    width: PLUGIN_CENTER_RAIL_WIDTH,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    padding: theme.spacing[3],
    paddingTop: theme.spacing[6],
    gap: theme.spacing[4],
    backgroundColor: theme.colors.surfaceSidebar,
  },
  railTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sidebar,
    paddingHorizontal: theme.spacing[2],
  },
  railItems: { gap: theme.spacing[1] },
  installedItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  installedName: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sidebar,
  },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base * 0.875 },
  state: { padding: theme.spacing[8], alignItems: "center", gap: theme.spacing[3] },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  sourceForm: { gap: theme.spacing[3] },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    flexWrap: "wrap",
  },
}));
export { styles as pluginMarketStyles };
