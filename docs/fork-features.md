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
- 对话回退会把目标用户消息的文本和图片一起恢复到输入框；重新发送成功后会再次确认清空输入内容和附件，避免已发送内容残留。

主要涉及：

- `packages/server/src/server/agent/providers/codex/rewind.ts`
- `packages/server/src/server/agent/providers/codex-app-server-agent.ts`
- `packages/server/src/server/agent/providers/claude/rewind.ts`
- `packages/server/src/server/agent/providers/claude/agent.ts`
- `packages/app/src/components/rewind/`

### 5. 对话 Markdown 使用更紧凑的排版密度

- 缩小连续助手内容块、普通段落、标题和分隔线之间的垂直间距；Markdown 横线固定使用原主题间距的一半，减少分节时的空白带。
- 在设置的“外观 → 间距”中可调整消息段落间距，范围为 0–32 像素，默认 8 像素；助手 Markdown 分块渲染和网页历史虚拟化估算使用同一设置，且不会重复叠加段落内部与消息块外部间距。
- 超过 12 行或 1200 个字符的用户消息默认只展示 8 行，用户可以展开或收起；复制消息仍复制完整原文。
- 助手消息中的本地文件链接优先按可见路径文本解析，Windows 盘符路径的末尾行号会作为编辑器定位信息，不会误并入文件名；外部网址仍按网页链接打开。
- 保留内容层级和可读性，但减少长对话中大面积无效留白。

主要涉及：

- `packages/app/src/agent-stream/spacing.ts`
- `packages/app/src/styles/markdown-styles.ts`
- `packages/app/src/hooks/use-settings/storage.ts`
- `packages/app/src/screens/settings/appearance/appearance-section.tsx`
- `packages/app/src/components/message.tsx`
- `packages/app/src/components/user-message-collapse.ts`
- `packages/app/src/assistant-file-links/`
- `packages/app/src/agent-stream/web-virtualization.ts`

### 6. 对话历史索引与消息跳转

- 桌面网页端在整个对话视口的最左侧垂直居中显示紧凑历史刻度，不随居中的消息文字区域移动；每个刻度对应一轮用户消息。
- 索引独立读取完整对话的轻量标题、助手摘要和时间线位置，不受首次只加载 40 条时间线的限制，也不会为了显示索引把全部工具记录载入前端内存；新客户端通过能力声明接收完整索引，旧客户端仍接收最近 50 轮，避免旧版协议校验失败。
- 指针经过索引时，邻近刻度按距离形成平滑跟随的波峰并突出最近一项；悬停或聚焦刻度时显示用户消息标题和助手回复摘要，系统要求减少动态效果时停用过渡动画。
- 历史较少时刻度使用固定 8 像素间距紧凑居中，不随会话长度均摊到整条轨道；完整索引超过可用高度时自动压缩刻度间距，但不抽样或丢弃任何一轮。当前所在刻度通过颜色和波峰长度区分，不靠加高刻度。
- 点击刻度跳转后立即收起悬停浮层并释放焦点，指针停在索引上也不会保持展开状态。
- 点击尚未加载的较早对话时按 40 条一页加载到目标位置后跳转，已加载消息直接定位。
- 长距离跳转会持续校正虚拟列表估算误差，直到目标消息真正位于视口中央，一次点击即可跨越较大的历史跨度。
- 上滑加载旧历史时，加载指示器不占用消息布局；虚拟行在提交阶段同步测量，已收起的中间过程从首帧就按隐藏内容或收起入口的实际高度估算，不再先按完整内容绘制后逐行缩短。分页从一轮对话中间开始时暂不收起该轮，直到用户消息边界加载完成，避免同一轮随着多次分页反复改变高度；重新测量只补偿视口上方的高度变化。

主要涉及：

- `packages/app/src/agent-stream/history-index-model.ts`
- `packages/app/src/agent-stream/history-index.web.tsx`
- `packages/app/src/agent-stream/strategy-web.tsx`
- `packages/app/src/agent-stream/view.tsx`
- `packages/app/src/agent-stream/web-virtualization.ts`
- `packages/server/src/server/agent/agent-conversation-index.ts`
- `packages/protocol/src/client-capabilities.ts`
- `packages/protocol/src/messages.ts`

### 7. 窗口焦点感知与智能体完成通知可靠性

- 心跳同时上报应用可见状态和窗口焦点状态；浏览器页面可见但窗口失焦时，不再把用户误判为正在查看当前智能体。
- 窗口获得或失去焦点时立即同步心跳，避免活动心跳节流造成通知决策滞后。
- 心跳同时上报当前客户端是否具备本地桌面通知通道；活动时间过期后，仍可由已连接且具备本地通知能力的桌面客户端接收通知，不会误走没有令牌的推送路径。
- 系统通知发送会等待客户端发送调用的结果；失败或系统拒绝时记录错误，并且只有真实发送成功才记录去重时间，后续事件仍可重试。
- Windows 桌面端点击系统通知时会先恢复最小化状态再显示和聚焦窗口；如果通知前窗口处于最大化状态，返回应用后仍保持最大化。
- 智能体回合最终失败并停止后也发送系统通知；提供方仍在自动重试时只记录过程错误，不会提前通知失败。
- 旧客户端不发送焦点字段时，守护进程在兼容期限内按原可见状态处理。

