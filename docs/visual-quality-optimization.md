# Paseo 前端视觉质感优化建议

> **状态：第一批已实施（2026-10-14）。** 已落地 M1 动效 token、M2 按压缩放、M4 tabular-nums、M9 浮层时长对齐、Claude 主题暖色对齐（M3 输入框双层环落地后按实测回退外环，只保留边框与投影加深），详见 [fork-features.md](fork-features.md) 第 29 条与 [design.md](design.md) §15。未实施：M5 骨架屏 shimmer（需要渐变能力，依赖不在仓库内）、M6/M7 流式与消息入场（需要"仅实时播放"标记机制）、M8、E 系列。落地任何条目时需同步维护 [design.md](design.md)（新 token 与规范）与 [fork-features.md](fork-features.md)（产品行为变化）。
>
> 研究日期：2026-10-14。研究资料（站点源码副本、17 个 story × 明暗共 34 张截图、Playwright 抓取脚本）在本地 `.dev/storybook-research/` 与 `.dev/sb-tools/`，不入库。

## 1. 研究对象与方法

claude-storybook 是单页 Storybook（自述 "REA Extracted Tokens / 100% Fidelity"），逆向自 Claude.app 桌面端，分三部分：

- **Foundations**：Colors & Surfaces、Border Radius、Heights & Sizing、Shadows & Elevation、Typography & Align、Icons & Glyphs、Motion Tokens
- **Components**：Chat Composer、Message Bubbles、Thinking Accordion、Buttons & Controls、Segmented Control、Attachment Tiles、Code Block & Copy
- **Motion Lab**：Grapheme Reveal、Thinking Quiet Dots、Spring Physics Presets

方法：读取站点完整源码（含全部 `<style>` 块与每个 story 的 JSX）、Playwright 全量截图、与 Paseo 现有实现逐项对照。

## 2. Claude Desktop 观感的五个成因

1. **表面明度阶梯 + 暖中性灰。** 四层表面从页面底 `#0b0b0a` 到浮层 `#20201e`，从不使用纯黑；灰阶带轻微暖调；分隔与描边用极低对比的内阴影环（inset ring），而不是高对比边框。
2. **品牌色极度克制。** 陶土色 Clay（`#d97757`）只出现在用户动作与关键强调（发送钮、选中段、思考点），其余全部是灰阶。
3. **动效被 token 化且有性格。** 五档时长（60/120/200/300/450ms）、三条标准曲线（减速 / 咬合 / 超调）、四个弹簧预设；入场普遍带轻微过冲或模糊消解，而不是单调淡入。
4. **内容出现有节奏。** 流式文字按字素 blur 消解 + 级联；新时间线块 blur 入场；等待状态是 1.9s 周期的安静三点波，而不是转圈 spinner。
5. **排版细节堆叠。** 行内图标 -0.125em 基线对齐、tabular-nums、`text-wrap: balance/pretty`、暗色光学字重补偿——单项极小，叠加构成精致感。

## 3. Paseo 现状对照

| 维度            | Claude Desktop                                 | Paseo 现状                                                                                                       | 判定                     |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 动效 token      | 5 档时长 + 3 曲线 + 4 弹簧预设                 | `theme.ts` 无 motion token；时长硬编码散落（toast 140ms、dropdown 150/100ms、switch 180ms、composer 边框 200ms） | 缺口                     |
| 按压反馈        | `active:scale-95`                              | Button 按压 = `opacity 0.85`（button.tsx）；expandTogglePressed 0.8                                              | 缺口                     |
| 消息入场        | 用户气泡 450ms 过冲弹入；助手块 1.1s fade-up   | 无入场动画；消息流仅滚动指示器有 entering（view.tsx:1454）                                                       | 缺口                     |
| 流式文字        | 字素 blur(6px) 消解 + 级联                     | 已有完整节奏系统（text-reveal.ts + use-revealed-text.ts），字符是"出现"而非"消解"                                | 半缺口                   |
| 时间线块入场    | timeline-block-enter（blur + 上移 + 缩放入场） | 无                                                                                                               | 缺口                     |
| 等待指示        | 1.9s 三点波（3px，Clay）                       | SyncedLoader 6 点同步点阵（共享时钟；turn-footer、侧栏、标签共用）                                               | 差异，品牌化保留         |
| 输入框          | 双层环阴影（环境影 + inset 发丝环），聚焦加深  | surface2 + 1px 边框 + border-color 200ms 过渡（input.tsx inputWrapper）                                          | 可增强                   |
| 浮层阴影        | 双环（inset ring + 环境影）                    | shadow.sm/md/lg 令牌，十余处浮层使用                                                                             | 已有，参数可对齐         |
| 数字对齐        | 全面 tabular-nums                              | 仅个别处（turn-footer 耗时、dictation-controls）                                                                 | 缺口                     |
| 行内图标基线    | -0.125em                                       | 全仓 0 处 verticalAlign                                                                                          | 小缺口（web）            |
| 骨架屏          | shimmer 扫光                                   | opacity 脉冲（activity-skeleton、sidebar-agent-list-skeleton）                                                   | 可增强                   |
| reduced-motion  | —                                              | 仅 synced-loader.tsx 1 个文件处理                                                                                | 缺口（新增动画必须覆盖） |
| 长词换行        | overflow-wrap: anywhere                        | 用户气泡已有（message.tsx bubble text）                                                                          | 已对齐                   |
| 圆角 / 高度阶梯 | 4.7–20px / 20–48px                             | BORDER_RADIUS + control-geometry 自成体系                                                                        | 已对齐（体系不同但自洽） |

