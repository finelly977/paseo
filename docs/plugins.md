# Plugins

Local plugins contribute daemon RPCs, native app surfaces, workspace panels, Command Center items,
composer pills, app themes, and composer attachment sources from one `index.ts`. Paseo executes the server contribution in a
subprocess and evaluates the client contribution in the app runtime. Plugin code is trusted code;
Paseo does not sandbox it.

## Install a directory source

Create a typecheckable plugin project, install its development dependencies, then install it into
the daemon. `init` only writes the project files; it does not run the package manager.

```bash
paseo plugin init /absolute/path/to/my-plugin
cd /absolute/path/to/my-plugin
npm install
npm run typecheck
paseo plugin install /absolute/path/to/my-plugin
paseo plugin install /absolute/path/to/my-plugin --id another-runtime-id
paseo plugin ls
```

The daemon stores directory sources under the root `plugins` object:

```json
{
  "pluginsEnabled": true,
  "plugins": {
    "my-plugin": {
      "source": "directory",
      "path": "/absolute/path/to/my-plugin",
      "enabled": true
    }
  }
}
```

The plugin system is disabled unless `pluginsEnabled` is `true`. Changing that root field is
runtime-safe: run `paseo reload` after editing `config.json`. Enabling starts every configured,
enabled plugin; disabling tears them all down without restarting the daemon. Plugin source entries
remain lifecycle-owned and do not reload from manual config edits.

The directory contains an identity-only manifest, one entry point, and local typechecking support:

```text
my-plugin/
  paseo-plugin.json
  index.ts
  main.client.tsx
  paseo-plugin.d.ts
  package.json
  tsconfig.json
```

Paseo compiles TypeScript and TSX when loading the plugin, so these packages are development dependencies only.
The generated declaration file supplies `@getpaseo/plugin` and `@getpaseo/plugin/server` types until the
SDK is distributed as a public package. Regenerate new plugins with the matching Paseo CLI when the
SDK contract changes.

```json
{
  "id": "my-plugin"
}
```

The config key is the runtime plugin ID. The manifest ID is the default selected during install;
`--id` overrides it. Existing configuration is not renamed when the manifest changes, and the
runtime does not compare the two IDs. The same directory can be installed under several config
keys.

Never enable plugins on a user's behalf without explicit permission. Before asking, check the
target daemon's current `pluginsEnabled` value. State that plugins are trusted, unsandboxed code:
backend code can access the daemon machine, while client contributions run inside the Paseo app.

Source changes are explicit. Run `paseo plugin reload <id>` to stop and fully tear down the old
plugin before compiling and starting from disk. A failed reload stays failed; Paseo does not restore
the old code. Use `enable`, `disable`, and `remove` to manage one plugin. Removing a directory source
never deletes it. The global `pluginsEnabled` switch remains available.

## Install a Git source

GitHub repositories use an `owner/repository` shorthand. Other hosts use a Git URL. An existing
directory always wins over shorthand resolution.

```bash
paseo plugin add owner/repository
paseo plugin add https://git.example.com/owner/repository.git
paseo plugin add owner/monorepo --path plugins/review
paseo plugin add owner/repository --ref main
paseo plugin status
paseo plugin update review
paseo plugin update --all
```

Omitting `--ref` tracks the remote's default branch. A branch passed with `--ref` also tracks;
tags and commits stay pinned. `status` fetches tracked refs and reports the installed and available
commits. `update` checks out a new version, validates its manifest, compiles both bundles, and starts
it before changing the configured path. A compilation or startup failure restores the running
version. Removing a Git source deletes Paseo's managed checkout.

Git installation does not run a package manager or install script. A distributable source plugin
uses Paseo's host-provided modules or commits any other bundled source it needs. Native React Native
dependencies work only when the Paseo app already ships the native module.

Server contributions can write to stdout and stderr with normal Node logging. Paseo adds `[paseo]`
entries for loading, ready, stopping, and stopped transitions. Compilation and load failures are
recorded as stderr entries before a subprocess exists. Inspect the recent in-memory
tail from the host plugin settings or with `paseo plugin logs <id>`. Reload, disable, and process
failure retain the tail; removing the plugin clears it. Daemon restarts do not retain the tail, but
structured copies remain in `$PASEO_HOME/daemon.log`. Plugin output can contain secrets, so do not
log credentials or tokens.

## Contribute behavior and UI

