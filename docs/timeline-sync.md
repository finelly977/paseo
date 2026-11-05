# Timeline sync

Agent chat delivery has two paths:

1. **Live stream** — `agent_stream` WebSocket messages for immediacy. These may be delta-shaped lifecycle updates.
2. **Authoritative history** — `fetch_agent_timeline_request` for correctness. This always returns full projected timeline items, never lifecycle deltas.

The invariant is:

> If the daemon has committed timeline rows for an agent, any connected client that opens or resumes that agent eventually displays every row through the daemon's current tail.

Tool output is bounded before it enters either delivery path. Canonical shell tool output is sliced
to 64 KiB, and the same bounded item is used for durable timeline rows and live stream events.
Provider history hydration applies the same rule so reopening an agent cannot restore an oversized
tool payload.

## Presence is not delivery

Client heartbeat reports presence:

- device type
- app visibility
- focused agent
- last activity time

Heartbeat is used for notification routing. It must not be used as a correctness gate for `agent_stream` delivery. A stale mobile focus heartbeat may affect whether the user gets notified; it must not make timeline rows disappear from the live stream.

## Catch-up is paged but complete

Large unbounded timeline responses can exceed relay frame limits, so catch-up uses bounded pages. Bounded does not mean partial.

Page limits are projected-item targets. A tool call lifecycle is one projected item even if it spans many source sequence numbers, and assistant/reasoning chunks are merged before counting. The response carries `seqStart`, `seqEnd`, `sourceSeqRanges`, and `collapsed` so clients can advance sequence cursors without rendering delta rows.

向前补载也必须按合并后的条目计数，返回整条助手回复时，起始游标应一次跨过该回复已经覆盖的全部流式片段。
不能按原始片段每 40 条切页、却在每页返回同一条完整回复，否则客户端会把它当作几页不同历史重复拼接。
工具生命周期的来源可能不连续，游标只能越过本页真正覆盖的连续记录，不能跨过尚未返回的中间消息；仅被工具首尾序号包围、没有实际来源落入本页的工具不重复返回。

When the app fetches `direction: "after"` and the daemon responds with `hasNewer: true`, the app must immediately fetch the next page from `endCursor`. The catch-up is complete only when `hasNewer: false`.

Initialization timeouts guard lack of catch-up progress, not the full multi-page sync. A successful page that queues the next `after` page refreshes the watchdog.

The first load of an agent without a local cursor is different: it fetches a bounded latest tail page. When a configured initial conversation target reaches farther back, the visible-timeline synchronizer backfills toward that target one bounded page at a time after the first page has become usable. History before that target remains user-driven by scrolling upward.

首次打开或恢复没有本地游标的会话时，首个响应只读取一页有界的最新尾部，不能因为配置了较多对话轮次就一次返回整段长历史。首屏可用后，可见会话同步器按页向前补齐配置的最近轮次；超过该目标的更早历史仍由用户向上滚动时加载。

配置轮次的补齐检查在最新记录追平后统一执行，不限于尾页请求：聊天面板可能先拿到尾页，随后订阅同步从已有游标执行增量读取；切换回来也可能继续使用此前只补齐一部分的缓存。这些路径都按已缓存历史起点与最近用户消息边界比较，继续补齐尚缺的轮次。响应因版本相同省略索引时，使用客户端已经保存的索引；达到目标后不重复向前请求。工具记录只影响分页次数，不增加对话轮次。

“还有更早历史”属于客户端缓存窗口的起点，不能直接采用每个响应的同名字段。尾部增量读取及其空响应只确认最新端，不得把已经读到头的历史重新标成未完成；只有覆盖缓存起点的页面、向前读到起点的空页，或重置后的新时间线才能更新这个边界。完整释放运行时仍会清空正文与游标，再次打开时正常冷加载；普通切换不清空已加载正文，仍受全局轮次预算约束。

补载或订阅协调失败后会自动重试，间隔从 1 秒开始翻倍，最高 30 秒。固定每秒重试会让持续存在的守护进程拒绝（例如同一 Codex 线程已有活动写入者）在应用空闲时也不断产生请求和日志。成功、重连、传输模式变化或真正的可见会话集合变化会重置间隔；重复发布完全相同的可见集合是空操作，不能绕过退避。

