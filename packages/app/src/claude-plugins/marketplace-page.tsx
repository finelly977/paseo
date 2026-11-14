import { useCallback, useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Check, Plus, RefreshCw, ExternalLink, Search } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  ClaudePlugin,
  ClaudePluginAction,
  ClaudePluginScope,
} from "@getpaseo/protocol/claude-plugins";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { confirmDialog } from "@/utils/confirm-dialog";
import { openExternalUrl } from "@/utils/open-external-url";
import { PluginIcon } from "@/codex-plugins/plugin-icon";
import { PluginCenterHeader } from "@/codex-plugins/center-header";
import {
  CatalogLoading,
  DetailLoading,
  InstalledLoading,
} from "@/codex-plugins/marketplace-loading";
import { pluginMarketStyles as styles } from "@/codex-plugins/marketplace-page";
import { pluginDetailStyles as detailStyles } from "@/codex-plugins/plugin-detail";
import type { PluginCenterLayout } from "@/codex-plugins/center-layout";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { agentCommandsQueryRoot } from "@/hooks/agent-commands-query";

type ClaudeCatalog = Awaited<ReturnType<DaemonClient["getClaudePluginCatalog"]>>;
type ClaudeDetailData = Awaited<ReturnType<DaemonClient["getClaudePluginDetail"]>>;
type ActionResult = Awaited<ReturnType<DaemonClient["manageClaudePlugin"]>>;
export type ClaudeMarketClient = Pick<
  DaemonClient,
  "getClaudePluginCatalog" | "getClaudePluginDetail" | "manageClaudePlugin"
>;
const root = (serverId: string) => ["claudePluginMarket", serverId] as const;
const scopes = [
  { value: "user", label: "个人" },
  { value: "project", label: "项目共享" },
  { value: "local", label: "项目私有" },
] satisfies { value: ClaudePluginScope; label: string }[];
const views = [
  { value: "catalog", label: "全部插件" },
  { value: "installed", label: "已安装" },
  { value: "sources", label: "市场来源" },
] satisfies Array<{ value: "catalog" | "installed" | "sources"; label: string }>;
const ThemedSearch = withUnistyles(Search);
const searchIconColor = (theme: import("@/styles/theme").Theme) => ({
  color: theme.colors.foregroundMuted,
});

