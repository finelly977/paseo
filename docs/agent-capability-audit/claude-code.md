# Claude Code 能力接入审计

日期：2026-10-18。本机 CLI 为 2.1.302；`packages/server/package.json` 固定 `@anthropic-ai/claude-agent-sdk` 0.3.246。[官方 SDK 更新记录](https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/CHANGELOG.md)已列出 0.3.302，并说明与 CLI 2.1.302 的对应关系。仅升级电脑上的 CLI 不会更新 Paseo 的 SDK 类型、传输实现和新方法。

## 结论

最值得优先做的是 SDK/CLI 配对回归，而不是直接拉高依赖后宣称全部支持。Paseo 已支持动态权限、文件检查点、历史恢复、思考/Fast 与部分原生子智能体事件；主要缺口在新 SDK 事件、用户可控结构化输出、后台任务管理和运行时扩展操作。

## 代码范围

- `packages/server/src/server/agent/providers/claude/agent.ts`：SDK options 构造、权限处理、`handleSystemMessage` 和 task 事件。
- 同目录 `rewind.ts`、`session-title.ts`、`feature-definitions.ts`、`model-manifest.ts`。
- `packages/protocol/src/provider-manifest.ts` 的 Claude 模式目录；`packages/server/src/server/agent/agent-sdk-types.ts` 的 `outputSchema` 通用运行参数。

## 新老能力对照

| 能力                                 | 当前判断               | 依据与缺口                                                                                                                                                                                                                                     |
| ------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 与 SDK 版本配对                  | 待回归，P0             | 本机 CLI 与固定 SDK 相隔多个发布；官方 0.3.301/302 有运行时插件、权限和 fork 子智能体变化。不能仅用 TypeScript 编译证明事件兼容。见[SDK changelog](https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/CHANGELOG.md) |
| 默认、自动、接受编辑、绕过、计划模式 | 已有主要模式           | `setPermissionMode` 与资格判断已接；`dontAsk` 没有在常用模式目录开放，属于部分覆盖。官方[权限说明](https://code.claude.com/docs/en/agent-sdk/permissions)还明确 deny/ask 规则与模式的先后关系                                                  |
| 模型、思考、Fast                     | 已支持，元数据仍需更新 | 由本地 manifest 派生；新模型档位不能仅靠新 CLI 自动补齐客户端静态清单                                                                                                                                                                          |
| 文件检查点和回退                     | 已支持                 | 明确 `enableFileCheckpointing: true`，调用 `rewindFiles`，另有 SDK fork 辅助；不可误报“只有聊天回退”。[官方检查点文档](https://code.claude.com/docs/en/agent-sdk/file-checkpointing)                                                           |
| 结构化 JSON 输出                     | 部分，P1               | 通用 run options 有 `outputSchema`，但 Claude 适配器未发现将其映射为 `outputFormat` 或消费最终 `structured_output` 的专门路径；高级 extra 不等于统一产品支持。[官方结构化输出](https://code.claude.com/docs/en/agent-sdk/structured-outputs)   |
| 自定义子智能体和后台进度             | 部分                   | 启动 options 传 `agents`，处理 `task_started`、`task_progress`、`task_notification`；源码仍标注子轨道 best-effort。缺完整任务列表、单项停止、后台权限与恢复验收。[SDK 子智能体](https://code.claude.com/docs/en/sub-agents)                    |
| fork 子智能体新默认行为              | 待验证，P1             | 0.3.302 改为默认开放 fork 子智能体；不能假设旧父子事件路由覆盖新行为。应确认同一结果不污染主消息、不重复完成                                                                                                                                   |
| Skills、CLAUDE.md 与设置来源         | 已支持主要继承         | `settingSources`、preset systemPrompt 和 `supportedCommands` 已接，不应因无官方管理页就说 Skills 不工作                                                                                                                                        |
| Hooks                                | 部分                   | 原生设置文件中的 Hooks 随 CLI 加载；Paseo 没有全事件管理、输出审计和调试入口。CLI 新增事件不会因通用 Hooks 概念存在就自动变成 Paseo 卡片。[Hooks 参考](https://code.claude.com/docs/en/hooks)                                                  |
| 插件热加载、MCP 工具策略             | 部分，P1               | 额外 SDK options 可带配置，但未找到 `reloadPlugins({addPlugins})` 和每工具 permission policy 的完整管理操作；Paseo 插件与 Claude 插件不是同一系统                                                                                              |
| SDK 新状态和限流事件                 | 部分/待验证            | 当前有通用用量和错误展示；新 SDK 的状态、模型回退、细粒度额度与后台任务通知需逐事件回归，不能只更新类型后丢弃未知事件                                                                                                                          |
| Idle compaction、自定义分类器        | 没有专门 UI，P2        | 官方 CLI 2.1.302 列出空闲压缩开关与分类器模型环境配置；可能由原生配置继承，不等于必须复制 TUI `/config`。[CLI changelog](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)                                           |
| Remote Control、云 Routines、Desktop | 不直接等同本地接入缺陷 | Paseo 自有远程连接与计划任务，不能宣称可以管理官方云端任务或替代官方全部跨端会话。[官方产品概览](https://code.claude.com/docs/en/overview)                                                                                                     |

## 建议与验证范围

1. **P0**：先固定 CLI/SDK 组合做文本、图片、流式、取消、自动审批、AskUserQuestion、恢复、文件回退的协议回归，再审查 0.3.246 至候选版本的事件变化。保留源码、权限与官方配置，不自动更新用户安装。
2. **P1**：补结构化输出通用映射、原生后台任务操作与 fork 子轨道；新增权限及插件方法分别测试成功、拒绝、取消、断线恢复。
3. **P2**：Hooks/插件管理和额度观测按实际需求做，不追求复制整个官方 TUI。

本报告没有证明某一新 SDK 事件已经导致本机故障，也没有真实账号推理测试。文件配置能继承的能力与专门可见的 UI 能力分别计数；官方支持不等于当前模型或第三方网关必定支持。