后台自动重试不打扰用户。同步错误提示中的手动重试是可能失败的用户操作，进行中状态由同步模型统一发布；重试失败后界面会回到错误状态。

到达历史起点阈值时只加载一页更早内容，并保持当前可见内容锚点。游标推进本身不会连续触发下一页；只有新页面仍不足以填满视口或历史尚未脱离起点时，才在同一次加载操作中继续分页，直到填满视口或耗尽历史。

网页端在补页改写 DOM 前记录可见消息及其相对视口的位置，提交后按消息身份恢复；首次从常驻列表切换为虚拟列表也遵循同一规则。已挂载虚拟历史行使用正常文档流，视口外内容用上下占位保留；正文、图表和图片增高时，后续消息立即让位。隐藏视口保留最后有效行高；首次挂载在提交时测量当前 DOM，尺寸变化直接使用同轮 ResizeObserver 的结果，不延后一帧逐行强制重测，也不把隐藏面板的零尺寸写入缓存。行高保留小数，位置校正与用户滚动意图使用各自阈值，避免字号、缩放产生的小数误差被逐行累计。行高变化交由浏览器锚定，不叠加虚拟器补偿；自动跟随按完整对话区域判断底部。补页锚点保持到连续两帧稳定，不只校正一次。用户重新滚动时取消尚未执行的锚点校正。

已加载历史内部的虚拟窗口切换也需要保持阅读位置，不仅是收到旧页时。窗口更换和首次测量会改变祖先容器的上下占位内边距，浏览器在这种布局变更中会抑制自身滚动锚定；不能把它等同于同一 DOM 行自然增高。网页在改写窗口前读取当前可见位置，并在同一次提交绘制前只补齐实际位移，不跨帧固定该位置，不抵消下一次滚轮输入。展开收起已有自己的入口锚定时不叠加窗口校正。助手正文块共用一个尺寸观察器，只缓存宽高，不触发 RN Web 对每一段祖先位置的重复读取；卸载后立即取消观察，隐藏时保留有效缓存。持续上滚测试从虚拟区中间开始，按每次真实输入距离验证位移，并覆盖滚动中收到旧页的情况，不能只在静止后检查最终位置。

宽屏网页与 Electron 在加载旧页前保留当前阅读窗口，新页提交时先渲染该窗口，再恢复精确位置，不先挂载新页顶端、下一帧再跳回。锚定期间不因程序滚动再次触发补载或底部跟随；请求尚在进行时，用户滚动会更新待保留位置，不能锁死旧窗口。“已处理”的承载行可能随补页移动，阅读锚点优先使用稳定的过程入口身份；窗口选择与未挂载目标定位都通过本页的入口归属找到新承载行，不能继续寻找已被收起过滤的旧记录。纯入口行使用该入口身份复用虚拟行高度，承载最终正文的行仍单独测量。只有入口本身仍在视口内时才优先以入口定位；入口已经离屏但同一行的最终正文仍可见时，以正文行记录阅读位置，不能跳过整行。回归逐帧检查补页过程，而不只等待最终位置恢复。

宽屏历史超过 32 条时启用部分虚拟化，最近常驻窗口以 12 条为基准，短回合可在额外 12 条范围内回退补齐用户边界，超长回合不能绕过上限。已折叠零高度过程不进入网页虚拟窗口；收起过程的正文、工具详情和图片组件不挂载，不先渲染再隐藏，但完整源记录仍参与回合归属和摘要计算并保留供展开使用。虚拟器的条目标识与高度估算回调保持稳定，滚动通知不强制同步提交整个 React 树，未变化的历史行复用渲染结果。原生端继续使用其既有倒置列表和窗口策略。

用户已经停在顶部时，继续上滚、触摸拖动或使用向上翻页键仍能触发加载，不依赖浏览器再次产生位置变化事件。若一页只有已折叠过程或已有工具的更新，画面几何可能不变；自动续页必须同时检查权威起始游标是否推进。同一游标、内容和几何不会因重复渲染无限重试，用户离开起点后停止自动续页。

“已处理”入口按未倒置的真实消息顺序选择承载行，比较最早过程和最终回复首块的位置；正文先到、收尾工具后到时，入口挂在正文首块之前，正文继续保持可见及正常高度。原生倒置只改变渲染顺序，不改变该判断。展开状态变化同时刷新承载正文的行缓存。

