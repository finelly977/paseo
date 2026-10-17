# Grok Build 能力接入审计

日期：2026-10-18；本机官方 `grok --no-auto-update --version` 为 **1.0.62 stable**。本报告指 xAI 的 Grok Build CLI，不是网页 Grok、模型 API 或社区 Grok CLI。官方 [ACP/无界面文档](https://docs.x.ai/build/cli/headless-scripting)说明使用 `grok agent stdio`，与 Paseo 目录启动命令一致。

## 结论

基础聊天并非只接了一层文字：通用 ACP 已处理流式、工具、模式、模型、配置更新与会话加载。但这不意味着官方原生子智能体、后台任务、分支、回退、插件管理都已成为 Paseo 的完整可见功能。优先围绕 ACP 暴露程度做验证，不根据 CLI 帮助中一个参数就声称 ACP 也支持。

## 代码边界

- `packages/app/src/data/acp-provider-catalog.ts`：Grok 安装项、启动参数、目录版本。
- `packages/server/src/server/agent/providers/generic-acp-agent.ts` 与 `acp-agent.ts`：进程、会话、动态模式/模型/思考选项、权限、MCP、命令与事件。
- `grok-native-session.ts`：从官方 ACP 命令构造 `grok sessions delete`，有明确失败处理。
- `packages/server/src/services/quota-fetcher/providers/grok.ts`：Grok 余额/额度，不等同官方所有会话统计。

## 对照表

| 能力                     | 判断                                 | 依据、适用边界与缺口                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 官方 Agent 身份及版本    | 部分，P1                             | 目录版本仍是 0.2.11，实际运行已为 1.0.62；目录数字不是运行时固定版本。应增加版本/能力可观测性，不把旧目录号当实际 CLI 版本                                                                                                                         |
| 无界面 ACP 聊天          | 已支持主要路径                       | GenericACPAgentClient 使用官方命令，接 session/update 和 prompt 完成信息；[官方传输说明](https://docs.x.ai/build/cli/headless-scripting)                                                                                                           |
| 模型、模式、effort       | 标准 ACP 部分已支持                  | 解析 config_option_update、目录与思考选项；具体新版字段是否被 Grok 放进 ACP 必须验证。[CLI 参考](https://docs.x.ai/build/cli/reference)有参数不代表会话可动态改同一参数                                                                            |
| 会话恢复与导入           | 已有标准 ACP 能力                    | 是否可列举由握手能力决定，历史加载使用 load 回放；不应改成不回放的 resume 来“提速”。[官方 Sessions](https://docs.x.ai/build/features/sessions)说明会话跨 TUI/headless/ACP 保存                                                                     |
| 原生分支                 | 未提供完整映射，P1                   | 官方有 `/fork`、--fork-session 和工作树选择；通用 ACP 没有 Grok 专门 fork 操作。即使 slash 可发出，也缺新原生会话身份、工作区归属和完整历史的闭环                                                                                                  |
| 原生回退                 | 未专门支持，P1                       | DEFAULT_ACP_CAPABILITIES 不开放通用 rewind；官方 `/rewind` 会同时改文件和聊天，不能只在 Paseo 删行冒充。需先确认 Grok ACP 的原生操作契约                                                                                                           |
| 子智能体                 | 部分，P1                             | [官方子智能体](https://docs.x.ai/build/features/subagents)有独立上下文、内建类型与 persona；Paseo 可展示一般工具，但未找到 Grok 专属子会话发现、恢复和单项控制映射。Paseo 自建子智能体不是官方子会话的替代证明                                     |
| 后台命令、monitor 与任务 | 未完整产品化，P1                     | [官方后台任务](https://docs.x.ai/build/features/background-tasks)可列任务、停止、前后台切换及 monitor；没有通用 ACP 即可自动管理的保证，需独立任务身份/状态映射                                                                                    |
| 原生排队与 loop          | 部分                                 | Paseo 自身排队、定时发送、计划任务已有；不等于可以读取或取消 Grok 原生 queue/loop。两边同时排队时须避免重复投递                                                                                                                                    |
| 权限规则、sandbox        | 基本审批已支持，管理部分             | 标准 ACP permission request 已桥接；[官方 Permissions](https://docs.x.ai/build/features/permissions)中的原生规则和 [CLI sandbox 参数](https://docs.x.ai/build/cli/reference)没有完整的 Paseo 编辑/诊断面板。不可把“自动批准”写成操作系统无边界权限 |
| Skills、插件、MCP、Hooks | 底层可继承，管理部分                 | 原生会按目录和配置加载；Paseo 并未完整呈现官方安装/授权/信任/重载管理。[官方扩展说明](https://docs.x.ai/build/features/skills-plugins-marketplaces)还列出 Claude 资源兼容，不应判为资源完全不工作                                                  |
| 跨会话记忆、导出与搜索   | 未提供 Grok 专属管理，P2             | CLI 有 memory clear、export、sessions search/import 等操作；本次新增 Paseo 正文搜索只查 Paseo 已保存会话，不是 Grok 原生会话库搜索                                                                                                                 |
| 原生删除                 | 已有辅助能力，不代表所有删除语义相同 | `deleteGrokNativeSession` 有真实 CLI 调用；需要核对它用于哪个生命周期操作，不能把 Paseo 移除、归档和原生删除混为一谈                                                                                                                               |
| 自动更新与可重复启动     | 待核对，P1                           | 目录命令未带 --no-auto-update；官方文档建议机器集成禁用后台更新检查。应明确版本控制责任，防止运行中协议版本漂移，而不是自动升级用户 CLI                                                                                                            |

## 建议顺序与证据限制

1. **P1**：固定本机 stable 版本，保存无推理握手的能力快照，对照可列举会话、动态 effort、模式、可取消请求、模型刷新与原生 slash 命令的返回行为。
2. **P1**：优先原生子会话、任务/monitor、fork 与回退。每一项先证明 ACP 或可支持的原生 API，再设计 Paseo 状态和用户入口；不能从 TUI 截图反推可用 RPC。
3. **P2**：扩展、记忆、原生搜索/导出和版本诊断；任何上传分享或删除行为都另做确认与隐私设计。

官方功能页有些最后更新时间早于本次审计，未取得覆盖 1.0.62 全部变更的逐版公开 changelog，因此没有把所有功能标成“最近新增”。本轮没有进行真实账号推理或源码逆向，也未改 Grok 配置、升级二进制或禁用它的现有功能。