Default export one contribution function from `index.ts`. Keep it to contribution wiring. Runtime
code lives behind filename boundaries:

| Suffix         | Owns                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `*.client.tsx` | React, React Native, hooks, styles, surfaces, panels, and callbacks. |
| `*.server.ts`  | Node APIs, filesystem and process access, credentials, and handlers. |
| `*.shared.ts`  | Zod RPC contracts and plain values used by both runtimes.            |

Shared files import contracts from `@getpaseo/plugin/server`. Client files import Paseo UI from
`@getpaseo/plugin/react-native`. Its `Icon` resolves a Lucide name using the client's installed icon
set; an unknown name renders nothing so it cannot break the plugin surface.
Its controlled modal keeps presentation metadata on `<Modal title="…" icon={…}>` and body UI in
`<Modal.Content>`.
Plugin UI runs on desktop and mobile across multiple themes: color every `Text` from
`theme.colors.foreground` or `theme.colors.foregroundMuted`, and size layout from `layout.compact`.
See `public-docs/plugins/reference.md`.

| Module                          | Use it for                                               |
| ------------------------------- | -------------------------------------------------------- |
| `@getpaseo/plugin`              | contribution contracts and client data hooks             |
| `@getpaseo/plugin/react-native` | Paseo React Native components and UI hooks               |
| `@getpaseo/plugin/server`       | `defineRpc`, `defineAttachmentSource`, and handler types |

The compiler removes client registrations and imports from the server entry point, and server
registrations and imports from the client entry point. Importing a `*.server` module from a client
module, or a `*.client` module from a server module, fails compilation. Top-level React Native calls
such as `StyleSheet.create` belong in `*.client.tsx`; placing them in `index.ts` executes them in the
server bundle.

```ts
import type { PluginContext } from "@getpaseo/plugin";
import { Greeting } from "./greeting.client";
import { createGreeting } from "./greeting.server";
import { greetRpc } from "./greeting.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(greetRpc, createGreeting);
  plugin.addSurface("main", Greeting);
  plugin.addSidebarItem({ id: "main", title: "Greeting", icon: "MessageCircle", surface: "main" });
  return () => {};
}
```

The contribution function must return cleanup. Server cleanup may be async; Paseo waits for it when
the plugin is reloaded, disabled, removed, disconnected, or shut down. Cleanup is for resources
created by plugin code. Paseo removes registered contributions, unmounts surfaces, clears query
state, rejects pending RPCs, closes the plugin's daemon session, and stops the subprocess. Cleanup
errors are logged and do not interrupt host teardown.

Paseo owns the route, screen header, Lucide icon validation, close action, theme DTO, layout facts,
and render error boundary. The contributed component owns the complete body below the header.

RPC contracts validate inputs and outputs in both the app and plugin subprocess. `useRpc` returns a
typed async function. Use the host-provided `@tanstack/react-query` for request state and caching;
Paseo gives each plugin installation its own query client.

`usePaseo()` and the handler's `{ paseo }` context expose the same `PaseoApi`: projects,
workspaces, agents, providers, and daemon config. They do not expose connection lifecycle. A surface borrows the
selected host's existing connection; switching the screen's host changes both `usePaseo()` and
`useRpc()` to that host. An offline selected host fails there and never falls through to another
installation. A server handler owns an IPC-backed daemon session for the life of its subprocess.
Use plugin RPC for plugin-specific backend behavior that is not a normal Paseo operation.

Each subprocess gets an exclusively owned `plugin:<id>` session. That identity is reserved from
normal clients, never resumes another session, and is cleaned immediately on exit without reconnect
grace. During daemon startup, plugin sessions may connect while application WebSockets remain
paused; the daemon accepts clients only after configured plugins have settled and the initial
catalog is complete.

When the same plugin contribution exists on multiple hosts, Paseo shows it once in the sidebar and
adds a host picker to the screen header. The selected host supplies the bundle, RPC transport, and
query cache. Plugin code cannot address another host.

Workspace panels and Command Center items remain client contributions. The daemon transports their
compiled bundle without interpreting placement or callbacks. Panel props contain workspace and agent
IDs. Required-selector hooks read normalized client state synchronously and use shallow equality, so a
panel does not subscribe to fields it does not render. Command callbacks materialize their snapshots
only when invoked. Contribution discovery and panel opening never fetch active context through plugin
RPC. Snapshot DTOs are deeply readonly and frozen at runtime so plugin code cannot mutate normalized
app state or a memoized selection. Panels use one persisted
`plugin` workspace-tab target, so reload, disable, removal, and restoration resolve through the
current installed-plugin catalog. A missing contribution renders unavailable inside the tab.