“已处理”的展开与收起使用入口自身的屏幕坐标作为短时阅读锚点，先退出底部跟随，不按最终回复或第一条可见消息定位。入口节点按回合身份登记，分页更换承载行后仍可测量同一入口。安卓倒置单元使用 `column-reverse`，入口与正文必须遵循相同的行内顺序；展开后，原来仅占一个单元的入口可能移动到很大的虚拟下标，需要先用新的条目下标恢复渲染窗口，再用真实入口坐标精确校正。目标尚未测量时，平均行高仅用于初步恢复窗口，不能作为最终定位结果，也不能通过关闭虚拟化或一次挂载全部工具来规避问题。原本不足一屏的倒置列表还需保留展开前必要的顶部空白，否则滚动范围无法把入口放回原位；该空间按真实历史起点测量，不随反复展开累加，点击到底部时清除。连续四帧稳定后释放锚点，最多保留八秒（首次展开上千项工具时需要恢复原生虚拟窗口，正常展开在稳定后立即结束）；用户主动滚动、切走标签或再次导航会立即取消旧校正。锚定期间暂停自动补页，结束后重新检查是否仍需补页。

桌面端的已完成过程会在渲染后折叠，因此最新尾页的源记录虽然很多，可见高度仍可能只剩一两个回合入口。如果折叠后的内容短到无法形成超过历史起点阈值的滚动范围，网页视口必须主动请求更早一页；每次内容几何实际变化后才允许继续请求，直到用户可以正常向上滚动或历史耗尽。相同内容与几何只能自动请求一次，避免失败时循环请求；点击索引和用户滚动仍可显式重试。

## 历史导航索引

导航正文与索引分开复用：客户端只在实际保存索引副本后，随下一次历史请求提交该副本的内容版本。服务端根据时间线代际和索引完整内容生成版本；版本一致时省略索引数组，仍返回正文分页。原位修正、清空和时间线替换都可使版本变化，不能仅用条数或末尾序号判定相同。客户端清空副本时同时清空版本。

网页端保留全部索引数据，只挂载可见刻度和邻近预渲染区；滚动、悬停和方向键跳转按全量索引位置计算，不能把窗口内下标当作历史位置。提供方消息标识可能重复，已有时间线位置时优先按位置区分刻度和匹配跳转目标，不按正文或标识删除旧历史。

## Durable item anchors

Provider message IDs are not guaranteed for every displayed item. Paseo-generated system errors are one example. Rendered item indices are not durable either because pagination and projection can merge source rows.

Actions that address a point in chat history, such as Fork, use the daemon timeline `epoch` plus the projected item's `seqEnd`. The app carries that position on the rendered assistant item for both live and fetched history. When adjacent projected chunks merge, the merged item retains the newer chunk's position.

The daemon validates that the epoch is current and the exact source sequence still exists before slicing rows. It slices before projection so later lifecycle updates cannot leak into the selected context.

## Resume behavior

### 运行时释放后的首次恢复

释放会话时先等待服务端该会话的排队写入，再移除规范时间线、持久存储内存文档与提供方子任务副本，磁盘记录不删除。
客户端同步移除正文、导航索引及其版本、游标、任务和权威历史标记，并立即取消该会话的实时订阅，不经过普通切换的 30 秒宽限。
服务端历史请求带本次加载的释放边界检查，等待关闭或读取记录后若已经发生释放，立即取消旧请求，不能在关闭后继续恢复进程。客户端释放前已发出的请求按请求身份失效；即使用户已重新进入，旧响应也不能覆盖新读取。初始化等待与计时器同时取消，旧请求失败不能拒绝新的初始化。排队中的实时事件与子任务列表、正文响应同样受释放边界约束。
仍显示着的面板停在已释放状态，焦点恢复和自动追赶不重启它；明确重新加载或切走后再次进入才重新订阅，并从无游标尾页开始。
草稿、待发送消息、会话身份与目录元数据保留。此行为不改变首次加载轮次目标、分页大小或并发调度。

### Codex 原生浏览页与执行运行时