export function HostClaudePluginsPage({
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
  // COMPAT(claudePluginMarket): 2026-11-09 新增，2027-05-09 后移除旧主机门控。
  const supported = useHostFeature(serverId, "claudePluginMarket");
  if (!client || !connected || !supported)
    return (
      <View style={styles.panel}>
        <PluginCenterHeader navigation={null} actions={headerActions} />
        <View style={styles.state}>
          <Alert
            title={
              !client || !connected
                ? "连接主机后管理 Claude Code 插件"
                : "请启用 Claude Code，并更新此主机的 Paseo 后使用插件市场"
            }
          />
        </View>
      </View>
    );
  return (
    <ClaudePluginMarketplacePanel
      key={serverId}
      client={client}
      serverId={serverId}
      layout={layout}
      headerActions={headerActions}
    />
  );
}
export function ClaudePluginMarketplacePanel({
  client,
  serverId,
  layout,
  headerActions,
}: {
  client: ClaudeMarketClient;
  serverId: string;
  layout: PluginCenterLayout;
  headerActions: ReactNode;
}) {
  const [view, setView] = useState<"catalog" | "installed" | "sources">("catalog");
  const [query, setQuery] = useState("");
  const search = useDeferredValue(query);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ClaudePlugin | null>(null);
  const [scope, setScope] = useState<ClaudePluginScope>("user");
  const [path, setPath] = useState("");
  const [cwd, setCwd] = useState<string | undefined>();
  const [source, setSource] = useState("");
  const submitting = useRef(false);
  const listOffset = useRef(0);
  const scroll = useRef<ScrollView>(null);
  const queryClient = useQueryClient();
  const input = useMemo(
    () => ({ cwd, force: false, query: search, offset, installedOnly: view === "installed" }),
    [cwd, search, offset, view],
  );
  const catalog = useFetchQuery({
    queryKey: [...root(serverId), input],
    queryFn: () => client.getClaudePluginCatalog(input),
    dataShape: "value",
    staleTimeMs: 60000,
    retry: false,
  });
  const rail = useFetchQuery({
    queryKey: [...root(serverId), "rail", cwd],
    queryFn: () => client.getClaudePluginCatalog({ cwd, force: false, installedOnly: true }),
    dataShape: "value",
    staleTimeMs: 60000,
    retry: false,
  });
  const refresh = useMutation({
    mutationFn: () => client.getClaudePluginCatalog({ ...input, force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData([...root(serverId), input], data);
      void queryClient.invalidateQueries({ queryKey: [...root(serverId), "rail"] });
    },
  });
  const action = useMutation({
    mutationFn: async (value: ClaudePluginAction) => {
      if (value.kind === "install" || value.kind === "add_marketplace" || value.kind === "update") {
        if (
          !("acceptCommand" in value && value.acceptCommand) &&
          !(await confirmDialog({
            title: "确认添加或更新 Claude Code 扩展",
            message:
              "插件可能包含技能、钩子、MCP 服务和可执行代码，将在所选主机和安装范围内处理。正在运行的会话不会重启。",
            confirmLabel: "继续",
            cancelLabel: "取消",
          }))
        )
          return null;
      }
      if (value.kind === "uninstall" || value.kind === "remove_marketplace") {
        if (
          !(await confirmDialog({
            title: "确认移除",
            message:
              value.kind === "remove_marketplace"
                ? "Claude Code 可能同时卸载此来源的插件，并删除它们保存的配置、凭据和数据。是否继续？"
                : "将由 Claude Code 卸载所选范围的插件，保留其数据目录；原生保存的配置与凭据仍可能被移除。",
            confirmLabel: "移除",
            cancelLabel: "取消",
            destructive: true,
          }))
        )
          return null;
      }
      return client.manageClaudePlugin(value, cwd);
    },
    onSuccess: async (result) => {
      if (result === null || result.confirmation !== null) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: root(serverId) }),
        queryClient.invalidateQueries({ queryKey: [...agentCommandsQueryRoot(serverId), "draft"] }),
      ]);
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const run = useCallback(
    (value: ClaudePluginAction) => {
      if (submitting.current) return;
      submitting.current = true;
      action.mutate(value);
    },
    [action],
  );
  const select = useCallback((plugin: ClaudePlugin) => {
    setSelected(plugin);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, []);
  const back = useCallback(() => {
    setSelected(null);
    requestAnimationFrame(() =>
      scroll.current?.scrollTo({ y: listOffset.current, animated: false }),
    );
  }, []);
  const searchChanged = useCallback((value: string) => {
    setQuery(value);
    setOffset(0);
  }, []);
  const applyPath = useCallback(() => {
    action.reset();
    setCwd(path.trim() || undefined);
    setOffset(0);
    setSelected(null);
  }, [path, action]);
  const changeScope = useCallback(
    (value: ClaudePluginScope) => {
      action.reset();
      setScope(value);
      if (value === "user") {
        setCwd(undefined);
        setPath("");
        setOffset(0);
      }
    },
    [action],
  );
  const changeView = useCallback((value: "catalog" | "installed" | "sources") => {
    setView(value);
    setOffset(0);
    setSelected(null);
  }, []);
  const viewAllInstalled = useCallback(() => changeView("installed"), [changeView]);
  const trackScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (selected === null) listOffset.current = event.nativeEvent.contentOffset.y;
    },
    [selected],
  );
  const retry = useCallback(() => {
    if (action.error && action.variables) run(action.variables);
    else if (refresh.error) refresh.mutate();
    else void catalog.refetch();
  }, [action, refresh, catalog, run]);
  const add = useCallback(
    () => run({ kind: "add_marketplace", source: source.trim(), scope }),
    [run, source, scope],
  );
  const official = useCallback(
    () => run({ kind: "add_marketplace", source: "anthropics/claude-plugins-official", scope }),
    [run, scope],
  );
  const refreshCatalog = useCallback(() => refresh.mutate(), [refresh]);
  const previous = useCallback(() => setOffset((value) => Math.max(0, value - 50)), []);
  const next = useCallback(() => {
    if (catalog.data && catalog.data.nextOffset !== null) setOffset(catalog.data.nextOffset);
  }, [catalog.data]);
  const navigation = useMemo(
    () => (selected ? { title: selected.title, onBack: back } : null),
    [selected, back],
  );
  const busy = action.isPending || refresh.isPending;
  const invalidScope = scope !== "user" && !cwd;
  const error = action.error ?? refresh.error ?? catalog.error;
  const confirmCommand = useCallback(async () => {
    const result = action.data;
    const value = action.variables;
    if (
      !result ||
      !result.confirmation ||
      !value ||
      (value.kind !== "install" && value.kind !== "update")
    )
      return;
    if (
      await confirmDialog({
        title: "执行已展示的原生安装命令？",
        message:
          "请确认已核对上方展示的完整原生命令。此次确认只对当前插件和当前市场版本有效，目录变化后需要重新核对。",
        confirmLabel: "确认执行",
        cancelLabel: "取消",
      })
    )
      run({ ...value, acceptCommand: result.confirmation.sha256 });
  }, [action.data, action.variables, run]);
  const discardCommand = useCallback(() => action.reset(), [action]);
  const resetResult = useCallback(() => action.reset(), [action]);
  const contextControls = useMemo(
    () => (
      <InstallContext
        scope={scope}
        path={path}
        cwd={cwd}
        busy={busy}
        confirmation={Boolean(action.data?.confirmation)}
        invalidScope={invalidScope}
        onScope={changeScope}
        onPath={setPath}
        onApply={applyPath}
      />
    ),
    [scope, path, cwd, busy, action.data?.confirmation, invalidScope, changeScope, applyPath],
  );
  return (
    <View style={styles.panel}>
      <PluginCenterHeader navigation={navigation} actions={headerActions} />
      <View style={styles.center} testID="claude-plugin-market">
        {layout.showRail ? (
          <View style={styles.rail}>
            <Text style={styles.railTitle}>已安装</Text>
            <ScrollView style={styles.railScroll} contentContainerStyle={styles.railItems}>
              {rail.isPending ? <InstalledLoading /> : null}
              {rail.error ? (
                <Alert
                  variant="error"
                  title="已安装插件读取失败"
                  description={rail.error.message}
                />
              ) : null}
              {rail.data?.plugins.length === 0 ? (
                <Text style={styles.railEmpty}>暂无已安装插件</Text>
              ) : null}
              {rail.data?.plugins.map((plugin) => (
                <InstalledItem
                  key={plugin.id}
                  plugin={plugin}
                  selected={selected?.id === plugin.id}
                  onOpen={select}
                />
              ))}
              {rail.data?.nextOffset !== null && rail.data?.nextOffset !== undefined ? (
                <Button size="sm" variant="ghost" onPress={viewAllInstalled}>
                  查看全部已安装插件
                </Button>
              ) : null}
            </ScrollView>
          </View>
        ) : null}
        <ScrollView
          ref={scroll}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onScroll={trackScroll}
          scrollEventThrottle={80}
        >
          <View style={styles.canvas}>
            <OperationFeedback
              error={error}
              pending={action.isPending}
              result={action.data}
              busy={busy}
              retry={retry}
              confirmCommand={confirmCommand}
              discardCommand={discardCommand}
              resetResult={resetResult}
            />
            {selected ? contextControls : null}
            {selected ? (
              <ClaudeDetail
                client={client}
                serverId={serverId}
                selection={selected}
                cwd={cwd}
                scope={scope}
                onAction={run}
                busy={busy || invalidScope}
              />
            ) : (
              <ClaudeCatalogView
                contextControls={contextControls}
                data={catalog.data}
                pending={catalog.isPending}
                fetching={catalog.isFetching}
                twoColumns={layout.twoColumns}
                query={query}
                view={view}
                scope={scope}
                source={source}
                busy={busy}
                invalidScope={invalidScope}
                offset={offset}
                searchChanged={searchChanged}
                refreshCatalog={refreshCatalog}
                changeView={changeView}
                run={run}
                setSource={setSource}
                add={add}
                official={official}
                select={select}
                previous={previous}
                next={next}
              />
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
function PluginCard({
  plugin,
  onOpen,
  twoColumns,
}: {
  plugin: ClaudePlugin;
  onOpen(plugin: ClaudePlugin): void;
  twoColumns: boolean;
}) {
  const open = useCallback(() => onOpen(plugin), [onOpen, plugin]);
  return (
    <View style={[styles.card, twoColumns && styles.cardTwo]}>
      <Pressable
        style={cardStyle}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`查看 ${plugin.title} 详情`}
      >
        <PluginIcon plugin={plugin} />
        <View style={styles.cardText}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {plugin.title}
          </Text>
          <Text style={styles.cardDescription} numberOfLines={2}>
            {plugin.description || plugin.marketplaceName}
          </Text>
        </View>
        {plugin.installed ? <Check size={14} /> : null}
      </Pressable>
    </View>
  );
}
function cardStyle({ hovered }: { hovered?: boolean }) {
  return [styles.cardMain, hovered && styles.cardHover];
}
function installedItemStyle({ hovered }: { hovered?: boolean }) {
  return [styles.installedItem, hovered && styles.hover];
}
function installedSelectedItemStyle({ hovered }: { hovered?: boolean }) {
  return [styles.installedItem, styles.installedItemSelected, hovered && styles.hover];
}
function InstalledItem({
  plugin,
  selected,
  onOpen,
}: {
  plugin: ClaudePlugin;
  selected: boolean;
  onOpen(plugin: ClaudePlugin): void;
}) {
  const open = useCallback(() => onOpen(plugin), [plugin, onOpen]);
  return (
    <Pressable
      style={selected ? installedSelectedItemStyle : installedItemStyle}
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`查看 ${plugin.title} 详情`}
    >
      <PluginIcon plugin={plugin} size="tiny" />
      <Text style={styles.installedName} numberOfLines={1}>
        {plugin.title}
      </Text>
    </Pressable>
  );
}
function SourceRow({
  name,
  source,
  scope,
  onAction,
  busy,
}: {
  name: string;
  source: string;
  scope: ClaudePluginScope;
  onAction(action: ClaudePluginAction): void;
  busy: boolean;
}) {
  const refresh = useCallback(
    () => onAction({ kind: "refresh_marketplace", name }),
    [name, onAction],
  );
  const remove = useCallback(
    () => onAction({ kind: "remove_marketplace", name, scope }),
    [name, scope, onAction],
  );
  return (
    <View style={styles.sourceRow}>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{name}</Text>
        <Text style={styles.muted}>{source}</Text>
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

function ClaudeDetail({
  client,
  serverId,
  selection,
  cwd,
  scope,
  onAction,
  busy,
}: {
  client: ClaudeMarketClient;
  serverId: string;
  selection: ClaudePlugin;
  cwd?: string;
  scope: ClaudePluginScope;
  onAction(action: ClaudePluginAction): void;
  busy: boolean;
}) {
  const detail = useFetchQuery({
    queryKey: [...root(serverId), "detail", selection.id, cwd],
    queryFn: () => client.getClaudePluginDetail(selection.id, cwd),
    dataShape: "value",
    staleTimeMs: 30000,
    retry: false,
  });
  const plugin = detail.data?.plugin ?? selection;
  const installed = plugin.installations.some((item) => item.scope === scope);
  const readOnly =
    plugin.installations.some((item) => ["managed", "synced", "session"].includes(item.scope)) ||
    ["skills-dir", "inline"].includes(plugin.marketplaceName);
  const install = useCallback(
    () => onAction({ kind: "install", pluginId: plugin.id, scope }),
    [plugin.id, scope, onAction],
  );
  const toggle = useCallback(
    () => onAction({ kind: "set_enabled", pluginId: plugin.id, scope, enabled: !plugin.enabled }),
    [plugin.id, plugin.enabled, scope, onAction],
  );
  const update = useCallback(
    () => onAction({ kind: "update", pluginId: plugin.id, scope }),
    [plugin.id, scope, onAction],
  );
  const remove = useCallback(
    () => onAction({ kind: "uninstall", pluginId: plugin.id, scope }),
    [plugin.id, scope, onAction],
  );
  const retry = useCallback(() => {
    void detail.refetch();
  }, [detail]);
  const website = useMutation({
    mutationFn: async (value: string) => {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("插件网站地址格式无效");
      await openExternalUrl(url.href);
    },
  });
  const openWebsite = useCallback(() => {
    if (plugin.websiteUrl) website.mutate(plugin.websiteUrl);
  }, [website, plugin.websiteUrl]);
  const openReadmeLink = useCallback(
    (url: string) => {
      website.mutate(url);
      return false;
    },
    [website],
  );
  return (
    <View style={detailStyles.detail} testID="claude-plugin-detail">
      <View style={detailStyles.hero}>
        <PluginIcon key={plugin.id} plugin={plugin} size="hero" />
        <View style={detailStyles.heroText}>
          <Text style={detailStyles.title}>{plugin.title}</Text>
          <Text style={detailStyles.muted}>{plugin.developer ?? plugin.marketplaceName}</Text>
        </View>
        {!readOnly ? (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={installed ? Check : Plus}
            onPress={installed ? toggle : install}
            disabled={busy}
          >
            {installLabel(installed, plugin.enabled)}
          </Button>
        ) : null}
      </View>
      <DetailContent
        plugin={plugin}
        data={detail.data}
        loading={detail.isPending}
        error={detail.error}
        readOnly={readOnly}
        onRetry={retry}
        onLink={openReadmeLink}
      />
      <DetailInfo
        plugin={plugin}
        sending={website.isPending}
        error={website.error}
        openWebsite={openWebsite}
      />
      {installed && !readOnly ? (
        <View style={detailStyles.footer}>
          <Text style={detailStyles.muted}>由所选主机的 Claude Code 管理 · 新会话读取配置</Text>
          <Button size="sm" variant="outline" onPress={update} disabled={busy}>
            更新插件
          </Button>
          <Button size="sm" variant="ghost" onPress={remove} disabled={busy}>
            卸载所选范围
          </Button>
        </View>
      ) : null}
    </View>
  );
}

function OperationFeedback({
  error,
  pending,
  result,
  busy,
  retry,
  confirmCommand,
  discardCommand,
  resetResult,
}: {
  error: Error | null;
  pending: boolean;
  result: ActionResult | null | undefined;
  busy: boolean;
  retry(): void;
  confirmCommand(): void;
  discardCommand(): void;
  resetResult(): void;
}) {
  return (
    <>
      {error ? (
        <Alert variant="error" title="操作未完成" description={error.message}>
          <Button size="sm" variant="outline" onPress={retry} disabled={busy}>
            重试
          </Button>
        </Alert>
      ) : null}
      {pending ? <Text style={styles.muted}>正在由 Claude Code 处理，请稍候...</Text> : null}
      {result?.confirmation ? (
        <Alert variant="warning" title="需要单独确认原生命令" description={result.message}>
          <Text selectable style={styles.muted}>
            {result.confirmation.description}
          </Text>
          <Button size="sm" onPress={confirmCommand} disabled={busy}>
            核对并确认执行
          </Button>
          <Button size="sm" variant="ghost" onPress={discardCommand} disabled={busy}>
            取消
          </Button>
        </Alert>
      ) : null}
      {result && result.confirmation === null ? (
        <Alert
          variant="success"
          title="操作完成"
          description={
            result.restartRequired
              ? "原生配置已保存。新会话自动读取，已有会话不会自动重启。"
              : "市场来源已刷新"
          }
        >
          <Button size="sm" variant="ghost" onPress={resetResult}>
            关闭提示
          </Button>
        </Alert>
      ) : null}
    </>
  );
}

function InstallContext({
  scope,
  path,
  cwd,
  busy,
  confirmation,
  invalidScope,
  onScope,
  onPath,
  onApply,
}: {
  scope: ClaudePluginScope;
  path: string;
  cwd: string | undefined;
  busy: boolean;
  confirmation: boolean;
  invalidScope: boolean;
  onScope(value: ClaudePluginScope): void;
  onPath(value: string): void;
  onApply(): void;
}) {
  return (
    <View style={styles.sourceForm}>
      <Text style={styles.muted}>安装范围</Text>
      <SegmentedControl
        options={scopes.map((item) => ({
          ...item,
          disabled: busy || Boolean(confirmation),
        }))}
        value={scope}
        onValueChange={onScope}
        size="sm"
      />
      {scope !== "user" ? (
        <>
          <Field label="项目目录（所选主机的绝对路径）">
            <FormTextInput
              initialValue={path}
              onChangeText={onPath}
              placeholder="填写绝对路径后点击应用；留空仅浏览个人配置"
              size="sm"
              editable={!busy && !confirmation}
              testID="claude-market-cwd"
            />
          </Field>
          <View style={styles.pager}>
            <Text style={styles.muted}>{cwd ? `当前目录：${cwd}` : "当前范围：个人配置"}</Text>
            <Button
              size="sm"
              variant="outline"
              onPress={onApply}
              disabled={busy || Boolean(confirmation)}
            >
              应用目录
            </Button>
          </View>
        </>
      ) : null}
      {invalidScope ? <Text style={styles.muted}>项目范围需要先填写并应用目录。</Text> : null}
    </View>
  );
}

function ClaudeCatalogView({
  contextControls,
  data,
  pending,
  fetching,
  twoColumns,
  query,
  view,
  scope,
  source,
  busy,
  invalidScope,
  offset,
  searchChanged,
  refreshCatalog,
  changeView,
  run,
  setSource,
  add,
  official,
  select,
  previous,
  next,
}: {
  contextControls: ReactNode;
  data: ClaudeCatalog | undefined;
  pending: boolean;
  fetching: boolean;
  twoColumns: boolean;
  query: string;
  view: "catalog" | "installed" | "sources";
  scope: ClaudePluginScope;
  source: string;
  busy: boolean;
  invalidScope: boolean;
  offset: number;
  searchChanged(value: string): void;
  refreshCatalog(): void;
  changeView(value: "catalog" | "installed" | "sources"): void;
  run(value: ClaudePluginAction): void;
  setSource(value: string): void;
  add(): void;
  official(): void;
  select(value: ClaudePlugin): void;
  previous(): void;
  next(): void;
}) {
  return (
    <>
      <View style={styles.heading}>
        <View style={styles.headingText}>
          <Text style={styles.subtitle}>浏览原生市场，让技能、智能体与工具协同工作</Text>
        </View>
        <View style={styles.headingActions}>
          <View style={styles.searchBox}>
            <ThemedSearch size={14} uniProps={searchIconColor} />
            <FormTextInput
              initialValue={query}
              onChangeText={searchChanged}
              placeholder="搜索插件"
              accessibilityLabel="搜索 Claude Code 插件"
              size="sm"
              style={styles.searchInput}
            />
          </View>
          <Button
            size="sm"
            variant="outline"
            leftIcon={RefreshCw}
            onPress={refreshCatalog}
            disabled={busy || fetching}
            accessibilityLabel="刷新 Claude Code 插件目录"
          />
        </View>
      </View>
      {contextControls}
      <SegmentedControl options={views} value={view} onValueChange={changeView} size="sm" />
      {pending ? <CatalogLoading twoColumns={twoColumns} sources={view === "sources"} /> : null}
      {view === "sources" ? (
        <>
          {data?.marketplaces.map((market) => (
            <SourceRow
              key={market.name}
              name={market.name}
              source={market.source}
              scope={scope}
              onAction={run}
              busy={busy || invalidScope}
            />
          ))}
          <Field label="添加市场来源">
            <FormTextInput
              initialValue={source}
              onChangeText={setSource}
              placeholder="owner/repo、仓库地址或主机本地目录"
              size="sm"
              editable={!busy}
            />
          </Field>
          <Button
            size="sm"
            variant="outline"
            leftIcon={Plus}
            onPress={add}
            disabled={busy || invalidScope || !source.trim()}
          >
            添加来源
          </Button>
          {!data?.marketplaces.some((m) => m.name === "claude-plugins-official") ? (
            <Button size="sm" variant="outline" onPress={official} disabled={busy || invalidScope}>
              添加 Anthropic 官方市场
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <View style={styles.grid}>
            {data?.plugins.map((plugin) => (
              <PluginCard key={plugin.id} plugin={plugin} onOpen={select} twoColumns={twoColumns} />
            ))}
          </View>
          {data?.plugins.length === 0 ? (
            <View style={styles.state}>
              <Text style={styles.title}>{query ? "没有匹配的插件" : "当前目录暂无插件"}</Text>
              <Text style={styles.muted}>
                可在“市场来源”添加官方或自定义来源；已有会话不受影响。
              </Text>
            </View>
          ) : null}
          {data ? (
            <View style={styles.pager}>
              <Text
                style={styles.muted}
              >{`共 ${data.total} 项 · 第 ${Math.floor(offset / 50) + 1} 页`}</Text>
              <Button
                size="sm"
                variant="ghost"
                onPress={previous}
                disabled={busy || fetching || offset === 0}
              >
                上一页
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={next}
                disabled={busy || fetching || data.nextOffset === null}
              >
                下一页
              </Button>
            </View>
          ) : null}
        </>
      )}
    </>
  );
}

function DetailContent({
  plugin,
  data,
  loading,
  error,
  readOnly,
  onRetry,
  onLink,
}: {
  plugin: ClaudePlugin;
  data: ClaudeDetailData | undefined;
  loading: boolean;
  error: Error | null;
  readOnly: boolean;
  onRetry(): void;
  onLink(url: string): boolean;
}) {
  return (
    <>
      {readOnly ? (
        <Alert
          title="此插件由原生目录、组织策略或账号同步管理"
          description="此处仅查看详情，不改写它的安装记录。"
        />
      ) : null}
      {error ? (
        <Alert variant="error" title="插件详情读取失败" description={error.message}>
          <Button size="sm" variant="outline" onPress={onRetry}>
            重试
          </Button>
        </Alert>
      ) : null}
      {plugin.errors.length > 0 ? (
        <Alert
          variant="warning"
          title="原生插件资料或加载状态需要检查"
          description={plugin.errors.join("\n")}
        />
      ) : null}
      <Text style={detailStyles.description}>
        {data?.description || plugin.description || "此插件未提供介绍"}
      </Text>
      {loading ? <DetailLoading /> : null}
      {data?.contentStatus === "install_required" ? (
        <Alert
          title="完整资料将在安装后读取"
          description="此插件尚未下载到当前主机，目前展示市场提供的介绍；打开详情不会安装或执行插件。"
        />
      ) : null}
      {data?.readme ? (
        <MarkdownRenderer
          text={data.readme}
          enableHtmlish={false}
          allowedImageHandlers={["https://", "http://"]}
          onLinkPress={onLink}
        />
      ) : null}
      {data && data.components.length > 0 ? (
        <View style={detailStyles.section}>
          <Text style={detailStyles.sectionTitle}>插件内容</Text>
          {data.components.map((name) => (
            <Text key={name} style={detailStyles.name}>
              {name}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}

function DetailInfo({
  plugin,
  sending,
  error,
  openWebsite,
}: {
  plugin: ClaudePlugin;
  sending: boolean;
  error: Error | null;
  openWebsite(): void;
}) {
  return (
    <View style={detailStyles.section}>
      <Text style={detailStyles.sectionTitle}>信息</Text>
      <View style={detailStyles.info}>
        <Text style={detailStyles.muted}>{`市场：${plugin.marketplaceName}`}</Text>
        <Text style={detailStyles.muted}>{`版本：${plugin.version ?? "未声明"}`}</Text>
        <Text
          style={detailStyles.muted}
        >{`已安装范围：${plugin.installations.map((item) => scopes.find((s) => s.value === item.scope)?.label ?? item.scope).join("、") || "未安装"}`}</Text>
        {plugin.websiteUrl ? (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={ExternalLink}
            onPress={openWebsite}
            disabled={sending}
          >
            网站
          </Button>
        ) : null}
        {error ? <Text style={detailStyles.error}>{error.message}</Text> : null}
      </View>
    </View>
  );
}

function installLabel(installed: boolean, enabled: boolean) {
  if (!installed) return "安装到所选范围";
  return enabled ? "停用插件" : "启用插件";
}