Command Center callbacks use the selected host's existing `PaseoApi` for normal Paseo operations.
They use typed plugin RPC only for plugin-specific backend work. Surface and panel props expose
optional client-owned agent and workspace navigation; its absence is the compatibility gate for
older clients. Other navigation remains limited to registered global surfaces and workspace panels.
Plugins do not receive Expo Router or workspace-layout store access.

## Contribute composer pills

Register a headless client entrypoint, then add and remove targeted pills from that client
lifecycle. `addClientSide` runs once per plugin installation in each connected app and never runs
in the daemon subprocess. It can subscribe to the client API, call plugin RPCs, and own arbitrary
client state without mounting a panel or surface.

```tsx
export function contributeClient(client: PluginClientContext) {
  const pills = new Map<string, () => void>();
  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind !== "upsert" || !update.agent.workspaceId) return;
    const { id: agentId, workspaceId } = update.agent;
    pills.get(agentId)?.();
    pills.set(
      agentId,
      client.addComposerPill({
        id: "review",
        title: "Open review",
        workspaceId,
        agentId,
        Component: ReviewPill,
        async onPress() {
          await client.rpc(refreshReview, { agentId });
          client.openPanel("review", { workspaceId, agentId });
        },
      }),
    );
  });
  return () => {
    unsubscribe();
    for (const remove of pills.values()) remove();
  };
}
```

Wire it from `index.ts` with `plugin.addClientSide(contributeClient)`. `addComposerPill` exists only
on `PluginClientContext`; it returns an idempotent removal function. A pill appears only in the
matching workspace and agent track bar alongside Tasks and Subagents. Paseo owns the pressable,
shared chrome, pending state, error reporting, and placement. The component owns its icon and text;
the callback is client code by construction. Removing the pill, reloading the plugin, disconnecting
the host, or unloading the app tears down the contribution.

## Contribute timeline items

Timeline transformers and renderers are client contributions. The daemon's canonical rows and
built-in projection stay unchanged. The app transforms fetched projected history before building
its render model. A matching live event requests a fresh projected tail, so lifecycle deltas are
collapsed before the transformer replaces anything.

`query.itemType` selects one public `AgentTimelineItem.type`. The callback owns any detailed
recognition and returns plain plugin item objects. `undefined` keeps the source item, `items`
replaces it, and an empty array removes it. Output `data` must be JSON-compatible. Paseo adds the
runtime plugin ID, preserves the source timeline cursor, validates renderer data with its Zod
schema, and mounts the component inside the normal plugin runtime and error boundary.

Transformers run synchronously and must be deterministic. When several transformers match, the
first one that returns a result owns that source item. Plugin and registration ordering is stable.
See `plugin-examples/timeline-items` for the complete contract.

## Contribute composer attachments

Register a declarative attachment source backed by a plugin RPC. Paseo owns the attachment menu,
search picker, drafts, selected pill, and submission. The plugin returns complete text snapshots;
credentials and vendor API calls stay in the daemon handler.

```ts
import type { PluginContext } from "@getpaseo/plugin";
import { search } from "./issues.server";
import { issues, searchIssues } from "./issues.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(searchIssues, search);
  plugin.addAttachmentSource(issues);
  return () => {};
}
```

Attachment sources stay scoped to the composer's host. Unlike sidebar contributions, equal sources
on several hosts are not coalesced. The selected snapshot submits as a text attachment with neutral
external-resource presentation, so it remains readable if the plugin is removed or an older peer
drops the optional presentation fields.

## Contribute a theme

`addTheme` takes a small light or dark palette and a display name. Paseo expands it through the
same semantic builders as the built-in themes, so plugins do not depend on the complete app token
contract. Unistyles needs every theme name at `StyleSheet.configure` time, so
`packages/app/src/styles/theme.ts` reserves one light and one dark plugin slot. The appearance
provider rewrites the matching slot when the selection changes. See [unistyles.md](unistyles.md)
for the runtime-patching rules the appearance settings share.

`addTheme` is a client registration, so the compiler strips it from the backend bundle. A daemon
that predates it does not, and the plugin fails to start there. Daemons advertise
`features.pluginThemes` in `server_info`; the plugin theme catalog is the one place the app reads it, and
a host without it contributes no themes.