支持 `native_history_pages` 的客户端先打开只读 app-server，用 `thread/read(includeTurns: false)`
确认原生历史格式，再通过 `thread/turns/list(itemsView: summary)` 读取最近 5 个原生回合。
后续上翻每次读取 20 个原生回合，按实际用户消息数量静默预取到配置目标；100 个原生回合
不等同于 100 用户轮。原生浏览响应携带线程身份、请求游标、下一页游标和回合摘要，不伪造
规范时间线序号。新字段存在于既有时间线响应的可选分支，规范条目数组为空。

首屏不等待目录、桌面工具、技能或原生执行恢复，也不读取 Paseo 整份持久快照作为浏览副本。
上翻继续原生游标，不等待全量扫描或转换。摘要包含原生用户消息、最终回复、状态、耗时和
错误；中途回复、工具和其他过程由 `agent.history.read_turn.request/response` 按回合独立读取，
每页最多 100 条。正文摘要达到配置用户轮数后，从近到远后台读完保留回合的过程详情，
每页让出主线程；手动上翻追加的回合同样继续补齐。主动展开可提前读取，与后台请求合并。
折叠中仅缓存原始条目，不挂载命令视图。已结束过程展开时，条目插入外层普通消息流，复用
既有命令概览或详细展示及外层虚拟化，不在入口组件内另建滚动列表。概览下的过程文字与
每段独立命令组按原顺序排列，命令组默认收起，单条命令详情仍独立展开；整轮入口不替代这些
层级。展开状态由时间线持有，入口虚拟卸载后不会丢失，切换读取身份后不沿用旧状态。
读取失败保留成功页及
原位错误，重试从未完成页继续。中断或失败没有最终回复时，读完过程会在折叠区外显示最后
一段真实说明。入口统一显示“用时”与 h、m、s 英文短单位，不把“已中断”作为前端标题；
中断、失败等原生终态仍保留，真实错误继续显示。不补造未知耗时或操作时间。
旧子智能体在读取对应过程中的派发工具后进入轨道；主动查看子轨道正文或生成完整
分叉上下文时按需读取完整规范历史，隐藏的子轨道列表不触发整段后台扫描。

运行中回合的过程标记仅作读取元数据，不渲染“处理中”标题、折叠入口或内部固定高度视口。
最新页可读后立即优先补齐当前轮已发生的过程，不等待全部配置旧轮次；这些消息和命令进入
普通对话流，由外层虚拟列表负责窗口。原生摘要、当前轮详情与实时记录按原生消息和调用标识
认领，同一段实时正文只显示一次；详情可补齐同一消息尚未投递的前缀，旧快照不能截短已增长的
正文。快照中没有对应实时记录的工具直接补入，已有实时调用继续以规范增量为准。当前轮结束后
才采用历史过程折叠规则。活动过程读取失败显示在消息流中，重新打开会话可重试。

客户端按原生消息身份更新局部页，未变化行复用对象；回退后删除旧尾部，无重叠时重新连续
补载，不能跨过缺口。客户端内存裁剪后的边界页允许重读，重复或迟到的前插页需匹配当前游标。
滚动和自动预取的相同请求按规范化的字段键合并，不依赖对象字段的序列化顺序。
原有行高与前插锚点保护继续使用；详情缓存与用户轮次一起裁剪，并在会话释放、移除主机时
清除。虚拟行临时卸载不丢弃已读数据，不再导致重新展开时重复读取。

原生浏览页与实时区按同一顺序核对，不能把历史尾部和活动区分开清理。原生摘要中的
`clientMessageId` 会确认待发送登记并替换对应用户卡片；只保留正文未变时的本地图片副本，
另一客户端改写后的正文继续以原生记录为准。回退或清空线程时，移除读取开始前已确认且
被原生删除的整组旧用户消息和回复；尚未确认的输入、活动回合，以及读取开始后才收到的
实时事件继续保留，不按文本相同猜测同一消息。

返回原生会话时先读完规范游标之后的全部增量，再核对一页最新原生摘要；空增量不能证明
另一客户端没有改写原生历史。读取期间收到完成、中断或失败通知会合并为一次后续核对，
在当前预取页结束后优先执行，不等待全部旧轮次。过程缓存修订包含状态、时间、错误和
摘要正文；最新摘要页覆盖的过程还会在后台重新验证，因为中断前的说明不一定出现在摘要中。
重新验证只针对该最新页，不反复扫描全部旧会话；原有完整过程保留到新结果读完再替换。
失败保留当前显示并在展开区提供重试。每次新的核对都会使旧过程请求失效，迟到结果不能
把已改写或回退的说明恢复回来。

