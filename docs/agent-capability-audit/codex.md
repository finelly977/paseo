# Codex 能力接入审计

日期：2026-10-18；本机 `codex --version` 为 0.163.0。Paseo 使用本机 Codex app-server，不直接拼装 Responses API；本报告未改变配置，也未发起推理。官方依据是已读取的 [App Server 文档](https://developers.openai.com/codex/app-server/)，能力可用性仍受二进制、实验开关和账号限制。

## 结论

基础集成已经很深，优先事项不是再做一遍模型切换或会话导入，而是补齐新版权限协议与状态型能力。不要把 Paseo 已实现的 `/goal`、Fast、原生改名归档、分页历史、桌面工具或图片输出误报为完全不支持。

## 对照

以下原生方法均以 [官方 App Server 协议](https://developers.openai.com/codex/app-server/) 为依据，Paseo 侧核对文件为 `packages/server/src/server/agent/providers/codex-app-server-agent.ts`，下表给出具体定位。

| 能力                   | 当前状态及证据                                                                            | 缺口或下一步                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 创建、恢复、完整历史   | 已支持；`thread/start`、`thread/resume`，并有 `thread/turns/list`、条目分页与持久历史重建 | 保留既有完整恢复及去重约束，不退化为只读尾页                                                       |
| 改名、归档             | 已支持；`thread/name/set`、原生归档及释放运行时流程；另见 `docs/session-titles.md`        | 不应重新实现成只写 Paseo 别名                                                                      |
| 模型、思考、Fast       | 已支持；`model/list`、目录 `serviceTiers` 与会话实际值回写                                | 官方新增档位必须按目录识别，不能假设一律叫 priority                                                |
| 原生会话分支、回退     | 已有 `thread/fork` 与回退路径                                                             | 与官方新增 fork 参数分别回归，不把“支持分支”当成所有参数都已开放                                   |
| 执行、文件和问答审批   | 已支持；`registerRequestHandlers` 注册命令、文件、问题及 MCP elicitation                  | 继续保留真实交互状态                                                                               |
| 增量权限申请           | 待验证，P0；官方新增 `item/permissions/requestApproval`，现注册表没有对应专门处理器       | 验证 `request_permissions` 打开时请求是否被正确回答；不能仅打开模型工具开关                        |
| 权限档案               | 部分，P1；现有四模式及自定义配置主要映射传统 sandbox/approval 参数                        | 官方 beta `permissionProfile/list` 与 permissions 档案不能简单等同旧四模式；需能力探测和专门选择器 |
| 原生评审               | 未找到 `review/start` 产品映射，P1                                                        | 普通提示词“评审代码”和原生评审进入/退出事件不是同一能力                                            |
| 目标                   | 部分，P1；`resolveGoalsEnabled`、`handleGoalCommand` 已支持设置、暂停、恢复、清除         | 未见目标读取、通知驱动状态面板、预算与使用量的完整产品闭环                                         |
| 运行中引导             | 已支持；`turn/steer`；Paseo 自身还有排队消息                                              | 对照当前回合身份与失败重试语义，而不是另起回合伪装 steering                                        |
| Skills、Apps、插件     | Skills 列举和调用已有；未找到官方 Apps/连接器管理及授权流程的完整入口                     | Paseo 本地插件系统不等于 Codex 官方插件/连接器；分别列出授权、启停、错误状态                       |
| 账户统计与额度重置     | 部分；现有用量系统不等于所有账户 RPC                                                      | 未见 `account/usage/read`、额度重置领取、工作区通知等专门入口，P2；部分仅支持特定认证方式          |
| 外部进程与后台终端     | 模型执行工具及 Paseo Terminal 已有                                                        | 未见实验性 `process/spawn` 管理、原生终端清理的统一映射；不是当前终端的必需替代品                  |
| 图像生成、Computer Use | 已有图像条目映射与二开桌面宿主；见 `docs/fork-features.md` 桌面工具条目                   | 生成工具实际开放仍取决于模型、上游和账号；不能把 API 有图像模型当作 app-server 必定可调用的证明    |

## 建议顺序与验收

1. **P0，权限协议回归**：以 0.163.0 创建最小会话触发增量权限申请，分别批准、拒绝、取消；确认没有请求悬挂，范围没有扩大，并验证老四模式继续工作。本轮只发现静态处理器缺口，未声称已经复现挂起。
2. **P1，原生评审和目标状态**：用户入口、运行状态、终止、恢复与费用/预算展示一起设计；不能只加入菜单文字。
3. **P1/P2，Apps 与账户能力**：先确认官方 RPC 稳定性、认证范围及授权流程，再决定是否落地。实验 API 不应无条件对所有 Host 开放。

### 边界

[Codex 官方平台说明](https://developers.openai.com/blog/codex-as-a-platform/)区分 SDK、非交互执行与 app-server 集成；[远程使用说明](https://developers.openai.com/blog/mastering-codex-remote-for-engineering)还包含官方客户端自己的跨设备产品能力。官方云端工作区、分享与调度不应因外观相似就归入本地 app-server 的缺陷。上述结论为静态代码与官方协议对照，不替代各认证/平台的实时验证。