主要涉及：

- `packages/app/src/hooks/use-client-activity.ts`
- `packages/app/src/contexts/session-context.tsx`
- `packages/protocol/src/messages.ts`
- `packages/server/src/server/agent-attention-policy.ts`
- `packages/server/src/server/session.ts`
- `packages/server/src/server/websocket-server.ts`
- `packages/desktop/src/features/notifications.ts`
- `packages/desktop/src/features/notification-window.ts`

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

### 10. Codex 内容清理、权限模式与侧栏会话管理

- Codex 的 Thinking/reasoning 摘要不进入新时间线，客户端也会过滤旧时间线中的同类内容，避免历史导入和实时对话继续显示内部摘要。
- Codex 助手消息末尾供 Codex App 使用的 Git 界面指令不会作为普通正文显示；Markdown 代码块内用于说明的相同文本仍会保留。
- Codex 查看图片产生的纯图片工具结果默认折叠为紧凑入口，用户可以按需展开或再次收起；用户消息附件以及包含正文的普通助手图片不受影响。
- Codex 手动压缩上下文时会可靠地把“压缩中”更新为“已完成”；此前没有配对项目的旧完成通知不会误吞下一次压缩的完成事件，压缩完成后不再持续显示加载动画。
- 重新进入 Codex 老会话时，用户消息中的图片包装路径不会再显示成正文；图片会作为结构化历史附件按需恢复，并可在回退后重新发送。
- Codex 权限选择器支持“自定义 (config.toml)”模式，实际读取并应用用户配置中的审批策略、审批人、沙盒类型、额外可写目录和工作区网络权限；配置结构非法时明确报错，不会静默退回默认权限。
- 侧边栏中只有一个根智能体的工作区提供“重新加载”和“移除”操作。重新加载会关闭当前运行实例、复用原生会话句柄并重新读取完整历史，不创建新的 Paseo 会话。
- 移除只删除 Paseo 自己的会话记录以及随之变空的工作区记录，不调用智能体提供方的归档或删除能力，也不修改原始会话文件；原生会话之后仍可从导入页面重新导入。
- 新客户端只会在主机明确声明支持时发送移除请求；旧主机会提示更新，不会尝试调用不存在的接口。
- 侧栏会话名称前显示当前根智能体的提供方图标，Claude、Codex、OpenCode、OMP、Pi、Copilot 和 ACP 提供方复用统一图标解析规则。

主要涉及：

- `packages/server/src/server/agent/providers/codex-app-server-agent.ts`
- `packages/protocol/src/provider-manifest.ts`
- `packages/app/src/agent-stream/provider-image-message.tsx`
- `packages/app/src/agent-stream/provider-image-message-model.ts`
- `packages/app/src/attachments/provider-user-image.ts`
- `packages/app/src/types/stream.ts`
- `packages/app/src/utils/codex-visible-message.ts`
- `packages/app/src/utils/aggregate-agents.ts`
- `packages/app/src/components/sidebar-workspace-list.tsx`
- `packages/app/src/components/sidebar/sidebar-workspace-menu.tsx`
- `packages/server/src/server/session.ts`
- `packages/server/src/server/websocket-server.ts`
- `packages/client/src/daemon-client.ts`
- `packages/protocol/src/messages.ts`

### 11. 成功回合结论优先与旧会话上下文刷新

- 智能体运行期间完整展示思考、工具调用、待办和中间助手消息；回合成功结束后默认收起这些中间过程，只保留模型最后一条助手消息作为最终结论。
- 收起入口位于原过程开始位置，显示本回合隐藏的过程项数量，用户可以展开查看全部过程并再次收起；包含最终错误记录的失败回合保持完整展开，避免隐藏失败原因。
- 恢复持久化旧会话时，在发布可交互状态前主动读取提供方当前上下文用量并与已保存用量合并，不必等待下一次对话才更新输入框旁的上下文进度。
- Claude 使用 Agent SDK 上下文接口，Codex 使用恢复线程上报的最新用量，OpenCode 从原生会话消息读取最近用量，OMP 与 Pi 使用会话统计接口；提供方没有可用快照时保留已保存数据，查询失败会写入错误日志。

主要涉及：