回归覆盖以隔离副本中的原生分页和回退接口为依据，另用副本注入“标识不变、只改正文或
过程”的情况；生产原文件只读，私有数据库修改仅用于副本故障注入，不能成为产品读取路径。
确定性测试保留匿名样例，原始会话正文不进入 Git。真实浏览器同时核对重复卡片、改写后的
中断说明、展开工具以及外部回退后旧尾部消失，不以请求成功作为显示正确的依据。

发送时由提供方执行准备屏障恢复原生上下文及工具；发送无需先把历史过程完整复制给 Paseo。
首次实际写入时才读取本地已提交序号并接续，不让只读新运行从序号 1 覆盖旧正文；
浏览和上翻不触发这一步。原生未提供时间的消息不显示虚构日期或推算耗时。
需要完整规范历史的读取和旧协议请求会按需核对完整原生记录，复用同一个待提交操作；
完整磁盘提交成功前不替换内存规范版本。摘要页不写入完整快照，不得触发已读整段历史重建。
归档会话的纯浏览不取消原生归档，主动恢复保留现有取消归档语义。显式释放关闭所属连接，
运行时读取守卫隔离迟到响应，不能用保留已释放进程来换取下一次打开速度。

`legacy` 是原生存储格式限制，继续读取其原生完整历史。未声明新能力的既有客户端保留
上一代 `progressive_agent_history` 路径：原生最新详细页先显示，其余全量历史后台核对并做
位置映射；发送等依赖完整历史的操作等待同一次核对。分页错误不静默回退到 legacy 接口。

When a client resumes with a known cursor, it catches up after that cursor to completion. It does not replace the view with a latest tail page, because tail pagination can skip the middle of a long background run.

When a client resumes without a cursor, it fetches the latest tail page.

### 手动重新加载与回退

手动重载与普通历史补载共享同一会话的恢复等待边界；同样的重载请求合并，配置不同的重载和
会话回退通过管理器已有的会话变更队列串行执行。加载请求以管理器实例隔离，不把不同主机的
同名会话合并。Codex 必须先释放旧写入者再恢复同一原生线程。

重载 RPC 只在官方最新历史完整读取并提交后成功。具备替换通知能力的客户端不再接收全历史
逐条实时重放；发起方共用初始化入口，只拉取 40 项最新尾页并携带当时最新的本地游标，旧代际
由权威响应重置。其他订阅者收到一次替换通知后走既有分页同步，未订阅客户端不接收通知；
旧客户端继续按原协议接收完整重放。历史读取或提交失败时释放此次运行时、返回真实错误，
不发送替换成功通知，下一次操作可重新恢复。

Codex 分页回退优先使用完整原生历史提供的消息到回合映射，客户端消息别名与原生消息标识
指向同一回合；映射缺失时逐页读取原生条目查找，每页最多 100 项，不把缓存中的界面序号当作
原生回合。回退结果中的回合和正文反向游标分别用于读取无正文回合头和跨回合正文，两个游标链并发推进；回退响应已经生成的完整保留快照会直接交给权威时间线提交，不再紧接着从原生会话全量读取第二遍。两个流
全部成功后合并去重并恢复时间顺序。空游标表示该流没有保留记录，不能启动最新页读取。
回退后重建映射；分页错误、未知回合和游标循环明确失败，不重试原生回退或改写提供方数据库。

应用重新获得焦点后，在开始任一补载路径前，客户端会同步排空已经收到但仍在本地归并队列中的
实时事件。浏览器或操作系统挂起后台任务时，队列的短时归并定时器可能被无限期延迟；如果继续
把它视为已经安排，后续事件就无法安排新的刷新。排空完成后再执行权威拉取，此时拉取逻辑可以
读取更新后的本地游标，只请求仍然缺失的内容。

已经持有权威历史的 `closed` 会话再次进入可见面板时仍必须执行增量初始化，因为这次请求还负责
恢复提供方运行时，不能因本地已有历史而提前返回。使用选择性投递的连接发送消息时，守护进程
会在启动回合之前把目标会话加入该发送连接的时间线投递集合；这样即使界面的可见订阅请求仍在
传输中，用户消息、工具过程和最终回复也不会从实时通道漏掉。之后客户端的正常可见集合更新仍
负责在离开会话时移除该订阅。

