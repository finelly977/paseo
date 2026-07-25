# 二开功能清单

本文只记录当前相对原作者已发布版本仍然有效的二开功能，是功能审计和上游同步时的唯一差异清单。

本文不是更新日志：功能发生变化时直接改写原条目，功能被移除或已被上游完全吸收时删除对应条目，不保留失效历史。

## 当前有效功能

### 1. 关闭智能体标签仅影响当前客户端布局

- 关闭根智能体或子智能体标签时，只隐藏当前客户端中的标签，不归档智能体，也不改变全局会话生命周期。
- 批量关闭中的智能体标签同样只影响布局；关闭终端仍会停止对应终端进程。
- 用户可以从历史记录、智能体列表或子智能体轨道重新打开会话。
- 重新进入一个没有已打开对话标签的工作区时，自动打开最近活跃且未归档的根智能体，避免出现必须重新导入才能查看会话的情况。
- 显式“归档”操作仍然保留，并与关闭标签严格分离。

主要涉及：

- `packages/app/src/screens/workspace/workspace-screen.tsx`
- `packages/app/src/screens/workspace/workspace-bulk-close.ts`
- `packages/app/src/subagents/close-tab-policy.ts`
- `packages/app/src/stores/navigation-active-workspace-store/`

### 2. 会话导入支持完整历史、搜索和目录分组

- 导入页面请求智能体 CLI 可提供的全部会话，不使用仅显示最近固定数量会话的前端限制。
- Codex 会分别遍历活动会话和已归档会话的全部分页并合并去重，直到取完会话或满足显式限制；这样在 Paseo 中归档后又在 Codex App 中继续产生内容的会话仍可重新导入。Claude、OpenCode、Pi、OMP 和 ACP 导入路径不再由导入界面强制截断。
- 支持按智能体类型、会话标题、消息预览和工作目录搜索。
- 提供按完整工作目录路径筛选的下拉框，不用文件夹名称作为唯一身份；路径相同但名称相同的不同目录不会混淆。
- 会话按工作目录分组并显示目录信息，便于在大量历史会话中定位目标。
- 已导入会话仍会被识别并从可导入列表中过滤；Codex 使用“提供方 + 原生会话 ID”作为唯一身份，在导入候选、并发导入、历史记录匹配和客户端会话聚合中防止同一会话重复出现。

主要涉及：

- `packages/app/src/components/import-session-sheet.tsx`
- `packages/app/src/components/import-session-sheet-view-model.ts`
- `packages/server/src/server/agent/import-sessions.ts`
- 各智能体提供方的会话描述与导入实现

### 3. 导入后保留智能体 CLI 的原生会话名称

- 导入时优先使用智能体 CLI 返回的原生会话名称；CLI 没有名称时使用首条用户消息，不再默认退回 Git 分支名。
- 原生名称会同时写入新建工作区和智能体记录；导入到已有工作区时不擅自覆盖已有工作区名称。
- Claude 从会话文件中读取最新一次自定义名称，而不是只读取首条消息。
- 刷新导入列表时会安全修复旧导入记录：仅纠正空标题或旧自动标题，保留用户手动修改的名称。
- 只有工作区唯一的根智能体可以修复工作区名称，子智能体和多根智能体工作区不会互相覆盖名称。

主要涉及：

- `packages/app/src/components/import-session-sheet.tsx`
- `packages/client/src/daemon-client.ts`
- `packages/protocol/src/messages.ts`
- `packages/server/src/server/agent/import-sessions.ts`
- `packages/server/src/server/agent/providers/claude/agent.ts`
- `packages/server/src/server/session.ts`

### 4. Codex 与 Claude 使用不同的原生会话回退策略

- Codex 直接在当前线程中原地回退对话，不创建新的线程副本；Codex 的对话回退不会撤销已经写入磁盘的文件修改。
- Claude 使用原生分支能力创建回退后的新会话，并把回退前的原会话标记为已归档，避免原分支继续出现在正常导入列表中。
- Claude 的“同时回退对话和文件”仍先执行文件检查点回退，再切换到新的会话分支。

主要涉及：

- `packages/server/src/server/agent/providers/codex/rewind.ts`
- `packages/server/src/server/agent/providers/codex-app-server-agent.ts`
- `packages/server/src/server/agent/providers/claude/rewind.ts`
- `packages/server/src/server/agent/providers/claude/agent.ts`

### 5. 对话 Markdown 使用更紧凑的排版密度

- 缩小连续助手内容块、普通段落、标题和分隔线之间的垂直间距。
- 在设置的“外观 → 间距”中可调整消息段落间距，范围为 0–32 像素，默认 8 像素；助手 Markdown 分块渲染和网页历史虚拟化估算使用同一设置，且不会重复叠加段落内部与消息块外部间距。
- 超过 12 行或 1200 个字符的用户消息默认只展示 8 行，用户可以展开或收起；复制消息仍复制完整原文。
- 保留内容层级和可读性，但减少长对话中大面积无效留白。

主要涉及：

- `packages/app/src/agent-stream/spacing.ts`
- `packages/app/src/styles/markdown-styles.ts`
- `packages/app/src/hooks/use-settings/storage.ts`
- `packages/app/src/screens/settings/appearance/appearance-section.tsx`
- `packages/app/src/components/message.tsx`
- `packages/app/src/components/user-message-collapse.ts`
- `packages/app/src/agent-stream/web-virtualization.ts`

