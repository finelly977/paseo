# Pi 能力接入审计

日期：2026-10-18；本机 `pi --version` 为 **1.3.0**。官方仓库现为 `earendil-works/pi`，本报告用 **v1.3.0 标签**下的文档，不把未发布 main 当作已上线能力。Paseo 以 `pi --mode rpc` 作为子进程接入，不嵌入 Pi SDK。

## 结论

仓库部分说明仍停留在 Pi 0.87 时代，不能再以“Pi 没有原生 MCP”作为当前前提。最高优先级是新旧 RPC 与 MCP 能力识别回归；原生队列、分支、重试控制和扩展界面属于新老功能尚未完整产品化。另一方面，Paseo 已处理 `agent_settled`，不能误报为只认 `agent_end`。

## 对照表

代码主要位于 `packages/server/src/server/agent/providers/pi/agent.ts`、`cli-runtime.ts`、`rpc-types.ts`、`history-mapper.ts` 和 `rewind.ts`。

| 能力                         | 当前状态                   | 代码和官方依据、差距                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 原生 MCP                     | 待验证，P0                 | 官方 v1.3.0 已有 [MCP 配置、登录、资源与工具管理](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/mcp.md)。Paseo 的 `detectMcpAdapter` 仍要求命令 `source=extension` 且来源包含 pi-mcp-adapter，之后才注入配置。原生能力可能被判成无支持，必须做无旧扩展环境回归，不能直接混用两种配置参数                                                                                         |
| prompt 回执                  | 部分/待验证，P0            | [新 RPC](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/rpc.md)与[命令参考](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/rpc-commands.md)使用 `disposition` 区分 started/queued/handled；`cli-runtime.ts::prompt` 仍专门读取 `agentInvoked`，无回合命令还有状态探测补救。需验证 handled 命令不会一直转圈，不能仅凭字段差异声称已复现故障 |
| 工作结束事件                 | 已支持主要行为             | `handleRunCompletion` 已区分 agent_end/willRetry 与 agent_settled，等待最终稳定；不是待从零接入项                                                                                                                                                                                                                                                                                                                        |
| 模型与图片                   | 已支持主要行为             | `get_available_models`、`set_model`，按模型 input 能力发送图片；1.2.0 按 OpenRouter key 发现模型的增强可随 CLI 继承，不必在 Paseo 重写推理路由。[发布记录](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/CHANGELOG.md)                                                                                                                                                                |
| 每模型思考等级               | 部分，P1                   | 支持 set_thinking_level，但模型选项主要来自静态 `PI_THINKING_OPTIONS`，未见调用新 `get_available_thinking_levels`；应按当前模型目录获取，避免展示不可用等级。[RPC 命令](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/rpc-commands.md)                                                                                                                                           |
| Steering、follow-up 与清队列 | 未提供完整原生映射，P1     | runtime 没有完整暴露 steer、follow_up、clear_queue 及两个投递模式设置。Paseo 自己的排队并不等于 Pi 原生队列；取消时还需将返回文字恢复到输入区，而非只 abort                                                                                                                                                                                                                                                              |
| 压缩和自动压缩               | 已支持                     | `compact`、`set_auto_compaction` 与过程事件已有；新压缩统计字段仍需展示核对                                                                                                                                                                                                                                                                                                                                              |
| 自动重试                     | 部分，P1                   | 有事件和稳定结束处理；未见独立的 set_auto_retry、abort_retry 产品控制。不能把全局取消误当仅取消重试等待                                                                                                                                                                                                                                                                                                                  |
| 会话恢复、命名、导入         | 已支持主要路径             | 原生 JSONL 发现与 RPC 恢复；与旧记录完整投影、图片恢复链路共同工作                                                                                                                                                                                                                                                                                                                                                       |
| 原生 fork、clone、会话树     | 部分，P1                   | 有 Paseo 回退集成，但 runtime 未暴露完整 fork/clone/get_tree 与分支摘要管理。[会话说明](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/sessions.md)                                                                                                                                                                                                                               |
| 直接运行 shell 并写入上下文  | 未提供专门入口，P2         | 原生 bash/abort_bash 与普通模型调用 bash、Paseo Terminal 不同；前者有上下文归属和输出事件契约                                                                                                                                                                                                                                                                                                                            |
| 导出/分享                    | 未提供统一入口，P2         | export_html 与新 sessionShareDestination 没有 Paseo 管理闭环；分享应另行审查内容及目标，不自动上传。[发布记录](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/CHANGELOG.md)                                                                                                                                                                                                            |
| 扩展交互                     | 问题框主要已支持，其他部分 | select/input/editor/confirm 已桥接；notify 有处理，setStatus/setWidget/setTitle/set_editor_text 未形成完整显示或编辑状态闭环。[扩展 UI](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/rpc-extension-ui.md)                                                                                                                                                                       |
| Codemode、原生活跃工具       | 待验证，P1                 | 1.x 原生工具面扩大，但 full/ask/read-only 模式来自 Paseo 生成扩展。需验证不重置恢复后的活动工具，不把包装工具误识别为权限绕过；当前没有已复现结论。[Codemode](https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/codemode.md)                                                                                                                                                         |

## 不应误列的缺口

- v1.3.0 的模型切换清理旧思考、缓存保持与原生网络修复主要在 Pi 自身实现。Paseo 走本机 CLI 时可继承，除非自己的参数覆盖它们，不能都列为待开发功能。
- RPC 官方说明 custom TUI、页眉页脚、主题等部分接口不支持或退化；Paseo 无法仅靠接 UI 事件复刻这些终端专属功能。这是协议边界，不全是 Paseo 漏接。
- Paseo 额外实现的权限模式、计划任务、子智能体不应被说成 Pi 核心原生同名能力；原生插件工具的存在也不等于有统一可见控制台。

## 建议顺序

1. **P0**：固定 Pi 1.3.0，验证无第三方旧 MCP 扩展下的启动/注入，分别测试 prompt 的 started、queued、handled 和错误回执；保持最终 agent_settled 语义。
2. **P1**：原生队列、动态思考等级、重试取消、分支树，连同恢复和取消行为一起补齐。
3. **P2**：扩展状态、编辑器预填与导出管理。优先补协议已有可见事件，不重新发明官方明确不支持的 TUI 功能。

以上是源码与标签文档对照，未运行带真实账号的模型回合；“待验证”不能作为已经出错的实测证据。本轮未修改 Pi 适配器或其版本。