恢复 Codex 提供方历史时，一条完整助手消息可能对应规范时间线中多条连续的实时片段，而且两边
使用不同的消息标识。历史对齐必须按连续片段合并后的正文识别同一消息，并忽略实时显示专用的
助手消息分界线；匹配后保留实时记录原有的回合归属和片段位置，不能再追加一条提供方完整消息。
如果旧版本已经在同一用户回合内留下标识相同但没有回合归属的提供方副本，下一次对齐应删除该
副本并把修正后的时间线重新持久化。

历史对齐先认领全部提供方匹配项，按提供方顺序输出时，未到输出位置的已认领规范行不能再当作未匹配前缀插入；多片段助手消息仍逐片保留原回合与位置。重新对齐只清理可由同一提交身份、完整字段或同回合的原生完整消息标识与时间共同证明的旧副本，不按正文相同删除真正的重复发言。

历史对齐在单次操作内建立用户身份候选、结构候选、助手连续片段分组和用户边界索引，避免每条提供方消息都扫描全部规范记录或重新拼接助手正文。候选仍按原有顺序匹配，保留重复用户文本、完整元数据、回合归属与既有副本清理规则；优化不改变官方历史读取与完整快照提交的先后关系。

## Client replica lifetime

The host runtime owns each session replica for as long as the host remains registered. React
providers attach message handlers and UI integrations to that replica, but mounting or unmounting a
provider must not create or clear it. A provider can remount during Fast Refresh or ordinary UI
recomposition while the runtime still owns the same directory snapshot and timeline cursors.

Removing the host from the registry is the destructive boundary: it stops the runtime and clears the
session and host-scoped setup state together.

## Selective and legacy delivery

The app chooses one delivery policy from `server_info.features.selectiveAgentTimeline`:

- 选择性投递的守护进程接收所有面板可见会话的并集，新增会话立即订阅并补载。任何由可见性
  引起的移除都保留 30 秒订阅宽限，避免短暂切换标签、面板、路由或应用时反复退订和补载。
  初始化和运行中会话即使没有可见面板也始终保留订阅，停止后再应用同一宽限期。窗口失去键盘焦点不会让
  已选面板变为不可见；断开连接或销毁同步器会清除待执行的宽限期，因为此时订阅本身已不存在。面板重新可见时，
  即使仍在宽限期内，也必须从本地游标执行权威增量补载；应用重新聚焦时对当前可见和运行中会话执行同样的核对。
  实时投递仍是快速路径，权威补载则保证偶发丢失的事件不会让已完成会话永久停留在旧记录。
- Legacy daemons keep globally streaming agent timelines. Visibility still triggers the existing
  authoritative catch-up, but the app does not issue selective-subscription RPCs.

This policy is owned by `viewed-timeline-sync.ts`; downstream reducers do not branch on daemon
version.

## Projected pages reconcile with live presentation

A projected page is canonical state, not a sequence of live deltas.

向前补页按完整投影身份归并：工具以提供方、原生回合和调用标识认领，用户消息以客户端提交标识认领，其余记录按权威时间线位置认领。跨页工具快照只保留一条并归位至原始调用位置，不把两个独立助手回复按相邻文本拼接。分页水合会避开已挂载条目的渲染身份；提供方消息标识可重复，不能让布局索引、React 键或虚拟行测量缓存覆盖另一条消息。相同正文但不同提交的用户消息继续保留。

One projected item can overlap
rows already received live—for example, a tool call retained at its original display position while
its completion advances `seqEnd`, followed by a merged assistant message. The app uses
`sourceSeqRanges` to replace overlapping assistant and reasoning projections before applying the
remaining page through the existing stream reducer. It must not append full projected text to a
live prefix.

流式助手正文按 Markdown 块拆分或被完整投影替换时，每块仍保留同一回合身份和同步位置。
补载只能按消息身份认领正在输出的回复；不同消息即使正文前缀相同也不能相互替换。
没有原生消息标识的独立图片同样要避开历史区和活动区已有的展示标识，不能因为同一毫秒
返回相同路径就丢掉一条记录。来自其他客户端的纯图片用户消息不依赖本地乐观卡片，也不
要求有非空文字才能进入实时区。

