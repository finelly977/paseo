# OpenCode 能力接入审计

日期：2026-10-18。本机 CLI **1.19.2**，Paseo 固定 `@opencode-ai/sdk` **1.14.46**。[官方 1.x 发布记录](https://opencode.ai/en/changelog)当前列出 1.19.3，并把升级至 OpenCode 2 作为独立的明确选择；本轮未升级任何包或切换大版本。

## 结论

Paseo 已覆盖直接服务端接入的主要能力，不宜改成 ACP 后笼统宣称“更现代”。优先检查 SDK 与实际 server 的版本跨度、新 reasoning variants、原生自定义 Agent 与控制功能。**会话分享已于 1.19.1 停用，不应补一个新的分享按钮**，即使旧 SDK 参考页仍列着相关方法。

## 当前接入与证据

主要代码：`packages/server/src/server/agent/providers/opencode-agent.ts`、`opencode/server-manager.ts`、`opencode/event-consumer.ts` 与桥接模块，依赖版本见 `packages/server/package.json`。对照 [SDK 文档](https://opencode.ai/docs/sdk/)、[模型配置](https://opencode.ai/docs/models/)、[Agent 配置](https://opencode.ai/docs/agents/)和上面的已发布 changelog。浮动文档与发布记录冲突时，优先记录明确版本的变更，再做真实 server 验证。

| 能力                        | 状态                               | 当前范围与尚需工作                                                                                                                                                                |
| --------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 创建、恢复、历史与实时事件  | 已支持                             | `session.create/get/messages`、promptAsync、事件恢复；二开复用辅助服务、历史不缓存不截断的约束要保留                                                                              |
| 模型与变体                  | 已支持主要路径，P1 核对新字段      | 模型目录读取 variants，`normalizeOpenCodeVariantId` 与发送 variant 已有；1.19.3 改进 reasoning 选项生成。需验证最新 server 返回的有效变体、默认与覆盖项，而非仅显示 raw key       |
| SDK/server 跨版本           | 待回归，P1                         | 1.14.46 类型不代表 1.19.x 的全部事件字段；需覆盖错误、取消、权限、图片和历史再决定 SDK 更新范围                                                                                   |
| Build/Plan 及自定义主 Agent | 部分/需验收                        | 当前有模式目录和 effectiveMode→agent 路径；应核对动态自定义 Agent、隐藏项与禁用项是否完整反映。不要把推理模型提供方当成 OpenCode 内部 Agent                                       |
| 原生子会话                  | 已有主要桥接                       | 适配器已有 child session hydration、父子关系和工具事件；应针对父会话恢复、孩子未加载和取消做回归，不误列为完全不支持                                                              |
| 权限与问题                  | 已有主要映射                       | 单次允许、持续允许、拒绝及问题桥接；细粒度原生规则可能由 opencode 配置继承，Paseo 无完整规则编辑器不等于规则没生效                                                                |
| 回退                        | 已支持组合回退                     | capabilities 明确 supportsRewindBoth；独立“只改文件/只改聊天”并非当前开放能力。原生 unrevert 与产品入口需单独评估                                                                 |
| 结构化 JSON 输出            | 内部已支持，普通 UI 部分           | promptAsync 已将 `options.outputSchema` 传为 json_schema，恢复还会读取 structured 内容；但普通聊天没有可视化 schema 编辑与独立结果检查。不能把这一项说成适配器完全漏接            |
| 命令、压缩、取消            | 已支持主要路径                     | slash command、summarize 与 abort 已接；模型调用工具输出不应依赖前端展开状态完成                                                                                                  |
| 原生 session.shell          | 未找到独立用户操作，P2             | Paseo Terminal 不会自动把结果插入原生会话，不能冒充 session.shell 的上下文语义                                                                                                    |
| MCP、Skills、插件、LSP      | 主要由原生配置与桥接继承，管理部分 | 有工具执行不等于完整具备原生管理、认证、重新连接及错误诊断入口；逐系统评估，不把 Paseo 插件管理当成 OpenCode 插件管理                                                             |
| ultrafast 档位              | 待验证，P1                         | 1.19.0 宣布 OpenAI ultrafast 支持，但 OpenCode 适配器没有与 Codex 相同的 Fast 档位控件；变体与 provider options 是否能配置，须以当前模型/server 实测，不直接复用其他 Agent 的参数 |
| 会话分享                    | 不应新增                           | 1.19.1 明确停用。SDK 页面仍列 share/unshare 是文档/历史接口差异，不应当作当前功能承诺                                                                                             |
| OpenCode 2                  | 独立研究，非兼容升级               | 官方把它作为明确的大版本选择。未读取并验证本机未安装的 2.x API/迁移契约，不能宣称当前 v1 适配器支持 2，也不能把依赖版本直接改成 latest                                            |

## 推荐落地顺序

1. **P1，协议与目录**：选择明确 1.x SDK/server 组合，用配置中的自定义 Agent、reasoning variants、默认档位验证目录与实际请求一致；错误字段、取消和图片输出也一起测。
2. **P1，用户控制**：需要时补 service tier、自定义 Agent 管理和未还原状态操作，先区分模型、OpenCode 主 Agent、Paseo 会话三种对象。
3. **P2，扩展管理**：MCP 认证/连接状态、结构化输出 UI、原生 shell 等按收益排序。
4. **单独立项 OpenCode 2**：先做版本识别、迁移和历史回归，再考虑接入；不让实验大版本覆盖目前可工作的 1.x。

当前结论来自静态代码及官方资料；没有通过真实收费回合验证 ultrafast、每个模型或 2.x。未发现对应调用的结论只限所列接入路径，不否认用户原生配置或插件另有能力。