- `packages/app/src/agent-stream/layout.ts`
- `packages/app/src/agent-stream/view.tsx`
- `packages/server/src/server/agent/agent-sdk-types.ts`
- `packages/server/src/server/agent/agent-manager.ts`
- `packages/server/src/server/agent/providers/claude/agent.ts`
- `packages/server/src/server/agent/providers/codex-app-server-agent.ts`
- `packages/server/src/server/agent/providers/opencode-agent.ts`
- `packages/server/src/server/agent/providers/omp/agent.ts`
- `packages/server/src/server/agent/providers/pi/agent.ts`

### 12. Claude Code 后台子代理不会被空闲回收误杀

- 守护进程消费 Claude Agent SDK 的 `background_tasks_changed` 层级信号，按“整集替换”维护当前存活的后台任务集合；该信号是按进程发出的，因此每次 Claude CLI 进程启动或重启都从空集合开始，会话关闭时也清空。
- 空闲运行时回收在原有条件之外，额外要求提供方没有存活的后台工作。Claude 把子代理转入后台后前台回合会立即返回，此前仅凭前台空闲判断会在两分钟后杀掉仍在运行子代理的 CLI 进程，导致子代理进程内状态丢失，并在下次打开会话时出现“Background agent … was running when the previous Claude Code process exited”的失败通知。
- `task_notification` 是单个后台任务的终结边沿，不再据此开启自主回合。Claude 未针对该通知继续作答时，原实现会留下一个永不结束的回合，把智能体钉死在“运行中”而无法继续对话；确实需要继续作答时，其助手消息仍会照常开启自主回合。
- 该能力位为可选接口，未实现的提供方按“没有后台工作”处理，回收行为与原先一致。

主要涉及：

- `packages/server/src/server/agent/agent-sdk-types.ts`
- `packages/server/src/server/agent/agent-manager.ts`
- `packages/server/src/server/agent/providers/claude/agent.ts`

### 13. 设置页面切换与返回不再卡顿

- 桌面守护进程状态查询不再在每次组件挂载时强制重新拉取。该查询会在主进程中启动一个 CLI 子进程，而设置侧栏始终挂载它，此前每次切换竖向标签都要重新启动一次进程，在 Windows 上表现为鼠标指针旁持续数秒的忙碌转圈。查询改为遵循 30 秒过期时间，真正改变守护进程的操作仍显式刷新状态。
- 进入设置页时保留左侧工作区侧栏的挂载状态，但不显示它：可见性只由拥有应用外壳的路由决定，设置页仍然只展示自己的设置侧栏。此前设置路由会整体卸载侧栏，返回对话页时需要重新构建工作区投影；侧栏在隐藏期间保持非活动状态，不执行订阅和动画工作。
- 专注模式和窗口过窄时，侧栏仍按原有规则卸载或隐藏，行为不变。

主要涉及：

- `packages/app/src/desktop/hooks/use-daemon-status.ts`
- `packages/app/src/components/desktop-sidebar-layout.ts`
- `packages/app/src/app/_layout.tsx`

### 14. 侧栏行菜单关闭后不再残留悬停高亮

- 工作区行的三点菜单通过全屏浮层渲染，浮层会遮住整行，行因此收不到指针离开事件；菜单关闭后该行会一直保持悬停高亮，直到用户重新移入再移出。
- 菜单关闭时按指针的真实位置重新判定悬停状态，指针已不在行上时立即清除高亮。
- 该处理只作用于网页端；原生端没有该浮层遮挡问题，行为不变。

主要涉及：

- `packages/app/src/components/sidebar/use-sidebar-row-hover.ts`
- `packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx`
- `packages/app/src/components/sidebar/sidebar-workspace-row.tsx`
- `packages/app/src/components/sidebar/sidebar-workspace-menu.tsx`
- `packages/app/src/components/sidebar/sidebar-status-list.tsx`
- `packages/app/src/components/sidebar-workspace-list.tsx`

### 15. Paseo 创建的 Claude 会话在 Claude CLI 中可见

- Paseo 启动 Claude Agent SDK 时固定使用普通 Claude CLI 来源标记，新建会话、恢复会话以及后续追加内容都会被 Claude CLI 的 `/resume` 选择器识别，不再因 SDK 来源而隐藏。
- 守护进程启动时会遍历 Paseo 已保存的 Claude 原生会话句柄，把现有会话 JSONL 中的 SDK 来源结构化转换为 CLI 来源；转换采用原子写入，读取期间发生变化的文件会拒绝覆盖并写入完整错误日志。
- 迁移只处理 Paseo 持有持久化句柄的 Claude 会话，不扫描或修改其他应用创建的 Claude SDK 会话。

主要涉及：

- `packages/server/src/server/agent/providers/claude/session-entrypoint.ts`
- `packages/server/src/server/agent/providers/claude/agent.ts`
- `packages/server/src/server/agent/providers/claude/query.ts`
- `packages/server/src/server/bootstrap.ts`
