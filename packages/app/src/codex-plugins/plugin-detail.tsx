import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { ArrowLeft, ExternalLink, Plus, Check } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMutation } from "@tanstack/react-query";
import type { CodexPluginAction, CodexPluginDetail } from "@getpaseo/protocol/codex-plugins";
import { useFetchQuery } from "@/data/query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/utils/open-external-url";
import { PluginIcon } from "./plugin-icon";
import type { MarketClient, PluginSelection } from "./marketplace-page";

export function PluginDetail({
  selection,
  client,
  serverId,
  onBack,
  onAction,
  busy,
}: {
  selection: PluginSelection;
  client: MarketClient;
  serverId: string;
  onBack(): void;
  onAction(action: CodexPluginAction): void;
  busy: boolean;
}) {
  const target = useMemo(
    () => ({
      marketplaceName: selection.marketplace.name,
      marketplacePath: selection.marketplace.path,
      pluginName: selection.plugin.name,
    }),
    [selection],
  );
  const detail = useFetchQuery({
    queryKey: ["codexPluginMarket", serverId, "detail", target],
    queryFn: () => client.getCodexPluginDetail(target),
    dataShape: "value",
    staleTimeMs: 30000,
    retry: false,
  });
  const plugin = detail.data?.plugin ?? selection.plugin;
  const install = useCallback(() => onAction({ kind: "install", ...target }), [onAction, target]);
  const toggle = useCallback(
    () => onAction({ kind: "set_enabled", pluginId: plugin.id, enabled: !plugin.enabled }),
    [onAction, plugin.id, plugin.enabled],
  );
  const remove = useCallback(
    () => onAction({ kind: "uninstall", pluginId: plugin.id }),
    [onAction, plugin.id],
  );
  const retry = useCallback(() => {
    void detail.refetch();
  }, [detail]);
  const unavailable = plugin.disabledReason !== null || plugin.installPolicy === "NOT_AVAILABLE";
  return (
    <View style={styles.detail} testID="codex-plugin-detail">
      <View style={styles.breadcrumb}>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={ArrowLeft}
          onPress={onBack}
          testID="codex-plugin-back"
        >
          插件
        </Button>
        <Text style={styles.muted}>/</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {plugin.title}
        </Text>
      </View>
      <View style={styles.hero}>
        <PluginIcon key={plugin.id} plugin={plugin} size="hero" />
        <View style={styles.heroText}>
          <Text style={styles.title}>{plugin.title}</Text>
          <Text style={styles.muted} numberOfLines={2}>
            {plugin.developer ?? selection.marketplace.title}
          </Text>
        </View>
        {plugin.installed ? (
          <Button
            size="sm"
            variant="outline"
            leftIcon={Check}
            onPress={toggle}
            disabled={busy || unavailable}
          >
            {plugin.enabled ? "停用插件" : "启用插件"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={Plus}
            onPress={install}
            disabled={busy || unavailable}
          >
            安装插件
          </Button>
        )}
      </View>
      {unavailable ? (
        <Alert
          variant="warning"
          title="当前账号或主机策略不允许安装或使用此插件"
          description={plugin.disabledReason}
        />
      ) : null}
      {detail.error ? (
        <Alert variant="error" title="插件详情读取失败" description={detail.error.message}>
          <Button size="sm" variant="outline" onPress={retry}>
            重试
          </Button>
        </Alert>
      ) : null}
      <Text style={styles.description}>
        {detail.data?.description || plugin.description || "此插件未提供介绍"}
      </Text>
      {detail.isPending ? <Text style={styles.muted}>正在读取应用、技能和工具...</Text> : null}
      {detail.data ? <Components detail={detail.data} /> : null}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>信息</Text>
        <View style={styles.info}>
          <InfoRow label="开发者" value={plugin.developer} />
          <InfoRow label="类别" value={plugin.category} />
          <InfoRow label="版本" value={plugin.version} />
          <InfoRow label="市场" value={selection.marketplace.title} />
          <PluginLink label="网站" url={plugin.websiteUrl} />
          <PluginLink label="隐私政策" url={plugin.privacyPolicyUrl} />
          <PluginLink label="服务条款" url={plugin.termsOfServiceUrl} />
        </View>
      </View>
      {plugin.installed ? (
        <View style={styles.footer}>
          <Text style={styles.muted}>安装与权限由当前主机的 Codex 管理</Text>
          <Button size="sm" variant="ghost" onPress={remove} disabled={busy}>
            卸载插件
          </Button>
        </View>
      ) : null}
    </View>
  );
}
function Components({ detail }: { detail: CodexPluginDetail }) {
  const { apps, skills, mcpServers } = detail;
  return (
    <>
      {apps.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{`应用 ${apps.length}`}</Text>
          {apps.map((app) => (
            <View key={app.name} style={styles.component}>
              <PluginIcon plugin={detail.plugin} size="list" />
              <View style={styles.componentText}>
                <Text style={styles.name}>{app.name}</Text>
                {app.description ? <Text style={styles.muted}>{app.description}</Text> : null}
              </View>
              {app.url ? <PluginLink label="连接" url={app.url} /> : null}
            </View>
          ))}
        </View>
      ) : null}
      {skills.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{`技能 ${skills.length}`}</Text>
          {skills.map((skill) => (
            <View key={skill.name} style={styles.skill}>
              <Text style={styles.name}>{skill.name}</Text>
              <Text style={styles.muted}>{skill.description}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {mcpServers.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>MCP 服务</Text>
          {mcpServers.map((name) => (
            <Text key={name} style={styles.name}>
              {name}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}
function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}
function PluginLink({ label, url }: { label: string; url: string | null }) {
  const link = useMutation({
    mutationFn: async () => {
      if (url === null) throw new Error("此插件未提供链接");
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
        throw new Error("链接地址格式无效");
      await openExternalUrl(url);
    },
  });
  const open = useCallback(() => link.mutate(), [link]);
  if (!url) return null;
  return (
    <View>
      <Button
        size="sm"
        variant="ghost"
        leftIcon={ExternalLink}
        onPress={open}
        disabled={link.isPending}
      >
        {label}
      </Button>
      {link.error ? <Text style={styles.error}>{link.error.message}</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  detail: { gap: theme.spacing[8], maxWidth: 880, width: "100%", alignSelf: "center" },
  breadcrumb: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  hero: { flexDirection: "row", alignItems: "center", gap: theme.spacing[4], flexWrap: "wrap" },
  heroText: { flex: 1, minWidth: 160, gap: theme.spacing[2] },
  title: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  muted: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted, lineHeight: 24 },
  description: { fontSize: theme.fontSize.base, color: theme.colors.foreground, lineHeight: 26 },
  section: { gap: theme.spacing[4] },
  sectionTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  info: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[4],
    gap: theme.spacing[2],
  },
  infoRow: { flexDirection: "row", gap: theme.spacing[4] },
  label: { width: 96, fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
  infoValue: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.foreground },
  component: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  componentText: { flex: 1, gap: theme.spacing[1] },
  name: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  skill: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  footer: {
    flexDirection: "row",
    gap: theme.spacing[3],
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  error: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
}));
