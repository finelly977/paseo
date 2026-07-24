# CLAUDE.md

> **二开说明：** 当前检出目录是 [finelly977/paseo](https://github.com/finelly977/paseo)，它是 [getpaseo/paseo](https://github.com/getpaseo/paseo) 的下游二开。代理身份、远端配置、二开功能清单维护规则和上游同步策略见 [AGENTS.md](AGENTS.md)。用户要求合并原作者最新版时，默认使用最新的**已发布版本**（包括 beta），除非用户明确要求，否则不得使用未发布的 `upstream/main`。

Paseo 是一款用于随时随地监控和控制本地 AI 编程智能体的移动应用。它把真实开发环境放进口袋，并直接连接用户本机，代码始终保留在用户自己的设备上。

**支持的智能体：** Claude Code、Codex、GitHub Copilot、OpenCode 和 Pi。

## 仓库结构

本项目是 npm workspace 单体仓库：

- `packages/server` — 守护进程：智能体生命周期、WebSocket API、MCP 服务端
- `packages/app` — 移动端和网页客户端（Expo）
- `packages/cli` — Docker 风格命令行工具（`paseo run/ls/logs/wait`）
- `packages/relay` — 端到端加密的远程中继
- `packages/desktop` — Electron 桌面端外壳
- `packages/website` — 营销网站（paseo.sh）

## 文档

`docs/` 是系统级和流程级知识的唯一事实来源。用户提到“文档”“检查文档”或“检查某某文档”时，始终指此目录，而不是互联网。访问外部资料前必须先查看这里，因为这些文档记录了无法只从代码或外部资料推导出的约束和注意事项。

开始非轻量任务时，先列出 `docs/`，再快速阅读与任务相关的文件。发现值得长期保留的工程经验、约定、工作流或系统背景时，应更新现有文档或提出新文档。代码级事实写在对应代码旁边；系统级、流程级和注意事项级事实写入 `docs/`。

任何改变二开产品行为的任务，都必须同步维护 [docs/fork-features.md](docs/fork-features.md)。该文件只记录当前仍然有效的二开差异，不记录历史流水账。

| 文档                                                               | 内容                                                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [docs/fork-features.md](docs/fork-features.md)                     | 当前有效的二开功能和与上游的行为差异；上游同步和二开交付前必须审计                  |
| [docs/product.md](docs/product.md)                                 | Paseo 是什么、面向谁、未来方向                                                      |
| [docs/architecture.md](docs/architecture.md)                       | 系统设计、包分层、WebSocket 协议、智能体生命周期和数据流                            |
| [docs/agent-lifecycle.md](docs/agent-lifecycle.md)                 | 智能体状态、父子关系、归档语义、标签与归档的区别、子智能体轨道                      |
| [docs/data-model.md](docs/data-model.md)                           | 基于文件的 JSON 持久化、Zod Schema、原子写入、不使用迁移                            |
| [docs/glossary.md](docs/glossary.md)                               | 权威术语；界面用词优先，不使用同义词混称                                            |
| [docs/coding-standards.md](docs/coding-standards.md)               | 类型规范、错误处理、状态设计、React 模式和文件组织                                  |
| [docs/design.md](docs/design.md)                                   | 主题变量：颜色、字体、间距、圆角和图标                                              |
| [docs/forms.md](docs/forms.md)                                     | 表单架构：非 React 表单模型、表单工具包、加载状态门控；计划任务表单是标准示例       |
| [docs/hover.md](docs/hover.md)                                     | 悬停交互标准模式及常见错误                                                          |
| [docs/unistyles.md](docs/unistyles.md)                             | Unistyles 注意事项；禁止使用 `useUnistyles()`，以及替代方案优先级                   |
| [docs/floating-panels.md](docs/floating-panels.md)                 | 锚定浮层：Android Portal/Modal 逃逸、生命周期门控、键盘共享值、状态栏偏移和闪烁问题 |
| [docs/expo-router.md](docs/expo-router.md)                         | Expo Router 路由所有权、启动恢复和原生空白屏问题                                    |
| [docs/file-icons.md](docs/file-icons.md)                           | 文件浏览器的 Material 图标主题集成                                                  |
| [docs/providers.md](docs/providers.md)                             | 端到端新增智能体提供方                                                              |
| [docs/forge-providers.md](docs/forge-providers.md)                 | 新增 Git 托管服务：注册表、清单、接入检查表、自托管/GHES 和两级事实模型             |
| [docs/custom-providers.md](docs/custom-providers.md)               | 自定义提供方配置：Z.AI、阿里云/Qwen、ACP 智能体、配置档案和自定义二进制文件         |
| [docs/service-proxy.md](docs/service-proxy.md)                     | 服务代理：通过公网地址暴露工作区脚本、DNS 设置和反向代理                            |
| [docs/development.md](docs/development.md)                         | 开发服务、构建同步注意事项、CLI 参考和智能体状态                                    |
| [docs/rpc-namespacing.md](docs/rpc-namespacing.md)                 | WebSocket RPC 命名空间规范：点分命名和 `.request`/`.response` 配对                  |
| [docs/protocol-validation.md](docs/protocol-validation.md)         | zod-aot 生成的入站 WebSocket 校验、编译器回归补丁和 Schema 纯度规则                 |
| [docs/terminal-performance.md](docs/terminal-performance.md)       | 终端延迟链路、合并与背压约束、基准测试和性能规格                                    |
| [docs/testing.md](docs/testing.md)                                 | 测试驱动开发、确定性、真实依赖优先和测试组织                                        |
| [docs/mobile-testing.md](docs/mobile-testing.md)                   | Maestro 和移动端测试流程                                                            |
| [docs/mobile-panels.md](docs/mobile-panels.md)                     | 紧凑布局左/中/右面板所有权、工作线程动画、手势修订和 Fabric 约束                    |
| [docs/ad-hoc-daemon-testing.md](docs/ad-hoc-daemon-testing.md)     | 隔离的进程内守护进程测试工具                                                        |
| [docs/browser-capture-harness.md](docs/browser-capture-harness.md) | 真实 Electron 浏览器截图工具和合成器表面注意事项                                    |
| [docs/android.md](docs/android.md)                                 | 应用变体、本地/云端构建和 EAS 工作流                                                |
| [docs/docker.md](docs/docker.md)                                   | 在 Docker 中运行守护进程和内置网页界面、数据卷、智能体镜像与安全规则                |
| [docs/release.md](docs/release.md)                                 | 发布操作手册、草稿发布和完成检查表                                                  |
| [docs/terminal-activity.md](docs/terminal-activity.md)             | 终端活动指示器、来源无关的跟踪器、智能体钩子上报和新增钩子提供方                    |
| [SECURITY.md](SECURITY.md)                                         | 中继威胁模型、端到端加密、DNS 重绑定和智能体认证                                    |

## 快速开始

```powershell
npm run dev                          # 启动开发守护进程
npm run dev:app                      # 启动连接开发守护进程的 Expo 应用
npm run dev:desktop                  # 启动 Electron 桌面端开发环境
npm run cli -- ls -a -g              # 列出全部智能体
npm run cli -- daemon status         # 检查守护进程状态
npm run typecheck                    # 每次修改后必须运行
npm run lint                         # 每次修改后必须运行
npm run format                       # 使用项目格式化工具自动格式化
npm run format:check                 # 检查格式但不写入文件
```

仓库开发命令默认使用当前检出目录的本地状态。在此检出目录中，`PASEO_HOME` 解析为 `.dev/paseo-home`，`npm run cli -- ...` 也会自动连接该开发目录。已打包桌面应用和生产风格守护进程继续使用 `~/.paseo` 和端口 `6767`。

完整设置、构建同步要求和调试说明见 [docs/development.md](docs/development.md)。

## 关键规则

- **未经用户允许，严禁重启端口 `6767` 上的 Paseo 主守护进程。** 它负责管理所有运行中的智能体；如果当前执行者也是智能体，重启会杀死自身进程。
- **严禁因为一次超时就认定服务需要重启。** 超时可能只是瞬时问题。
- **严禁在测试中新增认证检查。** 认证由各智能体提供方自行处理。
- **修改应用路由、启动路由、工作区恢复记忆或活动工作区选择前，必须阅读 [docs/expo-router.md](docs/expo-router.md)。**
- **严禁在本地运行完整测试套件。** 测试规模很大，尤其在多个智能体并行运行时可能冻结机器：
  - 只运行实际修改的具体测试文件：`npx vitest run <file> --bail=1`
  - 除非用户明确要求，否则不得对整个 workspace 执行 `npm run test`。
  - 如果确实需要运行较大范围测试，应把输出重定向到文件，再单独读取结果。
  - 其他智能体已报告通过的测试不得无意义重复执行，应信任其结果。
  - 完整测试应推送到 CI，并查看 GitHub Actions 结果。
- **每次修改后始终运行类型检查和 Lint。**
- **排查跨包类型错误前，先构建对应 workspace 包。** 本仓库会消费其他 workspace 生成的声明文件，声明过期时不能通过局部补类型掩盖问题：
  - `npm run build:client` — 重建协议和客户端声明。
  - `npm run build:server` — 当服务端或 CLI 类型可能过期时，重建 highlight、relay、protocol、client、server 和 CLI。
  - 不得为了压制过期声明错误而给推断回调参数补临时类型，也不得复制本地类型定义。
- **提交前运行 `npm run format`。** 项目使用统一格式化工具，禁止手工调整格式来绕过格式检查。
- **Lint 和格式化始终通过 npm 脚本执行。** 不得直接运行 `npx eslint`、`npx oxfmt`、`npx oxlint` 或包内二进制文件。需要定向检查时，把文件路径传给 npm 脚本：
  - `npm run lint -- packages/app/src/components/message.tsx`
  - `npm run format:files -- CLAUDE.md packages/app/src/components/message.tsx`
- **协议必须保持向后兼容，但单个新功能不必降级兼容。** 两者是不同契约：
  - **协议契约（始终适用）：** Schema 修改不能破坏任一方向的解析。旧客户端必须能解析新守护进程消息，新守护进程也必须接受旧客户端请求。
    - 新字段必须使用 `.optional()`，并提供合理的业务默认行为。
    - 禁止把可选字段改为必填、删除字段或收窄类型，例如 `string` 改为 `enum`、`nullable` 改为不可空。
    - 已移除字段仍需允许解析，只停止发送，不能停止接收。
    - 测试时必须问：“六个月前的客户端还能解析吗？”以及“六个月前的守护进程发出的内容，新客户端还能接受吗？”
    - 线上协议 Schema 只能包含纯结构声明。禁止在 WebSocket 消息 Schema 中使用 `.transform()`、`.catch()` 或 `.preprocess()`；标准化逻辑放在显式的校验后处理阶段。
    - 当所有联合分支都有共同的字面量标签时，禁止使用普通 `z.union()`，应使用 `z.discriminatedUnion()`；只有生成代码回归测试证明特定结构编译错误时才允许例外。
    - `.default()` 只允许用于基础类型叶子节点，禁止给大型数组元素 Schema 或大型入站容器设置默认值。
  - **功能契约（按功能判断）：** 新功能可以要求新的守护进程能力。客户端只需要检测能力是否存在；存在就运行，不存在就提示“请更新主机后使用”。
    - **禁止降级路径。** 不要为了兼容旧守护进程实现一个残缺版本，也不要并发调用多个旧 RPC 模拟缺失能力。用户要么升级，要么暂时无法使用该功能。
    - **禁止把防御分支散落在整个功能中。** 能力检测集中在一个位置，下游只读取干净的数据结构。
    - 能力标记统一放在 `server_info.features.*`，并在唯一清理位置添加 `// COMPAT(featureName): added in v0.1.X, drop the gate when floor >= v0.1.X` 注释。
    - 已有功能依靠协议契约继续跨版本工作，新功能不以降级体验为目标。
    - **新 RPC 使用带方向后缀的点分命名空间。** 按 [docs/rpc-namespacing.md](docs/rpc-namespacing.md) 规定，让 `domain.provider.operation.request` 与 `domain.provider.operation.response` 配对。旧的扁平 RPC 会逐步迁移，但不得新增扁平 RPC。
- **所有向后兼容适配都必须标记日期和清理时间。** 每个旧客户端/旧守护进程兼容层都要带 `COMPAT(name)` 注释、加入版本和预计删除日期（通常为六个月后）。执行 `rg "COMPAT\("` 必须能得到完整清理列表。禁止把兼容逻辑藏在无标记的空值回退或可选链中。

## 平台门控

应用运行于 iOS、Android、网页浏览器和 Electron 桌面端网页环境。默认代码应跨平台，只在确有必要时增加门控。统一从 `@/constants/platform` 导入平台判断。

### 四种标准门控

| 门控                       | 类型     | 使用场景                                                                                            |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `isWeb`                    | 常量     | DOM API，例如 `document`、`window`、`<div>`、`addEventListener`、`ResizeObserver`；这是例外而非常态 |
| `isNative`                 | 常量     | 原生专用 API，例如触觉反馈、`StatusBar.currentHeight`、推送令牌、相机/扫描器、`expo-av`             |
| `getIsElectron()`          | 缓存函数 | 桌面外壳能力，例如文件对话框、标题栏拖拽区、守护进程管理、应用更新和 Dock 徽标                      |
| `useIsCompactFormFactor()` | Hook     | 布局决策，例如侧边栏覆盖或固定、弹窗或全屏、单面板或分栏；来源为 `@/constants/layout`               |

### 决策表

| 需求                                                          | 使用方式                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 访问 DOM（`document`、`window`、`<div>`、`addEventListener`） | `if (isWeb)`                                                              |
| 使用原生专用 API（触觉反馈、推送令牌、相机）                  | `if (isNative)`                                                           |
| 使用 Electron 桥接（文件对话框、标题栏、更新）                | `if (getIsElectron())`                                                    |
| 在手机与平板/桌面之间切换布局                                 | `useIsCompactFormFactor()`                                                |
| 网页悬停显示、原生端始终显示                                  | `isHovered \|\| isNative \|\| isCompact`                                  |
| 只门控 iOS 或 Android                                         | `Platform.OS === "ios"` / `Platform.OS === "android"`，少量使用并保持内联 |

### 规则

- **默认跨平台。** 没有明确原因时不要增加门控。
- **大型平台差异优先使用 Metro 文件扩展名，而不是运行时 `if`。** 当模块在不同平台上的实现本质不同，使用 `.web.ts` / `.native.ts`，Metro 会在构建时选择正确文件，不会打包无关平台代码。`if (isWeb)` 只用于少量内联判断；如果出现大型 `if (isWeb) { ... } else { ... }`，应拆分文件。

  ```text
  hooks/
    use-audio-recorder.web.ts    ← 使用 Web Audio API
    use-audio-recorder.native.ts ← 使用 expo-audio
  ```

  统一导入 `@/hooks/use-audio-recorder`，由 Metro 自动选择实现。

- **Electron 专用网页模块使用 `.electron.ts` / `.electron.tsx`。** Electron 仍属于 Metro 的 `web` 平台，但桌面开发和构建会设置 `PASEO_WEB_PLATFORM=electron`，因此 Metro 会优先查找 `.electron.*`，再回退到普通 `.web.*`。依赖 Electron 专用行为时使用此结构，例如 `webviewTag`、桌面 preload API 或 Electron 桥接。普通浏览器实现留在 `.web.*`，原生回退放在基础文件或 `.native.*`。

  ```text
  components/
    browser-pane.electron.tsx ← Electron `<webview>` 实现
    browser-pane.web.tsx      ← 普通网页回退
    browser-pane.tsx          ← 原生回退
  ```

  统一导入 `@/components/browser-pane`，Electron、浏览器和原生端会分别获得正确实现。

- **严禁在没有 `isWeb` 门控时使用原始 DOM API。** DOM API 会导致原生端崩溃。把 React Native 引用强制转换成 `HTMLElement` 是危险信号，必须确认整个代码块只在网页端执行。
- **严禁使用 `onPointerEnter` / `onPointerLeave`。** 它们不会在原生 iOS 上触发。
- **悬停只在网页端有效。** React Native `Pressable` 的 `onHoverIn` / `onHoverOut` 在原生 iOS/iPad 上不会触发。对于悬停显示的菜单或操作按钮，应使用 `isHovered || isNative || isCompact`，确保原生端始终可见。
- **禁止用 `Platform.OS` 代替布局能力判断。** 布局决策使用断点，不使用平台判断。
- **统一从 `@/constants/platform` 导入 `isWeb` / `isNative`。** 禁止局部编写 `const isWeb = Platform.OS === "web"`。

## 调试

完整守护进程日志和跟踪信息位于 `$PASEO_HOME/daemon.log`。