开始、完成、失败与中断通知在协议解析后保留提供方回合标识。结束通知只收束自己的流式区，
旧回合迟到的通知不提交新回合正文，也不覆盖新一轮的运行状态。没有回合标识的旧协议通知
继续使用已有行为，但比当前目录快照更早的终态不能倒写该快照；同一明确活动回合的真实终态
仍可立即结束显示，不等待下一条命令或下一条回复。

Optimistic user prompts occupy stable timeline slots. Catch-up never extracts, delays, or reinserts
them. A canonical user row replaces its matching slot in place; an unmatched prompt stays exactly
where the user submitted it. Other canonical rows are applied after the already-present timeline
instead of relocating visible user messages around newly fetched history.

Canonical submitted user rows carry the provider's `messageId` and Paseo's optional
`clientMessageId`. Clients reconcile optimistic prompts by `clientMessageId`. Content matching is
limited to the dated compatibility path for daemon timelines created before that field existed.

自动队列发送与普通消息共用客户端提交登记，以排队消息标识作为 `clientMessageId` 保存本地图片元数据，再提交编码图片；权威用户记录到达时在原位置核对，不丢掉图片预览。

定时消息由主机的 `ScheduledAgentMessages` 保存到 `scheduled-messages`，图片先保存为主机文件。到期派发使用普通回合入口，但禁止替换正在运行的回合；图片路径通过用户消息时间线登记，不依赖已关闭页面的乐观记录。恢复时保留逾期待发送项，发送中发生重启则显示明确错误而不是自动重发。定时消息接口位于 `agent.message.schedule.*` 与 `agent.message.schedules.list.*`，客户端通过 `scheduledAgentMessages` 能力声明启用。

无提供方消息标识的独立图片结果不能与相邻助手正文拼接。实时头部切换、尾部续接和历史重建遵循相同的图片边界；同一消息标识下的普通流式 Markdown 仍正常拼接。纯图片消息包含多张图片时，客户端逐张显示可折叠缩略图，不回退为铺满正文的普通图片。

助手图片的本地副本由预览查询持有引用，附件清理同时收集正在读取和已经缓存的预览标识；查询释放后副本可正常回收。重新挂载或主机重新连接时重新读取历史源文件，系统清理缓存不会使旧查询永久指向失效副本。预览 URL 按附件版本隔离，切换元数据时不向新图片返回已撤销的旧 Blob URL。原图确已删除时显示读取失败并允许重试，不伪造图片或吞掉错误。

## Relevant code

- Server live stream forwarding: `packages/server/src/server/session.ts`
- App sync planning: `packages/app/src/timeline/timeline-sync-plan.ts`
- App viewed-agent synchronization: `packages/app/src/timeline/viewed-timeline-sync.ts`
- App stream/timeline reducer: `packages/app/src/timeline/session-stream-reducers.ts`
- Session wiring: `packages/app/src/contexts/session-context.tsx`

## 工具结束状态的展示边界

- 原生历史快照可能只有调用标识，没有 Paseo 回合标识。投影时同一调用一侧缺少回合标识不等于两次调用；合并时保留明确的回合身份。双方回合均明确且不同才隔离，新的回合索引必须继续接收自己的结束结果，不能永远指向最早的同名调用。
- 命令和压缩的实时归并必须更新目标行的同步位置与回合归属，不只更新文字或状态，也不能把迟到结果的回合标识写到列表最后一行。压缩开始和结束按回合合并成一条投影，保留实际来源序号；补页按来源范围认领原有加载行，避免重新追加旧的“正在压缩”。
- 同一命令的迟到运行中快照不得覆盖已收到的终态，缺字段的 Shell 快照继续保留已收到输出和退出码。
- 已结束回合在最终回复后才收到的遗漏命令完成记录按同一回合身份放回最终回复之前；活动回合不改写说明文字与后续命令的真实顺序。
- 前端以当前原生回合和实际退出码约束运行中动效；已结束回合中缺少结束结果的工具停止动画并明确显示结果缺失，不伪造成功或补造输出。概览分组与展开详情采用相同判断，steer 仍属于原生活动回合。