## 4. 建议清单

### 4.1 第一优先（高收益、低风险）

#### M1 动效 token 化：新建 `packages/app/src/styles/motion.ts`

现状：动画时长与曲线以字面量散落在 6 个文件（message.tsx、toast-host.tsx、switch.tsx、mobile-panels/provider.tsx、volume-meter.tsx、startup-splash-screen.tsx），无法统一调整、无法整体降级。

建议：建立纯常量模块（不依赖 theme，不影响 Unistyles 规则），对齐 CDS 的五档时长、三条曲线与弹簧预设：

- 时长：`instant 60` / `fast 120` / `base 200` / `slow 300` / `reveal 450`（毫秒）
- 曲线（Reanimated `Easing.bezier` 与 web CSS 字符串各一份）：
  - `standard` `cubic-bezier(.165,.84,.44,1)` 平滑减速（近似 easeOutQuart）
  - `snap` `cubic-bezier(.32,.72,0,1)` 快速启动、果断咬合到位
  - `overshoot` `cubic-bezier(.34,1.3,.64,1)` 1.3 倍轻微超调
- 弹簧（Reanimated `withSpring` 参数，mass 均为 1，drag 除外）：
  - `press` stiffness 600 / damping 30
  - `card` stiffness 320 / damping 28
  - `bouncy` stiffness 380 / damping 18
  - `drag` stiffness 1200 / damping 80 / mass 0.1

迁移现有硬编码：toast 140 → fast、dropdown 入场 150 → fast、dropdown 退出 100 → instant、switch 180 → base、composer 边框过渡 200ms → base + standard。

验收：动画语境下全仓硬编码时长清零（rg 抽查，白名单除外）。

#### M2 按压反馈：Button 由透明度改为缩放

CDS 全部按钮按压为 `scale 0.95`；Paseo 用 `opacity 0.85`，观感是"变淡"而不是"被按下"。

建议：

- button.tsx 按压分支改为 `transform: [{ scale }]`：常规按钮 0.96，小圆形图标钮（28px 及以下）0.95；可叠加轻微透明度（0.9），不要两个都大幅变化
- 波及点：button.tsx 全变体、input.tsx 的 attach / voice / send、message.tsx 的 expandTogglePressed，以及其余 opacity 按压样式
- 实现：RN `Pressable` style 回调直接返回 transform，无需 Reanimated；transform 不触发布局，无性能风险

#### M3 输入框双层环（Composer）

CDS composer 的高级感主要来自阴影结构而非颜色：

- 常态：`0 0.25rem 1.25rem rgba(0,0,0,0.035)`（极淡环境影）+ `inset 0 0 0 1px rgba(0,0,0,0.08)`（发丝内环）
- 聚焦：环境影加深至 0.075，内环加深至 0.16，并追加 `0 0 0 1px rgba(0,0,0,0.16)` 外环——聚焦是"咬合加深"，不是换颜色

建议 Paseo 输入框（input.tsx `inputWrapper`）从"surface2 + 1px 边框"升级为同构双层环：

