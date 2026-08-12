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

### 5. 对话排版、间距与默认 Dark 主题

- 缩小连续助手内容块、普通段落、标题和分隔线之间的垂直间距；Markdown 横线固定使用原主题间距的一半，横线自身独占上下留白，不再与相邻段落间距叠加；压缩上下文分割线使用更短的上下留白。时间线列表统一负责消息外间距，助手消息和回合尾部不再重复叠加内外两层空白。
- 设置的“外观”页分别提供对话区域与工作区列表的像素级间距控制。对话可独立调整消息、段落、压缩分割线、区域上下边距和区域左右边距；侧栏可独立调整工作区、会话、行内上下留白和列表左右边距。修改立即作用于网页虚拟化列表、原生列表以及项目和状态两种侧栏分组，Markdown 横线由自身样式持有上下留白，压缩分割线由自身设置持有上下留白，均不再与消息外间距重复叠加。
- 超过 12 行或 1200 个字符的用户消息默认只展示 8 行，用户可以展开或收起；复制消息仍复制完整原文。
- 助手消息中的本地文件链接优先按可见路径文本解析，Windows 盘符路径的末尾行号会作为编辑器定位信息，不会误并入文件名；本机桌面会话支持右键在系统文件管理器中定位已解析文件，远端会话和外部网址不显示该操作，外部网址仍按网页链接打开。
- 保留内容层级和可读性，但减少长对话中大面积无效留白。
- 默认 Dark 主题使用中性黑灰层级：应用与工作区背景固定为 `#111111`，主要前景固定为 `#E6E6E6`，侧栏、输入框、浮层、悬停和边框只通过亮度区分，不再带绿色或蓝灰色偏；强调色使用 `#0169CC`，成功、警告、错误等语义状态继续保留独立颜色。Zinc、Midnight、Claude 和 Ghostty 等用户主动选择的暗色变体保持原样。

主要涉及：

- `packages/app/src/agent-stream/spacing.ts`
- `packages/app/src/agent-stream/view.tsx`
- `packages/app/src/styles/markdown-styles.ts`
- `packages/app/src/styles/theme.ts`
- `packages/app/src/hooks/use-settings/storage.ts`
- `packages/app/src/screens/settings/appearance/appearance-section.tsx`
- `packages/app/src/components/message.tsx`
- `packages/app/src/components/sidebar-workspace-list.tsx`
- `packages/app/src/components/sidebar/`
- `packages/app/src/components/user-message-collapse.ts`
- `packages/app/src/assistant-file-links/`
- `packages/app/src/workspace/open-in-file-manager/`
- `packages/app/src/agent-stream/web-virtualization.ts`

### 6. 对话历史索引与消息跳转

- 桌面网页端在整个对话视口的最左侧垂直居中显示紧凑历史刻度，不随居中的消息文字区域移动；每个刻度对应一轮用户消息。
- 索引独立读取完整对话的轻量标题、助手摘要和时间线位置，不受首次只加载 40 条时间线的限制，也不会为了显示索引把全部工具记录载入前端内存；新客户端通过能力声明接收完整索引，旧客户端仍接收最近 50 轮，避免旧版协议校验失败。
- 指针经过索引时，邻近刻度按与指针的像素距离形成平滑跟随的波峰并突出最近一项；波浪半径只按可见轨道高度计算，轨道内容再多山峰也始终落在可见区域内，不会因半径覆盖整条轨道而消失；悬停或聚焦刻度时显示用户消息标题和助手回复摘要，系统要求减少动态效果时停用过渡动画。
- 历史刻度始终使用固定 8 像素间距紧凑居中，不随会话长度均摊或压缩；索引超过 480 像素最大高度或当前视口可用高度时，在轨道内部滚动且不显示滚动条，不抽样或丢弃任何一轮，并默认展示最新刻度。对话视口位于底部时，模型一开始输出思考或工具调用就立即把最新用户轮次标为当前轮次，不等待助手正文出现；用户主动上滚后改按参考线之前最近的用户消息判断，滚回底部后恢复跟随。当前所在刻度通过颜色和波峰长度区分，不靠加高刻度。
- 点击刻度跳转后立即收起悬停浮层并释放焦点，指针停在索引上也不会保持展开状态。
- 设置页可以配置每次打开老会话加载的最近对话轮数，默认 50 轮；服务端按用户消息边界返回完整轮次，不再把工具调用等时间线记录误算成对话数。应用重启后从本地缓存副本恢复的会话同样按此配置重新权威加载，缓存尾部（仅最后 50 条记录、可能只覆盖一个回合尾部）不会被当作已同步完整历史，也不会用它的陈旧光标走增量路径跳过加载，因此该设置在每次打开会话时都生效。继续向上翻页或点击尚未加载的索引时仍按 40 条投影时间线一页补载到目标位置。
- 设置页可以配置所有已打开会话正文在客户端内存中的对话轮数总上限，默认 500 轮；达到上限后优先保留当前会话，再按最近打开时间从新到旧分配预算，被裁剪的旧会话下次打开时重新按单会话配置加载。轻量完整索引不参与正文内存裁剪，仍显示所有轮次。
- 长距离跳转会持续校正虚拟列表估算误差，直到目标消息真正位于视口中央，一次点击即可跨越较大的历史跨度。
- 上滑加载旧历史时，加载指示器不占用消息布局；虚拟行在提交阶段同步测量，已收起的中间过程从首帧就按隐藏内容或收起入口的实际高度估算，不再先按完整内容绘制后逐行缩短。分页从一轮对话中间开始时，空闲状态下直接收起已加载的过程项，不再等待用户消息边界，避免该轮一直展开、加载更早分页后才突然收起造成撕裂；运行中仍保持展开，重新测量只补偿视口上方的高度变化。