### 6. 对话历史索引与消息跳转

- 桌面网页端在整个对话视口的最左侧显示历史索引刻度，不随居中的消息文字区域移动；每个刻度对应一轮用户消息。
- 悬停或聚焦刻度时显示用户消息标题和助手回复摘要，点击后跳转到对应消息；长历史最多显示 60 个刻度，首尾保留并均匀采样。
- 虚拟化历史使用虚拟列表定位，已挂载消息使用 DOM 滚动定位，不一次性额外渲染全部历史内容。

主要涉及：

- `packages/app/src/agent-stream/history-index-model.ts`
- `packages/app/src/agent-stream/history-index.web.tsx`
- `packages/app/src/agent-stream/strategy-web.tsx`
- `packages/app/src/agent-stream/view.tsx`

### 7. 窗口焦点感知与智能体完成通知可靠性

- 心跳同时上报应用可见状态和窗口焦点状态；浏览器页面可见但窗口失焦时，不再把用户误判为正在查看当前智能体。
- 窗口获得或失去焦点时立即同步心跳，避免活动心跳节流造成通知决策滞后。
- 心跳同时上报当前客户端是否具备本地桌面通知通道；活动时间过期后，仍可由已连接且具备本地通知能力的桌面客户端接收通知，不会误走没有令牌的推送路径。
- 系统通知发送会等待客户端发送调用的结果；失败或系统拒绝时记录错误，并且只有真实发送成功才记录去重时间，后续事件仍可重试。
- 旧客户端不发送焦点字段时，守护进程在兼容期限内按原可见状态处理。

主要涉及：

- `packages/app/src/hooks/use-client-activity.ts`
- `packages/app/src/contexts/session-context.tsx`
- `packages/protocol/src/messages.ts`
- `packages/server/src/server/agent-attention-policy.ts`
- `packages/server/src/server/session.ts`
- `packages/server/src/server/websocket-server.ts`

### 8. Windows PowerShell 工作区打开方式

- 桌面端“打开方式”菜单在 Windows 上检测 Windows PowerShell 5.1、PowerShell 7（pwsh）及其常见命令路径。
- 选择 PowerShell 会打开可见的独立控制台，并通过进程工作目录直接定位到当前工作区，避免路径字符串解析导致启动无窗口。
- 非 Windows 平台不显示该目标。

主要涉及：

- `packages/desktop/src/features/editor-targets/targets/powershell.ts`
- `packages/desktop/src/features/editor-targets/runtime.ts`
- `packages/desktop/src/features/editor-targets/target.ts`
- `packages/desktop/src/features/editor-targets/registry.ts`
- `packages/app/src/screens/workspace/workspace-open-in-editor-button.tsx`

### 9. Windows 桌面安装包完整构建与二开更新隔离

- 根目录提供 `npm run build:desktop:win`，固定生成 Windows x64 NSIS 安装包，并强制依次完成桌面界面依赖、Electron 专用 Expo 导出、服务端、CLI 和 Electron 主进程编译，不允许直接把遗留 `dist` 产物装入安装包。
- 构建开始和打包前都会检查根包、全部工作区及 `package-lock.json` 的版本和内部依赖范围；发现不一致时明确列出问题并停止，不在构建过程中自动改写版本。
- 二开桌面安装包只从 `finelly977/paseo` 检查应用更新，不再下载和安装 `getpaseo/paseo` 的原作者版本，避免二开功能被官方安装包覆盖并触发重复重启。

主要涉及：

- `scripts/build-desktop-windows.ps1`
- `scripts/check-workspace-version-consistency.mjs`
- `packages/desktop/electron-builder.yml`

### 10. Codex 内容清理与侧栏会话管理

- Codex 的 Thinking/reasoning 摘要不进入新时间线，客户端也会过滤旧时间线中的同类内容，避免历史导入和实时对话继续显示内部摘要。
- Codex 助手消息末尾供 Codex App 使用的 Git 界面指令不会作为普通正文显示；Markdown 代码块内用于说明的相同文本仍会保留。
- 侧边栏中只有一个根智能体的工作区提供“重新加载”和“移除”操作。重新加载会关闭当前运行实例、复用原生会话句柄并重新读取完整历史，不创建新的 Paseo 会话。
- 移除只删除 Paseo 自己的会话记录以及随之变空的工作区记录，不调用智能体提供方的归档或删除能力，也不修改原始会话文件；原生会话之后仍可从导入页面重新导入。
- 新客户端只会在主机明确声明支持时发送移除请求；旧主机会提示更新，不会尝试调用不存在的接口。

主要涉及：

- `packages/server/src/server/agent/providers/codex-app-server-agent.ts`
- `packages/app/src/types/stream.ts`
- `packages/app/src/utils/codex-visible-message.ts`
- `packages/app/src/utils/aggregate-agents.ts`
- `packages/app/src/components/sidebar-workspace-list.tsx`
- `packages/app/src/components/sidebar/sidebar-workspace-menu.tsx`
- `packages/server/src/server/session.ts`
- `packages/server/src/server/websocket-server.ts`
- `packages/client/src/daemon-client.ts`
- `packages/protocol/src/messages.ts`
