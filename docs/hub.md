# Paseo Hub 关系

Paseo Hub 是一个由用户主动启用的连接：一个 Paseo 守护进程最多连接一个 Hub。仅仅运行守护进程不会向 Hub 注册；只有用户在守护进程所在机器执行以下命令后，关系才会建立：

```powershell
paseo hub connect <url> --token <token>
```

## 连接与授权

守护进程先通过 HTTP(S) 注册，再主动建立并维护到 Hub 的 WebSocket 连接。Hub 不会通过 Paseo 中继发现或接管守护进程；中继仍只用于普通 Paseo 客户端的可选加密连接，不参与 Hub 注册、身份验证、任务分发或重连。

注册前，守护进程会先持久化关系标识与私有连接凭证。关系不依赖当前传输方式，因此未来可以替换直连 WebSocket，而无需重新配对。目前每个守护进程只支持一个 Hub 关系。

经过身份验证的普通守护进程会话可以管理 Hub 关系和权限。新建 Hub 关系默认没有任何守护进程权限，仅获得机器身份和在线状态。连接时可在 `--permission` 后列出一个或多个权限，也可以稍后调整：

```powershell
paseo hub connect <url> --token <token> --permission hub.execute
paseo hub permissions list
paseo hub permissions grant hub.execute
paseo hub permissions revoke hub.execute
```

`hub.execute` 允许 GitHub、Slack、Discord、Linear 等外部工作流创建工作区并运行智能体。旧客户端发起的连接请求没有权限字段时，守护进程会在兼容边界保留旧行为并授予 `hub.execute`；旧关系文件中的 `hub.execution.*` 也会在加载时一次性迁移为 `hub.execute`。Hub 会话不能管理自己的关系或权限。

## 会话授权与任务归属

普通可信客户端与 Hub 共用同一个 `Session` 实现。连接边界提供语义权限：本机所有者会话获得完整权限集，Hub 会话只获得本地持久化并由 Hub 确认的权限。权限不足时返回普通、可区分的 `rpc_error`，不会伪装成资源不存在或空数据。权限模型详见 [permissions.md](permissions.md)。

Hub 也使用标准会话握手、断线恢复和服务端状态通知。它能收到什么、可以发送什么，仍同时受语义权限、智能体归属和订阅范围限制：只有属于该守护进程身份的 Hub 任务会进入 Hub 的执行事件流，本机其他智能体不会泄露给 Hub；没有 `workspace.write` 时，二进制文件写入和浏览器自动化响应会被拒绝；不在其授权范围内的广播会被会话出口过滤。

每次 Hub 创建任务都携带执行标识。守护进程会在确认创建成功前，把这个标识与关系所有者一起持久化。针对同一守护进程和执行标识的重复创建或重放请求会解析到同一个持久智能体。响应丢失、连接恢复或守护进程重启后，Hub 可以用同一执行标识重新发送 `hub.execution.agent.create.request`；幂等响应会返回现有智能体及其当前状态，不需要单独的对账 RPC。临时流事件不会持久化重放。

守护进程重启会保留 Hub 关系和任务归属，但会中断正在执行的回合。该智能体会以 `closed` 状态持久化；之后用同一执行标识重试仍返回同一个守护进程、执行和智能体标识，不会保存并自动重放原始提示词，也不会重复启动回合。

Hub 创建任务复用普通客户端的智能体创建路径，可以选择现有的工作树目标，并可请求 `autoArchive`。工作树创建与终端自动归档继续使用共享的、感知工作区的生命周期规则，不存在第二套启动或清理流程。

## 断开与撤销

普通网络断开会按有上限、带抖动的指数退避策略重连。守护进程重启后会加载同一关系和凭证，不再重复注册。

Hub 身份验证被拒绝或收到关闭码 `4403` 时，本地关系会被永久撤销。守护进程删除凭证并停止重连，只保留关系标识、Hub 来源、权限和经过清理的原因用于状态展示。

`paseo hub disconnect` 会先禁止 WebSocket 重连，再请求远端撤销。Hub 离线时，守护进程持久化 `disconnecting` 状态，并在后续重启时继续重试撤销，但不会重新打开 Hub WebSocket。这也覆盖“注册请求可能成功、响应却丢失”的情况。`--force` 会立即移除本地授权，并明确提示远端撤销可能仍未完成。

## 跨仓库兼容

Hub 的消费端实现位于 Paseo Cloud。Cloud 自行维护 Hub 线协议副本，不依赖 Paseo 的运行时或构建产物。跨仓库端到端验证会单独构建 Paseo 源码检出，并测试真实守护进程、CLI、直连 WebSocket、Cloud 服务和 Postgres；该兼容夹具不是包依赖，也不是运行时降级实现。