主要涉及：

- `packages/app/src/agent-stream/history-index-model.ts`
- `packages/app/src/agent-stream/history-index.web.tsx`
- `packages/app/src/agent-stream/strategy-web.tsx`
- `packages/app/src/agent-stream/view.tsx`
- `packages/app/src/agent-stream/web-virtualization.ts`
- `packages/app/src/timeline/conversation-history-policy.ts`
- `packages/app/src/hooks/use-settings/storage.ts`
- `packages/app/src/stores/session-store.ts`
- `packages/server/src/server/agent/agent-conversation-index.ts`
- `packages/server/src/server/agent/timeline-projection.ts`
- `packages/protocol/src/client-capabilities.ts`
- `packages/protocol/src/messages.ts`

### 7. 窗口焦点感知与智能体完成通知可靠性

- 心跳同时上报应用可见状态和窗口焦点状态；浏览器页面可见但窗口失焦时，不再把用户误判为正在查看当前智能体。
- 窗口获得或失去焦点时立即同步心跳，避免活动心跳节流造成通知决策滞后。
- 心跳同时上报当前客户端是否具备本地桌面通知通道；活动时间过期后，仍可由已连接且具备本地通知能力的桌面客户端接收通知，不会误走没有令牌的推送路径。
- 系统通知发送会等待客户端发送调用的结果；失败或系统拒绝时记录错误，并且只有真实发送成功才记录去重时间，后续事件仍可重试。
- Windows 桌面端点击系统通知时会先恢复最小化状态再显示和聚焦窗口；如果通知前窗口处于最大化状态，返回应用后仍保持最大化。
- 智能体回合最终失败并停止后也发送系统通知；提供方仍在自动重试时只记录过程错误，不会提前通知失败。
- 时间线订阅不随应用可见性关闭：切到其他应用或窗口隐藏期间，agent 事件仍持续推送到本地存储，返回聚焦时新增对话内容立即可见，无需重新订阅和拉取时间线；Electron 主窗口禁用后台定时器节流，失焦时流式事件与同步逻辑保持实时。
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
- Electron 主进程编译显式关闭 TypeScript 增量缓存；否则打包脚本删除 `dist` 后，残留的 `tsconfig.tsbuildinfo` 会让 tsc 跳过 emit 以成功状态退出，asar 中缺失入口文件导致安装包构建失败。
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
- Codex 因所选模型容量已满而结束回合时不会立即按失败结束：已经产生有效答复时自动追加“继续”，只有容量提示而没有有效答复时原地回退最新原生回合并重发原用户消息。自动恢复期间不显示容量提示、不重复显示重发的用户消息，也不会触发失败通知；只有自动恢复自身失败后才按真实错误结束。
- 重新进入 Codex 老会话时，用户消息中的图片包装路径不会再显示成正文；图片会作为结构化历史附件按需恢复，并可在回退后重新发送。
- Codex 权限选择器支持“自定义 (config.toml)”模式，实际读取并应用用户配置中的审批策略、审批人、沙盒类型、额外可写目录和工作区网络权限；配置结构非法时明确报错，不会静默退回默认权限。
- 侧边栏中只有一个根智能体的工作区提供“重新加载”“释放运行时”和“移除”操作。重新加载会关闭当前运行实例、复用原生会话句柄并重新读取完整历史，不创建新的 Paseo 会话。
- 释放运行时会在确认后只关闭目标会话的智能体运行实例及其拥有的子进程，保留 Paseo 会话、对话记录、错误信息、工作区与原生会话句柄；不会归档或移除会话，不会级联关闭其他 Paseo 会话，之后继续对话时恢复同一原生会话。错误中断的会话不会因此被自动释放，仍由用户自行决定何时释放。
- 移除只删除 Paseo 自己的会话记录以及随之变空的工作区记录，不调用智能体提供方的归档或删除能力，也不修改原始会话文件；原生会话之后仍可从导入页面重新导入。
- 新客户端只会在主机明确声明支持时发送释放或移除请求；旧主机会提示更新，不会尝试调用不存在的接口。
- 侧栏会话名称前显示当前根智能体的提供方图标，Claude、Codex、OpenCode、OMP、Pi、Copilot 和 ACP 提供方复用统一图标解析规则。