- web / Electron：直接用 `boxShadow` 字符串；深色主题把中性黑换算为低透明度白（内环约 `rgba(255,255,255,0.06~0.10)`）
- native：RN 不支持 inset shadow，用"边框色 + 外环境影（shadow.sm）+ 聚焦时边框加深"近似
- 聚焦不要用 accent 蓝描边（CDS 用中性加深，更安静）；若想要品牌感，可用 accent 低透明度叠加
- 保留现有 200ms border-color 过渡，曲线换 `standard`

#### M4 tabular-nums 全面化

现状仅个别处（turn-footer 耗时、dictation-controls）。建议补到所有"会变化的数字"：diff 的 +/- 行数、提交 / PR 编号与计数、耗时与时间戳、token / 上下文用量、文件大小、下载进度。做法：提供共享文本样式片段（`fontVariant: ["tabular-nums"]`），逐个读数处接入。

#### M5 骨架屏 shimmer 扫光

两处 skeleton 目前是 opacity 脉冲；CDS 是 `translateX(-100% → 100%)` 扫光。建议升级：web 用 CSS keyframes（仓库已有 history-index.css 的 CSS 动画先例），native 用 Reanimated `withRepeat`；周期 1.2–1.4s；reduced-motion 时回退为 opacity 脉冲。

### 4.2 第二优先（需要少量新机制）

#### M6 流式时间线块入场（timeline-block-enter 移植）

新出现的 stream item（工具调用行、思考行、助手新块）在**实时到达**时播放入场：`blur(4px) + translateY(5px) + scale(0.9)` 消解到正常，前 30% 保持不可见，曲线 `cubic-bezier(.22,1,.36,1)`（easeOutQuint）；时长建议 `slow 300` 档。

关键机制（必须做对）：只在实时追加时播放。历史加载、分页、重连快照、虚拟列表回收后重挂载一律不重放。实现建议：在 agent-stream 的 item 组装层给"实时新增"打瞬态标记（客户端侧），渲染层消费后清除；复用仓库已有 Reanimated `Keyframe` 先例（dropdown-menu.tsx 的 contentEntering）。

- web：完整 blur 版本
- native：RN 无 filter，用 translateY + scale + opacity 近似
- 风险点：与 web 虚拟列表实现组合需验证；只对"运行时新增"生效

#### M7 消息入场微弹

- 用户消息：发送后 `scale(0.92 → 1) + translateY(6 → 0)`，450ms，`cubic-bezier(.34,1.3,.64,1)`（CDS code-user-bubble-enter 精确参数）
- 助手首块：fade-up（translateY 10 → 0 + opacity）；CDS 原值 1.1s 偏长，建议收敛到 450–600ms
- 同样受 M6 的"仅实时播放"约束；用户消息天然满足（发送动作触发），历史恢复不重放
- 不要对正在流式增长的同一块反复播放，只在块首次出现时

#### M8 等待指示器：quiet dots 变体（可选品味项）

SyncedLoader（6 点、共享时钟、多表面同步）是 Paseo 的品牌资产，不建议替换。建议为最安静的"等待首 token / 思考中"阶段提供一个 quiet 变体，或让现有 loader 在该阶段采用 CDS 三点波参数：3 点、3px、1.9s 周期、0.15s 错相、`cubic-bezier(.4,0,.2,1)`、y 轴 ±2.5px 浮动、颜色用 foregroundMuted 或 accent。

#### M9 浮层曲线对齐

dropdown-menu 现为 150ms + scale(0.97) 入场、100ms 退出，方向正确；把曲线换成 `snap`（"果断咬合"正是它的性格），退出换 `instant`；tooltip / combobox / context-menu / hover-card 同源参数一并统一到 motion token。

### 4.3 实验项（先验证再推广）

#### E1 流式文字消解（web / Electron 限定）

CDS 做法：每字素 `blur(6px) → 0 + opacity 0 → 1`，90ms `cubic-bezier(.215,.61,.355,1)`，级联步进可调（实验室默认约 30ms/字素）。Paseo 已有切片式 reveal（text-reveal.ts），可只对"新出现的尾部切片"加 CSS 动画。冲突点：消息是 Markdown 渲染，逐字素 span 只适用于"尚未成结构的纯文本段落"；进入代码块 / 列表后停用。性能预算：每帧动画字素上限（建议 ≤120），reduced-motion 关闭；native 不做。若验证成本过高，只保留 M6 的块级入场即可获得大部分收益。