The selection persists as `theme: "plugin"` plus a `pluginThemeId` of `<pluginId>/theme/<themeId>`,
so equal themes on several hosts coalesce the way sidebar contributions do. Two hosts can answer
that id with different palettes, so picking a theme records its host through
`rememberPluginContributionHost` and resolution prefers it; a peer connecting or dropping then does
not repaint the app. Without a preference the sorted registry snapshot decides, so the result is
stable rather than arrival-ordered. The app resolves that id
against the installed catalog on every change; an id nothing contributes falls back to the default
preference instead of painting the reserved slot's placeholder colors.

See `plugin-examples/local-plugin` for a native surface, `plugin-examples/linear` for a complete
attachment-source example, `plugin-examples/timeline-items` for timeline projection, and
`plugin-examples/catppuccin` for a theme.

## 原生插件中心

Codex 与 Claude Code 原生插件都位于全局侧栏“插件”，在标题栏切换提供方并选择主机。它们与本文的 Paseo 受信任本地扩展是不同系统，不会把智能体插件包作为 Paseo 客户端扩展运行。

桌面入口复用设置的居中浮层，插件中心扩大为最大宽度 1280 像素、高度 94%，可从右上角、Esc 或遮罩关闭；原工作区与 Explorer 继续作为背景显示，不改变其尺寸、阅读位置或真实路由焦点。紧凑布局使用全屏页面并保留关闭按钮，直接打开链接时没有背景也不额外创建工作区。目录及详情共用固定标题栏，返回按钮位于左上角，不随正文滚动，返回时恢复目录搜索与阅读位置。初始主机直接从现有主机列表解析，单双栏与已安装侧栏按浮层宽度在首帧确定，不等待一次零宽度测量后重新排版。内部列表依据浮层实际宽度选择单双栏，目录图标 36 像素、详情图标 64 像素，列表收紧内边距与行间距但保持界面字号。目录、已安装列表与详情加载时使用结构占位及轻微透明度呼吸，减少动态效果时保持静态，不虚构加载百分比或安装数据。

### Codex

服务端通过该主机的 Codex app-server 插件管理接口读取与修改原生状态，已用 Codex CLI 0.167.0 的协议生成器、真实目录读取和隔离原生安装验证。`plugin/list`、`plugin/read`、`plugin/install` 和 `plugin/uninstall` 仍属于官方开发中的接口，协议变化应显式报错并要求更新，不能用空目录掩盖失败。插件市场的 RPC 为 `codex.plugins.get_catalog`、`codex.plugins.get_detail` 和 `codex.plugins.manage`，统一要求主机管理权限。

市场进程只负责目录、详情和管理，不创建对话或启动桌面工具。它保留提供方实际启动命令和环境中的 `CODEX_HOME`，仅启动参数临时选择内置 `openai` 服务商，去掉 `OPENAI_API_KEY`、`CODEX_API_KEY` 覆盖，让原生认证管理读取已有官方账号。第三方模型的 `requires_openai_auth = false` 不再阻断此进程读取官方市场；全局配置与正文运行时不变。有效 ChatGPT 登录和服务端账号策略仍是官方在线目录的前提，本地市场不需要伪造凭据。Windows 沿用显式代理，未设置时读取系统代理。

目录缓存只保留成功快照一分钟，按主机上的提供方实例持有；本地与官方目录分开读取、超时和报错。界面搜索与分页每次最多交付 50 项，详情按点击读取完整介绍、应用、技能与工具。目录项、详情目标与安装请求保留可选 `remotePluginId`；远程 `plugin/read` 与 `plugin/install` 的原生 `pluginName` 参数优先使用这个后端 ID，本地市场仍用原名称和目录路径，启停与卸载仍使用配置中的 `name@marketplace` 标识。实际验证过 Exa 的名称 `app-…` 与后端 `plugin_asdk_app_…` 不同，混用会返回 404；不能靠捕获异常后返回目录摘要冒充完整详情。插件变更串行执行并使缓存代际失效，旧读取不得恢复已失效快照。安装后按原生结果提供后续授权链接，客户端不转发或记录账号令牌。已有运行会话不自动重启；新会话读取新配置，旧会话由用户明确重新加载。