主要涉及：

- `packages/server/src/server/agent/providers/codex-app-server-agent.ts`
- `packages/server/src/server/agent/providers/codex/capacity-retry.ts`
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

- 智能体运行期间完整展示思考、工具调用、待办和中间助手消息；回合成功结束后默认收起这些中间过程，只保留模型最后一条助手消息作为最终结论。回合完成事件到达时，客户端无条件把状态归位为空闲（即使本地状态因状态推送丢失而陈旧），确保“完成后收起”不被本地陈旧状态卡住。
- 收起入口位于原过程开始位置，显示本回合隐藏的过程项数量，用户可以展开查看全部过程并再次收起；包含最终错误记录的失败回合保持完整展开，避免隐藏失败原因。分页加载从回合中间开始时（该回合的助手消息或用户消息还在更早的未加载历史里），空闲状态下把已加载的过程项按收起入口处理，直接收起而不再等边界加载；时间线末尾最后一个回合同样适用，打开旧对话时即使初始窗口只覆盖回合尾部也会立即收起，无需先向上滚动加载更早分页；运行中仍保持展开。
- Codex 单次补丁修改多个文件时，实时事件和历史恢复都保留完整文件路径列表；工具调用汇总按全部路径去重计数，折叠行展示所有路径，展开详情列出每个文件，不再只显示补丁中的第一个文件。
- 长对话中的助手消息共用同一套 Markdown 解析器，减少重复初始化和常驻对象，同时保持文件链接校验与自动识别规则不变。
- 恢复持久化旧会话时，在发布可交互状态前主动读取提供方当前上下文用量并与已保存用量合并，不必等待下一次对话才更新输入框旁的上下文进度；圆形进度固定从十二点方向开始顺时针绘制，输入框的发送和停止主操作使用更紧凑的 24 像素按钮。
- Claude 使用 Agent SDK 上下文接口，Codex 使用恢复线程上报的最新用量，OpenCode 从原生会话消息读取最近用量，OMP 与 Pi 使用会话统计接口；提供方没有可用快照时保留已保存数据，查询失败会写入错误日志。

主要涉及：

- `packages/app/src/agent-stream/layout.ts`
- `packages/app/src/agent-stream/view.tsx`
- `packages/app/src/components/tool-call-details.tsx`
- `packages/app/src/components/message.tsx`
- `packages/app/src/tool-calls/detail-level/overview/model.ts`
- `packages/protocol/src/agent-types.ts`
- `packages/protocol/src/tool-call-display.ts`
- `packages/server/src/server/agent/agent-sdk-types.ts`
- `packages/server/src/server/agent/agent-manager.ts`
- `packages/server/src/server/agent/providers/claude/agent.ts`
- `packages/server/src/server/agent/providers/codex-app-server-agent.ts`
- `packages/server/src/server/agent/providers/codex/tool-call-mapper.ts`
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

### 13. 设置页面切换与常驻界面渲染不再卡顿