#### E2 行内图标基线（web）

提供对齐 helper（文本内联图标 `verticalAlign: -0.125em`，caption 级 `-0.075em`），先用于 turn-footer、耗时行、状态行。native 上 Row + alignItems: center 已足够，不引入。

#### E3 助手 byline（需产品决策）

CDS 每条助手消息带 "✦ Claude" 小标签；Paseo 消息流内无提供方标识（已 grep 确认）。Paseo 支持 5 个提供方，若在多提供方 / 多智能体会话中需要归属感，可在助手消息组首块上方加一行 muted xs 标签（提供方图标 + 名称）。是否显示（始终 / 仅混合会话）是产品决策。

#### E4 SegmentedControl 滑动胶囊变体

Paseo 选中段是 foreground 实心块（对比强、重量感重）；CDS 是浅轨道 + 滑动胶囊（轻）。建议不改全局语义，仅为"视图切换"类新增 `variant="pill"`：999px 轨道、2px 内边距、绝对定位 thumb + 150ms `snap` 缓动。RN 实现用 onLayout 测量 + translateX，注意 floating-panels.md 记录的双重测量闪烁教训。

#### E5 微反馈杂项（低优先）

- click-ring：图标钮点击时短暂 ring 外扩（opacity 0.95 → 0，scale 0.22 → 1）
- byline-sent-bump：发送瞬间标签 scale 1.05 脉冲（50% 处）
- file-thumbnail-grow-in（0.25s，`cubic-bezier(.165,.84,.44,1)`）与 saved-check-decay：附件缩略图入场与"已复制"对勾淡出，可参考 CDS 参数

### 4.4 不建议照搬

| CDS 做法                                  | 不照搬原因                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Clay 陶土色 / 整体暖灰色相                | 二开品牌是 #0169CC 蓝 + 多主题体系，色相不动；只借"强调色仅用于用户动作"的克制原则 |
| Inter / Newsreader 字体、暗色光学字重补偿 | Paseo 有独立外观 / 字体设置体系；可变字体 wght 轴跨平台不可靠                      |
| Phosphor 图标、容器查询、999px 药丸全局化 | 分别与 lucide 体系、RN 平台能力、现有圆角体系冲突                                  |
| 20px 输入框圆角                           | 二开已定 16px 圆角 + 24px 圆形按钮体系，不为单点对齐改体系                         |
| 全量逐字素动画                            | 性能与 Markdown 冲突（见 E1），只做尾部切片实验                                    |

### 4.5 落地顺序建议

M1（token 地基）→ M2 / M4 / M5（便宜的高频收益）→ M3（输入框，用户注视最久的表面）→ M6 / M7（共用"仅实时播放"机制，一起做）→ M9 → E 系列按验证结果推广。

## 5. 实施约束（所有条目的公共要求）

1. **Unistyles**：禁止 `useUnistyles()`；动画只动 transform / opacity（web 加 filter）；主题色经 `withUnistyles` 叶节点或 inline 传入；遵循 [unistyles.md](unistyles.md) 的 Reanimated 崩溃边界（不要在 Reanimated `Animated.View` 上套 `StyleSheet.create((theme))` 的动态样式）。
2. **reduced-motion**：所有新增动画接入 `useReducedMotion` / `AccessibilityInfo` 降级（目前仅 synced-loader 有先例，属现状缺口）。
3. **虚拟列表**：M6 / M7 的"仅实时播放"标记机制是硬要求；历史 / 分页 / 重连不重放。
4. **性能**：动画只允许合成属性；隐藏面板（mobile-panels）不运行；流式动画不得进入每帧 O(全消息) 的路径（复用 text-reveal 的切片思路）。
5. **协议无关**：本文全部为客户端视觉改动，不涉及 WebSocket 协议与守护进程，不受协议兼容规则约束。
6. **流程**：每项落地后跑 `npm run typecheck` + `npm run lint` + `npm run format`；行为变化记入 [fork-features.md](fork-features.md)；新 token / 规范记入 [design.md](design.md)。

## 6. 验收方式