品牌图标来自原生元数据；本地图标只读取原生返回的文件路径，限定图片类型及 512 KiB 大小，转成图像数据交付远端客户端。原生没有图标时使用通用扩展占位，不伪造品牌图标。官网、隐私政策和条款链接只允许 HTTP/HTTPS 外部打开。

### Claude Code

主机启用 Claude 提供方后公布 `claudePluginMarket` 能力，市场 RPC 使用 `claude.plugins.get_catalog`、`claude.plugins.get_detail` 和 `claude.plugins.manage`，入站与出站均要求 `daemon.manage`。沿用提供方的启动命令、前置参数、环境和 `CLAUDE_CONFIG_DIR`；目录及详情不是模型请求，不创建智能体或启动对话。已只读核对本机真实目录，并用 Claude Code 2.1.319、Agent SDK 0.3.246 完成隔离原生管理验收。

- 目录使用 `claude plugin list --json --available` 与 `plugin marketplace list --json`，在主机缓存成功快照一分钟，每页最多 50 项，详情按点击读取。原生接口无效或返回错误时明确报错，不用空目录替代。客户端不接收原生列表中的 MCP 配置、环境变量或凭据。
- 个人范围默认从主机用户目录读取；项目共享和项目私有范围要求用户填写并应用绝对项目路径。目录状态由原生 CLI 合并设置决定，不能用安装范围猜测启停状态。组织、同步、会话及技能目录管理的插件保留只读说明，不伪造可卸载状态。
- 原生管理操作显式传递范围并串行执行。安装或更新需要运行市场命令时，先展示原生 `shownCommand` 资料，再由用户确认 `--accept-command` 的 SHA-256；不自动加 `--yes`。来源移除可能卸载插件并删除配置和数据，确认文案必须保留这一影响。普通卸载传入 `--keep-data`，保留数据目录。
- 详情读取本机市场条目、插件清单、README 与真实图标。远程内容尚未下载时标为“完整资料将在安装后读取”，不冒充完整详情。资源限制在插件目录内，图标最多 512 KiB，清单及 README 最多 256 KiB；可选文件不存在与读取失败分开处理，错误不静默隐藏。README 不把任意主机文件地址交给客户端，外链只允许 HTTP/HTTPS。
- 成功后刷新市场和新建草稿命令缓存；不强制刷新既有会话的 SDK 实例。新会话通过已有 `settingSources` 加载原生启用项，隔离测试通过真实 Paseo Claude 会话的 `listCommands()` 验证安装后技能可见、停用后不可见，未发送模型提示词。不要额外遍历所有缓存版本并注入 SDK，那会绕过启停、范围和版本语义。

原生插件命令、插件清单与 SDK 加载契约分别见 [CLI 文档](https://code.claude.com/docs/en/plugins/cli-reference)、[清单文档](https://code.claude.com/docs/en/plugins-reference) 与 [SDK 文档](https://code.claude.com/docs/en/agent-sdk/plugins)。

## Pi 市场接入评估（尚未实现）

2026-11-09 核对官方文档、本机 CLI 与当前提供方实现，Pi 可以继续接入同一中心，但当前没有 Pi 市场入口。

- Pi 的官方入口是 [Package Catalog](https://pi.dev/packages)。包通过 npm 的 `pi-package` 关键词参与发现，管理使用 `pi install`、`pi remove`、`pi update`；内容可包含扩展、技能、提示词和主题。npm 的公开搜索接口已只读验证可返回名称、版本、介绍及仓库链接。
- 本机 Pi 1.5.0 的 `pi list` 已验证可读取现有包，但没有 JSON 输出选项。结构化已安装信息应读取原生设置中的包声明，保留个人与项目作用域、版本固定、资源过滤和项目信任语义，不解析彩色终端输出，也不以自动批准跳过项目授权。
- Paseo 通过 Pi RPC 驱动会话。工具、技能和部分扩展问答可以沿用现有适配；终端主题、自定义组件、页头页脚及部分小组件不等于 Paseo 界面扩展，不能承诺安装后原样展示。目录预览使用包实际声明的图片，不将预览图字段当作人人都有的品牌图标。

依据：[Pi 包格式与作用域](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)、[RPC 扩展界面的限制](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-extension-ui.md)。

### 后续接入边界

Pi 应在现有浮层增加提供方选项，继续以所选主机为安装边界，使用自己的原生包管理流程。优先提供浏览、详情、安装、卸载和明确生效状态；终端专用扩展与 Paseo 界面扩展分开标识，已有运行会话不自动重启。