- 桌面守护进程状态查询不再在每次组件挂载时强制重新拉取。该查询会在主进程中启动一个 CLI 子进程，而设置侧栏始终挂载它，此前每次切换竖向标签都要重新启动一次进程，在 Windows 上表现为鼠标指针旁持续数秒的忙碌转圈。查询改为遵循 30 秒过期时间，真正改变守护进程的操作仍显式刷新状态。
- 进入设置页时保留左侧工作区侧栏的挂载状态，但不显示它：可见性只由拥有应用外壳的路由决定，设置页仍然只展示自己的设置侧栏。此前设置路由会整体卸载侧栏，返回对话页时需要重新构建工作区投影；侧栏在隐藏期间保持非活动状态，不执行订阅和动画工作。
- 专注模式和窗口过窄时，侧栏仍按原有规则卸载或隐藏，行为不变。
- 左侧栏、会话列表、智能体输入控件、分栏容器、全局提示接口和终端控制逻辑不再直接订阅整套 Unistyles 主题。普通背景、边框和文字继续由主题样式代理原生更新；图标、下拉刷新和终端配色由小型 `withUnistyles` 叶子独立更新。切换主题、字体、字号和语法配色时视觉结果保持一致，不再连带重跑工作区投影、列表分组、终端流处理、提示接口和输入控件状态。

主要涉及：

- `packages/app/src/desktop/hooks/use-daemon-status.ts`
- `packages/app/src/components/desktop-sidebar-layout.ts`
- `packages/app/src/app/_layout.tsx`
- `packages/app/src/components/agent-list.tsx`
- `packages/app/src/components/agent-status-dot.tsx`
- `packages/app/src/components/left-sidebar.tsx`
- `packages/app/src/components/split-container.tsx`
- `packages/app/src/components/terminal-pane.tsx`
- `packages/app/src/components/toast-host.tsx`
- `packages/app/src/composer/agent-controls/control.tsx`
- `packages/app/src/composer/agent-controls/index.tsx`
- `packages/app/src/composer/agent-controls/mode-control.tsx`

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

### 16. 右侧 Git 面板采用 VS Code 式源代码管理工作流