- M1：动画语境硬编码时长清零（rg 抽查）
- M2：真机按压慢放观察 scale 生效；键盘 / 无障碍路径不受影响
- M3：明暗两主题下输入框常态 / 聚焦截屏对照
- M6 / M7：历史恢复与分页滚动无重放（录屏验证）；长时间运行无内存增长
- M4 / M5：抽查 10 处读数与两处骨架屏
- 全量：iOS + Android 各 1 台真机、Electron、web 四端走查
- 建议做法：仿照 `.dev/storybook-research/` 的抓取方式，为 Paseo 做一个临时组件状态对照页截屏（可选基础设施，不入库）

## 7. 附录：CDS 关键 token 速查

### 时长与曲线

| token                | 值                            | 用途                           |
| -------------------- | ----------------------------- | ------------------------------ |
| --cds-ease-out       | cubic-bezier(.165,.84,.44,1)  | 平滑减速（近似 easeOutQuart）  |
| --cds-ease-snap      | cubic-bezier(.32,.72,0,1)     | 快速启动、果断咬合             |
| --cds-ease-overshoot | cubic-bezier(.34,1.3,.64,1)   | 1.3 倍轻微超调                 |
| 时长档位             | 60 / 120 / 200 / 300 / 450 ms | 微交互 / 快 / 基础 / 慢 / 揭示 |

### 关键帧

| 名称                   | 参数                                                                   | 曲线                                     |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| \_grapheme-reveal      | opacity 0→1，blur 6px→0；90ms；级联默认约 30ms/字素                    | cubic-bezier(.215,.61,.355,1)            |
| timeline-block-enter   | opacity 0→1，blur 4px→0，translateY 5→0，scale .9→1；前 30% 保持不可见 | cubic-bezier(.22,1,.36,1)，随后 ease-out |
| message-fade-up        | translateY 10→0 + opacity；1.1s                                        | cubic-bezier(.34,1.56,.64,1)             |
| code-user-bubble-enter | scale .92 + translateY 6 → none；0.45s                                 | cubic-bezier(.34,1.3,.64,1)              |
| timeline-quiet-dot     | 3px 点（放大演示 8px）；1.9s 循环；错相 0.15s；y ±2.5px                | cubic-bezier(.4,0,.2,1)                  |
| thinking 折叠          | grid-template-rows 0fr→1fr；200ms                                      | cubic-bezier(.19,1,.22,1)                |
| cds-skeleton-sweep     | translateX -100%→100%                                                  | —                                        |
| file-thumbnail-grow-in | maxWidth 0→8rem，scale .8→1；0.25s                                     | cubic-bezier(.165,.84,.44,1)             |
| click-ring             | opacity .95→0，scale .22→1                                             | —                                        |
| byline-sent-bump       | 50% 处 scale 1.05                                                      | —                                        |

### 弹簧预设

| 名称   | 参数                                   |
| ------ | -------------------------------------- |
| Button | stiffness 600 / damping 30 / mass 1    |
| Card   | stiffness 320 / damping 28 / mass 1    |
| Bouncy | stiffness 380 / damping 18 / mass 1    |
| Drag   | stiffness 1200 / damping 80 / mass 0.1 |

### 阴影（双层环）

- 常态：`0 0.25rem 1.25rem rgba(0,0,0,.035), inset 0 0 0 1px rgba(0,0,0,.08)`
- 聚焦：`0 0.25rem 1.25rem rgba(0,0,0,.075), inset 0 0 0 1px rgba(0,0,0,.16), 0 0 0 1px rgba(0,0,0,.16)`

### 表面阶梯与品牌色

- 深色表面：#0b0b0a / #151515 / #1a1a19 / #20201e
- 浅色表面：#f5f5f3 / #fcfcfb / #ffffff / #ffffff
- Clay：主 #d97757 / 深 #cc5a36 / 浅底 #fbf3ef

### 组件速记

- Composer：圆角 20px，textarea 15px / 1.4 行高，发送钮 32px（圆角 8px）
- 用户气泡：浅色 #f0f4f8 / 深色 white 10%，圆角 18px，max-width 85%
- 按钮阶梯：XS 24 / SM 28 / MD 32（默认）/ LG 40；按压 scale .95
- Segmented：999px 轨道，2px 内边距，36px 高，150ms snap 滑块；254px 以下容器查询收缩
- 滚动条：6px，rgba(150,150,150,.25)，hover .4，圆角 999px