- 右侧 Git 面板按“存储库、源代码管理、图表”组织信息，桌面端的视图标题、资源组、文件和提交行统一使用 22 像素密度；移动端文件行保留 34 像素触控高度；源代码管理标题栏的刷新加载指示器固定为 12 像素。存储库行集中展示仓库、当前分支和常用操作，低频 Git、合并、拉取请求与归档操作进入同一操作菜单。
- 守护进程通过一次零终止的 Git 状态读取，准确区分冲突、暂存区、工作区、未跟踪、重命名和复制文件；工作区状态订阅直接持有文件系统观察器，即使没有打开差异正文，也会在文件变化后重新读取并实时推送完整分组明细。同一目录存在已归档历史工作区时，只从仍有效的工作区中注册观察器，旧记录不会阻断监听。连续文件事件按固定 1 秒窗口合并，避免 Windows 递归监听在开发目录持续产生事件时无限推迟刷新。客户端统一规范 Windows 斜杠和尾部斜杠，状态推送会命中当前工作区的更改列表并同时使提交图表重新读取，外部修改或智能体提交后无需手动刷新。
- 文件资源行使用 Material 文件图标、文件名、灰色目录和行末 Git 状态字母；桌面端悬停时，状态字母在固定宽度的尾部区域让位给始终挂载的操作图标，鼠标移入图标后不会消失，移动端始终显示操作。资源组和文件行都支持暂存、取消暂存，工作区文件还支持放弃更改；右键或长按菜单提供相同操作。放弃更改前必须确认，已跟踪文件恢复工作区内容，未跟踪文件从磁盘删除。
- 大型更改列表使用虚拟化渲染，初始只挂载视口附近的组头和文件行，同时保留分组折叠、全部文件操作、右键菜单和移动端长按菜单；提交图谱扫描仓库引用时同步读取当前分支的上游引用，减少每次刷新启动的 Git 进程，不使用可能导致提交后数据陈旧的结果缓存。
- 文件点击后在工作区正文标签中打开并定位完整差异，右侧栏只保留紧凑资源列表，不再在狭窄侧栏内展开差异正文；本机桌面会话的文件三点菜单支持在系统文件管理器中定位对应文件。正文差异仍保留统一/分栏、隐藏空白、折叠文件和内联审阅能力。
- 提交说明输入支持多行自适应高度，`Ctrl/Cmd + Enter` 提交，`Alt + ↑/↓` 浏览本次面板会话的提交说明历史；Web 端只显示单层 VS Code 式焦点边框，输入高度不会被浏览器默认多行尺寸撑大，Dark 主题占位文字保持清晰可读。输入框右侧可调用独立配置的内部智能体读取当前完整未提交差异并生成结构化提交说明，生成期间显示紧凑加载状态，失败时保留原输入并在原位显示错误；任务完成、失败或连接断开后，Claude、Codex、OpenCode、Pi、Grok 清除 Paseo 临时记录并按各自原生能力删除或归档临时会话，其他 Provider 归档临时会话。提交按钮采用 VS Code 式分裂按钮：有暂存文件时主按钮只提交暂存区，没有暂存文件时主按钮提交全部更改；下拉菜单始终明确提供“提交暂存区”和“提交全部更改”，主按钮与下拉段共享一致的悬停、展开和禁用层级。提交成功后只同步刷新本地 Git 快照，立即清空说明并恢复操作；代码托管平台状态、提交图表和其他查询继续在后台刷新，刷新失败会记录完整错误，不会把已经成功的提交误报为失败。提交失败时保留说明并显示错误。
- 工作区干净时，提交主按钮继续按仓库状态切换为同步更改或发布分支；同步显示落后与领先计数。Fetch、Refresh、Pull、Push、Sync 都执行真实 Git 操作并显示进行中、成功或失败状态，新写操作不会用旧接口拼接残缺降级路径。
- 提交图表默认展开为 520 像素高度，可拖动顶部分隔线在 140 至 720 像素及当前视口 70% 范围内调整，拖动结束后持久记忆用户高度；收起图表时只保留 22 像素标题行。标题和提交行统一为 22 像素，提交正文使用与上方更改列表一致的 13 像素字号，每行只为自身实际泳道保留图谱宽度；主行中的提交说明优先向右省略，分支、远端和标签引用徽标保持可见。悬停详情按 VS Code 的紧凑 Markdown 节奏展示作者与时间、完整说明、文件增删统计、引用和提交操作，段落与分隔线使用 4 像素间距，引用标签保持约 18 像素高度，当前分支与本地分支图标统一为 10 像素，并支持复制完整提交标识和打开对应托管平台提交页面。
- 守护进程按 Git 拓扑顺序返回每个提交的全部父提交、结构化本地分支、远端分支和标签。客户端移植 VS Code 的输入泳道与输出泳道模型，真实绘制线性历史、分叉、合并、多父提交、泳道移动和当前提交双圆标记；当前分支、上游分支、基础分支与其他泳道使用稳定的语义色。
- 图表工具栏支持“自动、全部、指定一个或多个引用”三种历史范围，可定位当前提交，并直接提供获取、拉取、推送和刷新图标；同步操作保留在更多菜单中。自动范围包含当前分支、上游分支和基础分支。引用菜单直接展示本地分支、远端分支和标签，不再由客户端根据字符串猜测类型。
- 点击提交主行直接展开或收起文件子行，同时保持选择背景；行末箭头提供相同的显式展开入口。桌面端悬停或选中时显示打开完整差异的行内操作，移动端始终显示。提交右键或长按菜单可启动独立配置的内部智能体审查该提交；审查过程在应用工作面右下角的浮动窗口中实时展示完整工具调用和最终回复，默认尺寸约为 560×520 像素，支持拖动、四角缩放、收起、展开和关闭，不受 Git 侧栏宽度限制。关闭运行中窗口或连接断开时会先停止并只清理本次临时智能体，清理失败则保留窗口并显示错误。启动另一提交的审查前会先清理当前审查；临时智能体不进入普通会话列表。权限响应由守护进程统一发送明确的结束事件；提供方未主动发送时由守护进程在状态刷新后补齐，批准按钮和权限卡片不会因缺少提供方事件而持续等待。展开后的文件沿用图谱泳道占位、Material 文件图标、灰色目录和状态字母，点击文件会打开该提交的完整差异并定位到对应文件。提交历史每页加载 40 条，滚动到底继续加载。
- 暂存、取消暂存和放弃更改使用带方向后缀的点分 RPC，并通过主机能力集中门控；旧主机收到明确的更新提示，不尝试以旧差异接口模拟写操作。协议新增字段保持可选，旧客户端和旧守护进程仍能互相解析消息。
- 面板复用现有跨平台组件、主题语义色和文件图标体系，桌面、网页和移动端保持同一操作语义；主机智能体设置分别配置提交说明生成与提交审查所用的智能体、模型、该智能体原生提供的权限选项、思考强度和完整可编辑的任务提示词，两项任务互不覆盖；服务端只注入目标提交标识，不再在用户提示词前隐藏追加审查规则。选择 OpenCode 时还可独立开启自动批准，启动临时智能体时通过 OpenCode 原生 `auto_accept` 功能值生效，不覆盖已选的 `Build`、`Plan` 或自定义模式；切换到其他智能体时不会传递该功能值。空白提示词按任务恢复为预置内容；所有新增界面文案在全部语言资源中保持同构。

主要涉及：

- `packages/app/src/git/source-control-panel.tsx`
- `packages/app/src/git/commit-review-pane.tsx`
- `packages/app/src/git/use-git-ai.ts`
- `packages/app/src/git/scm-changes-list.tsx`
- `packages/app/src/git/scm-model.ts`
- `packages/app/src/git/diff-pane.tsx`
- `packages/app/src/git/actions-store.ts`
- `packages/app/src/git/commits-section/`
- `packages/app/src/components/file-actions-menu.tsx`
- `packages/app/src/components/file-explorer-pane.tsx`
- `packages/app/src/screens/settings/git-ai-settings-section.tsx`
- `packages/app/src/workspace/open-in-file-manager/`
- `packages/app/src/hooks/use-changes-preferences/storage.ts`
- `packages/app/src/styles/theme.ts`
- `packages/app/src/panels/diff-panel.tsx`
- `packages/app/src/i18n/resources/`
- `packages/protocol/src/messages.ts`
- `packages/client/src/daemon-client.ts`
- `packages/server/src/utils/checkout-git.ts`
- `packages/server/src/server/session/checkout/checkout-session.ts`
- `packages/server/src/server/session/git-ai-session.ts`
- `packages/server/src/server/workspace-git-service.ts`

### 17. 启动阶段按需初始化与并发控制

- 守护进程完成监听后，在后台并发预加载已开启 Provider 的模型目录：先按最近活跃会话（“上次会话”）所在目录预热工作区范围，再预热全局范围；预加载与其它启动进程并发、不阻塞守护进程接受连接，未开启的 Provider 只标记不可用而不拉起 CLI，仍受共享的提供方探测并发限制约束，之后打开新建智能体表单或模型选择器时无需再等待模型列表探测。
- 应用连接守护进程时不会立即启动所有智能体 CLI 做可用性与模型探测；隐藏的新建智能体表单和非焦点会话控制栏不会在后台触发探测，避免与首屏会话、时间线和 Git 状态加载争抢进程、磁盘和事件循环资源。
- 打开并聚焦已有会话时会立即请求当前工作目录的提供商快照，主动预热模型目录和配置，使模型选择器首次展开即可使用；同一主机和目录共享查询缓存，不重复探测。新建智能体、会话导入和提供方设置等依赖完整提供方信息的界面仍在打开时加载；老会话的模型选择器只在快照尚未就绪时定向刷新当前智能体提供方。
- 守护进程对所有工作区和全局设置范围共享同一个提供方探测并发限制，最多同时执行两个探测；不同范围同时请求也不会突破限制，各提供方完成后仍立即发布自己的最新状态。
- Electron 主进程完成单实例判断和 IPC 注册后，会在创建首个窗口的同时预启动内置守护进程；渲染进程随后发起的启动请求会复用同一个进行中任务，不重复拉起进程。禁用内置管理或配置自定义本地守护进程时不会预启动，预启动失败只记录错误而不阻止窗口显示。
- 工作区目录首次加载只返回守护进程已有的 Git 缓存，不再为列表中最多 200 个未打开工作区同时注册 Git 观察器；进入具体工作区并读取其本地 Git 状态后才注册该目录的实时观察，当前工作区的分支、差异和状态推送保持不变。
- 桌面端支持在设置中选择退出应用时停止桌面托管的守护进程，但二开默认仍保持守护进程运行，已有用户的选择不会被上游默认迁移重置。

主要涉及：

- `packages/app/src/contexts/session-context.tsx`
- `packages/app/src/hooks/use-agent-form-state.ts`
- `packages/app/src/composer/agent-controls/`
- `packages/app/src/screens/workspace/workspace-screen.tsx`
- `packages/server/src/server/agent/provider-snapshot-manager.ts`
- `packages/server/src/server/bootstrap.ts`
- `packages/server/src/server/session/checkout/checkout-session.ts`
- `packages/server/src/server/session.ts`
- `packages/desktop/src/daemon/daemon-manager.ts`
- `packages/desktop/src/main.ts`
- `packages/app/src/desktop/settings/desktop-settings.ts`
- `packages/desktop/src/settings/desktop-settings.ts`

### 18. 侧栏工作区与会话的可配置组织方式

- 每个工作区在未展开时默认显示 5 个会话，用户可以在“设置 → 通用”中把数量调整为 1–100；展开后仍显示该工作区的全部会话。
- 工作区支持按加入 Paseo 的先后、名称和自定义顺序排列，默认沿用加入 Paseo 的先后。切换到名称排序时禁用拖动，拖动加入时间顺序中的工作区后自动进入自定义顺序。
- 工作区首次被 Paseo 发现的顺序和手工拖动顺序分别持久化；未手工排序的工作区内部会话始终按最近活动时间从新到旧动态排列，新会话直接出现在顶部。拖动会话后持久化该工作区的自定义顺序，之后发现的新会话仍插入顶部并保留已知会话的手工相对顺序。
- 左侧桌面侧栏采用紧凑父子层级，工作区父行约 32 像素、会话行约 30 像素并缩短组间空白；移动端继续保留原有触控高度。
- Windows、macOS 和 Linux 桌面端支持从系统文件管理器把一个或多个本地文件夹拖入左侧会话区，并通过本机 Host 注册为工作区；单个文件、不可读取路径、未连接本机 Host 和目录添加失败都会显示明确错误，不会静默忽略。

主要涉及：

- `packages/app/src/components/sidebar-workspace-list.tsx`
- `packages/app/src/components/sidebar/sidebar-display-preferences-menu.tsx`
- `packages/app/src/components/sidebar/sidebar-project-drop-zone.web.tsx`
- `packages/app/src/hooks/use-settings/storage.ts`
- `packages/app/src/stores/sidebar-order-store.ts`
- `packages/app/src/stores/sidebar-view-store.ts`
- `packages/app/src/stores/session-store-hooks/`

### 19. OpenCode 事件流断线自动重连

- 守护进程订阅共享 OpenCode server 事件流时启用 SDK 自动重连（最多 3 次，退避 3 秒/6 秒/12 秒），不再在流断开时立即判定所有前台回合失败。
- 所有智能体共享同一个 OpenCode server，一次断线（例如主机睡眠唤醒后的本地 TCP 重置、OpenCode server 短暂重启）会同时中断所有运行中的回合；上游零重试策略会把这种瞬时断连误判为回合失败并终止智能体。
- SDK 按 SSE 的 Last-Event-ID 续传重连，不丢事件；重试耗尽后流仍断开（OpenCode server 真正退出）才按原有逻辑结束回合。
- 回合取消（abort）路径不受影响：主动停止仍即时生效，不会被重连延迟阻塞。

主要涉及：

- `packages/server/src/server/agent/providers/opencode-agent.ts`
- `packages/server/src/server/agent/providers/opencode-agent.test.ts`

### 20. 会话自动命名沿用当前智能体

- 新建会话的工作区标题和初始分支名只使用该会话实际创建成功的 Provider、模型与思考配置，不再优先启动 Haiku 等默认元数据候选，也不会读取此前处于焦点的旧会话配置。
- 目录会话在创建成功后直接使用新会话快照；现代工作树会话在创建工作树时显式携带本次请求的智能体配置，带创建后续步骤的工作树会话则延后到智能体创建成功后再启动命名，确保自定义 Provider、模型和思考配置都与正文会话一致。
- 当前会话命名失败时保留提示词生成的临时标题或占位分支，不切换到其他 Provider。提交说明、拉取请求文本等其他元数据任务仍沿用可配置的回退顺序；单独创建且尚无智能体的工作区也继续使用原有元数据生成规则。

主要涉及：

- `packages/server/src/server/worktree-branch-name-generator.ts`
- `packages/server/src/server/workspace-auto-name.ts`
- `packages/server/src/server/worktree-session.ts`
- `packages/server/src/server/agent/create-agent-lifecycle-dispatch.ts`
- `packages/server/src/server/agent/create-agent/create.ts`
- `packages/server/src/server/session.ts`
