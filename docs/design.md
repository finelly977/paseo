# Design

Tokens — every color, font size, weight, spacing step, radius, icon size — live in `packages/app/src/styles/theme.ts`.

---

## 1. Character

Paseo is minimal, spacious, quiet, confident. Whitespace is deliberate. Nothing crowds, nothing decorates, nothing apologizes. A row, a label, a control. That is the bar.

The app is calm so the user's work is not. Every visual decision serves either _act on this_ or _understand this_ — never _look at this_.

Consistency comes from component reuse, not from hand-matching styles across surfaces. A row in the projects list, a row in settings, and a row in a modal are the same component, not three implementations that happen to look alike. When two surfaces do the same semantic thing in two different ways, one of them is wrong.

---

## 2. Component reuse

A semantic element used in three or more places is a primitive. One of a kind is a screen.

Primitives live in `packages/app/src/components/ui/` and `packages/app/src/components/headers/`. Card and row layout live in `packages/app/src/styles/settings.ts`. Section structure lives in `packages/app/src/screens/settings/settings-section.tsx`.

A pressable styled to look like a button is wrong; the button is `<Button>` (`packages/app/src/components/ui/button.tsx`). A bare `<Text>` styled to look like a section header is wrong; the section header is `<SettingsSection>` (`packages/app/src/screens/settings/settings-section.tsx`). A custom `Modal` for a confirmation is wrong; the confirmation is `confirmDialog` (`packages/app/src/utils/confirm-dialog.ts`). A hand-rolled overflow menu is wrong; the menu is `<DropdownMenu>` (`packages/app/src/components/ui/dropdown-menu.tsx`). A hand-rolled status pill is wrong; the pill is `<StatusBadge>` (`packages/app/src/components/ui/status-badge.tsx`).

Before adding a new component, read `components/ui/`. The primitive usually exists.

---

## 3. Hierarchy

Hierarchy is conveyed through weight and color, not size. Most labels, titles, and hints across the app are `fontSize.base` or `fontSize.xs`. 设置项、设置分类及主机名称统一使用 `fontSize.sm`，默认 14 像素，与常驻工具界面的标签一致。 The distinction between a row's primary line and its secondary line is `foreground` versus `foregroundMuted`.

二开使用一套统一的界面与对话字号，默认值为 16 像素；“外观”设置中的界面字号会同步缩放标题、消息正文、输入框和常驻面板，不另设只对移动端生效的正文字号。用户显式选择的字号始终优先，代码字号继续独立配置。对话正文的一至六级 Markdown 标题统一使用 `fontSize.lg`（默认 18 像素）与半粗字重，行高为字号的 1.4 倍；段前后间距与分隔线保留层级，文件预览和紧凑工具详情继续沿用各自标题样式。

Weight has three tiers, applied by role:

- **Screen titles** — the title at the top of a screen — use `<ScreenTitle>` (`packages/app/src/components/headers/screen-title.tsx`), which renders `fontSize.base` at weight `400` on compact and `300` on desktop. Top-of-screen titles are lighter on desktop, not heavier. 二开宽屏工作区与新会话草稿由标签承载标题，顶部只保留导航与操作；紧凑布局继续显示标题。
- **Structural labels** use `fontWeight.medium`. This applies to section labels above a stack of rows (`packages/app/src/components/agent-list.tsx:519-523`, `packages/app/src/components/keyboard-shortcuts-dialog.tsx:63-67`), form field labels above an input inside a modal (`packages/app/src/components/add-host-modal.tsx:19-23`, `packages/app/src/components/pair-link-modal.tsx:24-28`), the title at the top of a modal/sheet/dialog (`packages/app/src/components/adaptive-modal-sheet.tsx:90-94`, `packages/app/src/components/ui/combobox.tsx:1607-1611`, `packages/app/src/components/welcome-screen.tsx:48-53`), action button labels in tight components such as the sidebar callout actions (`packages/app/src/components/sidebar-callout.tsx:218-221`), and inline data emphasis on dense metadata rows (`packages/app/src/components/git-diff-pane.tsx:2322-2327`, `packages/app/src/components/file-explorer-pane.tsx:1115-1122`).
- **Content** uses `fontWeight.normal`. This applies to settings rows (`packages/app/src/styles/settings.ts`), sidebar primary list-item titles (`packages/app/src/components/sidebar-workspace-list.tsx:2680-2686`, `packages/app/src/components/agent-list.tsx:572-578`), `<Button>` text (`packages/app/src/components/ui/button.tsx:80-84`), `<StatusBadge>` text (`packages/app/src/components/ui/status-badge.tsx:56-60`), and `<SidebarCallout>` titles (`packages/app/src/components/sidebar-callout.tsx:175-180`).

The rule, condensed: text that _names_ a surface or a group is `medium`. Text that lives _inside_ a surface or a group is `normal`. Top-of-screen titles are `<ScreenTitle>`, which is lighter still.

Foreground is for the thing being acted on: row titles, section headings, the selected sidebar item. `foregroundMuted` is for context: hints, descriptions, secondary metadata, placeholders, status text. 二开侧栏普通文字使用 `foregroundSidebar`，辅助文字沿用原有灰色。仅会话名称按选中状态区分：选中使用 `foregroundSidebar`，未选中以该色为基准向侧栏背景混合 6%，两者均不比工作区名称更亮；不通过整行透明度改变图标、状态、项目名称或选中背景，项目分组、状态分组与两种置顶保持一致。错误和警告保留语义颜色。

“外观 → 字体 → 文字亮度”按 70–150% 调整主前景色，100% 保留主题原配色；深色主题提高时趋向白色，浅色主题提高时趋向黑色。主前景的旧别名同步更新，辅助、强调和状态文字颜色不随之改变。每个主题保留未调整的 `baseForeground`，亮度始终从该基准计算；插件主题在构建时提供自己的基准。不得通过全页面透明度或滤镜实现，避免连带改变背景、图片与终端。

Mermaid 的内容尺寸以 SVG `viewBox` 为准，不能把首次测量容器的缩放边界缓存为图表尺寸。网页与移动端预览最高 480 像素，SVG 在预览内保持比例适配；网页缩放由外层视口统一负责，移动端放大查看允许图表按宽度展开并滚动。

Markdown 表格按整张表的可见内容估算各列需求，不均分列宽；短标签和数值列收窄，长说明列获取更多空间。表头和正文共用列宽，链接只计算可见文字，代码按可见内容计入；限制孤立超长地址对整列的影响。容器宽度及字号变化后重新分配；窄屏不足以保持可读列宽时仅表格横向滚动，不撑宽页面，不改变文本、代码、链接或复制内容。对话、文档预览和紧凑工具详情共用此规则。

`foregroundExtraMuted` is reserved for passive chrome that must sit behind muted text, such as an always-visible window control. Use the solid token instead of lowering SVG opacity; per-path opacity makes overlapping icon strokes render unevenly. Interactive hover and pressed states return to `foreground`.

Accent is the one CTA per surface. A `<Button variant="default">` filled with `accent` appears at most once on a page. Most pages have zero — settings is mostly toggles and text, the workspace pane is mostly content, the chat composer is the input itself.

二开输入框发送与停止按钮统一为 24 像素圆形，并使用黑白配色：暗色主题白底黑图标，亮色主题黑底白图标；停止图标及回合末尾复制、分叉图标为 12 像素，完成耗时文字为 11 像素。图标缩小不缩减原有点击范围。

Destructive is a color, not a click. Restart-daemon and remove-host are `<Button variant="outline">` in the row trailing slot; the destructive surface only appears inside the `confirmDialog` (`packages/app/src/screens/settings/host-page.tsx:541-547`). Workspace archive opens a confirm dialog before any red appears (`packages/app/src/components/sidebar-workspace-list.tsx`). Red appears after the user has indicated intent.

---

## 4. Buttons

The button is `<Button>` (`packages/app/src/components/ui/button.tsx`). It has five variants. Each has one job.

`default` is the one primary action on a surface — filled with `accent`. At most one per page. The primary slot inside an `<AdaptiveModalSheet>` and the highlighted action on the welcome screen are the canonical uses.

`secondary` is the paired action when two actions carry equal weight — filled with `surface3`. The component default is `secondary`, which matches its frequency in the codebase.

`outline` is the low-frequency action that lives on a row — transparent with `borderAccent`. Restart, Remove, Update on host detail (`packages/app/src/screens/settings/host-page.tsx:585-594`).

`ghost` is structural and non-committal — no border, no fill. Back arrows, header toggles, "Load more" footers (`packages/app/src/screens/sessions-screen.tsx:54-63`), more-affordances. Ghost is used when the affordance is part of the chrome, not a decision.

`destructive` is filled with `destructive`. It only appears inside a confirm. The button on the page is `outline`; the destructive button is the confirm button inside the dialog.

Sizes: `xs` for ultra-tight inline triggers. `sm` for any button sitting in a row. `md` is the page default. `lg` is reserved for large standalone CTAs.

Sizes are a shared contract across control kinds, defined once in `control-geometry.ts`: `xs` = 28px tall with `fontSize.xs` labels, `sm` = 32px with `fontSize.sm`, `md`/`lg` = 44px with `fontSize.sm`. `<SegmentedControl>` (`packages/app/src/components/ui/segmented-control.tsx`) takes the same `xs`/`sm`/`md` sizes — a segmented control next to a `<Button>` of the same size always matches in height, label size, and horizontal padding. Thin chrome such as the file toolbar uses `xs`; settings rows use `sm`. Never shrink a control's font or padding locally to fit a context — if the context needs a smaller control, the size tier is missing or the wrong one is in use.

A `<Pressable>` wrapping a `<Text>` is a sixth variant. It is wrong. `<Button>` accepts `style`, `textStyle`, `leftIcon`, `disabled`, `size`, and `variant`.

---

## 5. Borders

Borders group, separate, or rarely emphasize.

A logical block of related rows lives inside a card — one border around the whole group. The card primitive is `settingsStyles.card`; the keyboard-shortcuts dialog uses the same shape inline (`packages/app/src/components/keyboard-shortcuts-dialog.tsx:68-73`). The border defines what belongs together.

Rows after the first inside a card carry `settingsStyles.rowBorder` — a single top border. The first row never has one. The same divider pattern appears in the keyboard-shortcuts dialog rows (`packages/app/src/components/keyboard-shortcuts-dialog.tsx:74-83`). Rows do not need their own background to feel separated.

A list that is itself the page content — sidebar items in `sidebar-workspace-list.tsx`, the workspace list, the agent list (`packages/app/src/components/agent-list.tsx`) — uses spacing and surface, not borders, to separate items. Rows-in-a-card is an interior pattern; lists-as-pages are not.

Pane chrome — the workspace pane header, the file-explorer header, the diff pane header — uses a single bottom border to separate the header from the content (`packages/app/src/components/git-diff-pane.tsx:2328-2331`). One border, no shadow.

`borderAccent` is reserved for the outline button. Inputs use `border`. Single-thing borders are wrong; a single bordered element is either a card with one row (use the card) or it does not need a border.

---

## 6. Pickers

Five primitives. The pick is determined by option count, the need to search, and how the picker is anchored.

`<DropdownMenu>` is for a small fixed set anchored to a trigger. Theme picker, kebab menus on workspace and project rows (`packages/app/src/components/sidebar-workspace-list.tsx:684-770`), row "more" menus. Items can be async (`status: "pending"`) and can include destructive entries. Under ~10 options where the user knows what they're looking for.

`<Combobox>` is for a large or searchable list. Host switcher in the sidebar footer, model selector in the composer, branch switcher in the workspace header (`packages/app/src/components/branch-switcher.tsx`). The user types to find the option, or the list is long enough to scroll.

`<ContextMenu>` is for right-click and long-press on a target. The row is the trigger; there is no visible affordance. Used for incidental actions on workspace rows in the sidebar (`packages/app/src/components/sidebar-workspace-list.tsx`).

`<AdaptiveModalSheet>` is for a focused task. Multi-field forms (`packages/app/src/components/add-host-modal.tsx`, `packages/app/src/components/pair-link-modal.tsx`, `packages/app/src/components/project-picker-modal.tsx`), confirmations with detail, anything that earns a backdrop. Bottom sheet on compact, centered card on desktop. Raw `Modal` is wrong for any of these.

`<AdaptiveModalSheet>` owns compact bottom safe-area padding inside the sheet so the sheet background still reaches the screen bottom. If a sheet's first snap point is shorter than its header, content, and safe-area clearance, raise that snap point rather than moving the sheet container.

`confirmDialog` is for destructive yes/no and imperative confirmation. Promise-based: `await confirmDialog({ destructive: true, ... })`. Anything where a wrong click loses work.

Three themes is `DropdownMenu`. Thirty hosts is `Combobox`. A label and a value is `AdaptiveModalSheet`. "Are you sure?" is `confirmDialog`.

---

## 7. Density and rhythm

Settings detail pages, the projects detail page, and any list+detail content sit inside a centered, max-width 720 column (`packages/app/src/screens/settings-screen.tsx`, `packages/app/src/screens/projects-screen.tsx`). Lines stay readable, the eye does not have to track wide horizontal distances. Form modals carry their own narrower content frame (`packages/app/src/components/add-host-modal.tsx`).

Workspace and chat surfaces use the full width — these are working surfaces, not reading surfaces. The composer carries `MAX_CONTENT_WIDTH` from `packages/app/src/constants/layout.ts` to keep lines readable while letting the workspace pane fill the rest.

Sections sit apart. `<SettingsSection>` owns its own bottom margin; the next thing is wrapped in another `<SettingsSection>`. The agent-list `sectionHeading` carries the same `marginTop`/`marginBottom` rhythm (`packages/app/src/components/agent-list.tsx:511-517`). Adding `marginBottom` to a section is wrong.

Cards inside a section sit closer than sections. Rows inside a card touch — only the divider separates them. The rhythm is page → spacious; section → spacious; card → tight.

Rows have generous vertical padding: roughly 16px of content plus 16px of vertical padding for settings rows, 8–12px for sidebar list items where many rows must fit. Compressing rows below the established density to fit more on the screen is wrong. Too many rows means more cards or more sections, not smaller rows.

The whitespace is the design.

---

## 8. Responsiveness

Compact-first. The small case is designed; the large case adds chrome around it.

分类与详情沿用同一组组件；设置页与 Projects 仅在桌面外框上有所不同：

- On compact: full-screen list with `<BackHeader>` at the top. Tapping a row pushes a full-screen detail with its own `<BackHeader>` that returns to the list.
- 桌面设置使用 `<AdaptiveModalSheet>` 的居中浮层，最大宽度 1120 像素、高度上限 90%，分类侧栏为 240 像素，内容独立滚动；分类使用较深的 `surface0`，主体使用 `surfaceSidebar`，沿用 `<ScreenHeader>`、`<HeaderIconBadge>`、`<ScreenTitle>`，右上角提供关闭按钮。背景工作区包括已展开的 Explorer 保持可见，不重新获取路由焦点；关闭时保留阅读位置。Projects 继续使用原有的全屏 320 像素侧栏与详情布局。

The branching is one `useIsCompactFormFactor()` check at the top of the screen component. The list and the detail are the same components in both layouts; only the framing changes.

The workspace screen (`packages/app/src/screens/workspace/workspace-screen.tsx`) follows a different but parallel rule: tabs collapse on compact, panes split on desktop. The sidebar (`packages/app/src/components/left-sidebar.tsx`) is overlaid on compact and pinned on desktop.

窄桌面窗口依据实际工作面宽度决定是否显示应用侧栏：已展开的 Explorer 保留当前宽度及 400 像素中心目标宽度。设置浮层独立覆盖整个窗口，不再将其分类与详情宽度计入背景工作区的侧栏宽度预算。背景 Explorer 与专注模式继续参与工作区原有宽度计算，避免打开设置时改变后方布局。临时限制只影响渲染，放宽窗口后恢复用户保存的侧栏宽度，不另设紧凑断点。

Electron window controls are top-corner obstructions, not a compact-layout condition. Rendered surfaces declare which top corners they physically occupy; only those corners receive clearance. Full-window overlays redeclare both corners. A focused split pane owns both corners; if focus restoration temporarily exposes the full split tree, the split boundary reserves one top strip instead of assigning a control rectangle to an arbitrarily narrow leaf. The 720px desktop breakpoint preserves the default 320px sidebar and target 400px center width when the Explorer is closed; it is product policy, not an obstruction gate.

A new list+detail feature copies the settings shell. A new workspace-shaped feature copies the workspace shell. Inventing a third shape happens in design review, not in a PR.

---

## 9. Copy and voice

Sentence case. "Pair a device", "Danger zone", "Restart daemon", "Inject Paseo tools", "No sessions yet", "Load more". Proper nouns retain casing — Paseo, Beta, Stable, Local. Title case is wrong.

No trailing periods on row titles, labels, or buttons. No trailing period on a single-clause hint: "What happens when you press Enter while the agent is running" (`packages/app/src/screens/settings-screen.tsx:271-272`). Periods exist inside multi-sentence prose: "Restarts the daemon process. The app will reconnect automatically."

Empty-state strings are short noun phrases or short sentences: "No projects yet", "Select a project", "No sessions yet" (`packages/app/src/screens/sessions-screen.tsx:74-76`), "Host not found".

Buttons are imperative: Save, Cancel, Restart, Remove, Update, Install update, Add host, Load more. In-flight labels are present-participle with a literal three-dot ellipsis: "Saving...", "Restarting...", "Removing...", "Loading...".

Error copy is direct. "Unable to remove host" (`packages/app/src/screens/settings/host-page.tsx:697`), not "Sorry, we couldn't remove the host." Recovery instructions are concrete: "Wait for it to come online before restarting." Errors describe state; they do not editorialize.

Terminology:

- Workspace, never "checkout".
- Host, except where the user-facing concept is the daemon process itself ("Restart daemon").
- Project, not "repo" or "repository".
- Provider, not "model provider".
- Session and agent are distinct: a session is a historical entry in `sessions-screen.tsx`; an agent is a live entity in the workspace.

---

## 10. States

Loading is inline by default. `<LoadingSpinner size={14} color={foregroundMuted} />` sits next to the thing it relates to (`packages/app/src/screens/settings/providers-section.tsx:227-231`). Page-level loading is a centered `<LoadingSpinner size="large">` (`packages/app/src/screens/sessions-screen.tsx:69-72`). Card-level loading is a single short line, not a spinner. In-row dropdown items use `<DropdownMenuItem status="pending" pendingLabel="Removing...">`; the menu item handles its own pending state.

Empty states are short noun phrases. Centered, muted, one or two lines. Sessions screen pairs the empty noun with a single ghost button to navigate back (`packages/app/src/screens/sessions-screen.tsx:74-81`); that pairing is the maximum elaboration. Illustrations and CTAs disguised as empty states are wrong.

Inline errors are a single sentence in `palette.red[300]` `xs`, sitting under the field or inside the card it relates to (`packages/app/src/screens/settings/providers-section.tsx:115-119`).

Page-level alerts — informational notices, success confirmations, warnings, or recoverable errors that need a small visible block on the page — use `<Alert>` (`packages/app/src/components/ui/alert.tsx`). Variants: `default`, `info`, `success`, `warning`, `error`. The chrome is quiet by design: a 1px tinted border, transparent background, a small variant-tinted icon, the title in the variant accent, the description in `foregroundMuted`. Actions go in the `children` slot as `<Button variant="outline" size="sm">` — recovery actions are low-frequency and outline keeps them quiet alongside the alert's accent (`packages/app/src/screens/project-settings-screen.tsx`). One `<Alert>` at a time per region.

Sidebar callouts — cross-cutting alerts that apply across the whole app, like worktree setup, Rosetta install, and desktop update available — register through `useSidebarCallouts()` and render in the left sidebar via `<SidebarCallout>` (`packages/app/src/components/sidebar-callout.tsx`). The chrome (top-border-only, full-width action buttons) is tuned for that ~280px column. Canonical sources: `packages/app/src/components/worktree-setup-callout-source.tsx`, `packages/app/src/desktop/updates/rosetta-callout-source.tsx`, `packages/app/src/desktop/updates/update-callout-source.tsx`. Never import `<SidebarCallout>` into a page — that's what `<Alert>` is for.

Imperative errors are `Alert.alert("Error", "Unable to ...")` (the React Native `Alert` API, not this component) for failures that interrupt the flow and have no place on the page.

Disabled state is `opacity: theme.opacity[50]` on the outer pressable. Color changes for disabled state are wrong; a disabled button is the same button, dimmer.

Partial failure (a list mostly fine but one source errored) is a bordered banner above the list, listing each failure in red-300 `xs` (`packages/app/src/screens/projects-screen.tsx:151-159`). The list still renders.

State surfaces at the smallest scope it affects. Field error stays under the field; page error is a banner; flow-stopping error is an `Alert`.

---

## 11. List rows

The row anatomy is a content column with an optional trailing slot. Inside a card the row is `settingsStyles.row`. Inside a sidebar list the row carries its own padding and `borderRadius.lg` per item (`packages/app/src/components/sidebar-workspace-list.tsx:2614-2625`).

Rows that drill into a detail lead with a chevron in the trailing slot (`ChevronRight`, `iconSize.sm`, `foregroundMuted`). The whole row is the `<Pressable>`. Pair-device row (`packages/app/src/screens/settings/host-page.tsx:644-668`), provider row (`packages/app/src/screens/settings/providers-section.tsx:92-132`), project row in the projects list. Chevron means navigation.

Kebab menus (`<DropdownMenu>` with `<MoreVertical size={14} />` trigger) are for actions on the row, not navigation. Trigger style: `padding: 2`, `borderRadius: 4`, hover background `surface2`. Menu position: `align="end"`. Items use `<DropdownMenuItem leading={<Icon size={14} color={foregroundMuted} />} ...>`. Visibility is `isHovered || isTouchPlatform` — hover-revealed on web, always visible on native (`packages/app/src/components/sidebar-workspace-list.tsx:684-770`).

A row may carry both a chevron and a kebab when both navigation and row-level actions apply. Chevron sits at the end; kebab sits before it.

Switches and segmented controls also sit in the trailing slot. A row that both navigates and toggles is a `<Pressable>` with a `<Switch>` in the trailing slot — the switch calls `event.stopPropagation()` so the row press does not fire (`packages/app/src/screens/settings/providers-section.tsx:92-132`). Sidebar items that hold a status dot, a count, and a kebab follow the same rule (`packages/app/src/components/sidebar-workspace-list.tsx`).

Selected state on rows in a desktop list+detail uses `surfaceSidebarHover` as the background (`packages/app/src/screens/projects-screen.tsx`). Selected state on rows in the sidebar list uses `surface2` (`packages/app/src/components/agent-list.tsx:563-571`).

---

## 12. Status pills and badges

Status pills are `palette.<color>[300]` foreground on a 10%-alpha background of the same color. Success uses green, warning uses amber, danger uses red, muted uses zinc. The `<StatusBadge>` primitive (`packages/app/src/components/ui/status-badge.tsx`) is canonical.

Status dots — the small filled circles next to a host or agent name — are `borderRadius.full` filled with the status color (`statusSuccess`, `statusWarning`, `statusDanger`, or `foregroundMuted`). They sit in the trailing slot of a sidebar row or as a leading marker on a status pill.

The bespoke pills in `packages/app/src/screens/settings/host-page.tsx:97-116`, `packages/app/src/components/agent-list.tsx:607-632`, and `packages/app/src/components/sidebar-workspace-list.tsx:2889-2894` are drift to be removed. New code uses `<StatusBadge>`.

---

## 13. Forbidden

- `fontWeight.medium` on row titles, body text, button labels, badge text, or `<SidebarCallout>` titles. Medium is reserved for the structural-label tier described in §3 — section labels, modal/sheet titles, dense metadata emphasis, and tight action labels. Anything else is `normal`. `<ScreenTitle>` is responsive `400/300` and is never overridden.
- `<Pressable>` wrapping `<Text>` to make a button. `<Button>` exists.
- Bare `<Text>` for a section header inside settings. `<SettingsSection>` exists.
- A "Settings" CTA on a detail page. Detail pages are settings; settings is reached from the sidebar, the host entry, or a row's kebab menu.
- The word "checkout" in UI strings or identifiers. The term is "workspace".
- New color tokens or hardcoded hex outside the palette. Status pill rgba backgrounds are the documented pattern (§12), not a license.
- Placeholder text dimmed beyond `foregroundMuted`. No extra opacity, no italics, no ghost-text.
- `onPointerEnter` and `onPointerLeave`. They do not fire on native iOS. Hover uses Pressable's `onHoverIn`/`onHoverOut` gated with `isHovered || isCompact || isNative`.
- Raw DOM APIs without an `isWeb` guard.
- Spacing values outside the scale. `padding: 20` and `gap: 10` are wrong.
- Color changes for disabled state. Opacity only.
- Destructive actions without `confirmDialog`. Restart, remove, and future destructive actions are confirmed. Archive workspace is confirmed only when its worktree backing reports uncommitted changes or unpushed commits; otherwise it archives immediately.
- Bespoke status pills. `<StatusBadge>` is the pill primitive.
- Raw `Modal` for a focused task. `<AdaptiveModalSheet>` is the modal primitive.
- Importing `ActivityIndicator` directly. `<LoadingSpinner>` is the loading primitive.

---

## 14. Canonical surfaces by pattern

| Pattern                                             | Reference                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List+detail (compact stack, desktop sidebar+pane)   | `packages/app/src/screens/settings-screen.tsx`, `packages/app/src/screens/projects-screen.tsx`                                                                                                                                                                                                           |
| Detail card+row                                     | `packages/app/src/screens/settings/host-page.tsx`, `packages/app/src/screens/settings/providers-section.tsx`                                                                                                                                                                                             |
| Section grouping inside a card list                 | `packages/app/src/screens/settings/settings-section.tsx`                                                                                                                                                                                                                                                 |
| Form modal (label + input fields, primary + cancel) | `packages/app/src/components/add-host-modal.tsx`, `packages/app/src/components/pair-link-modal.tsx`, `packages/app/src/components/project-picker-modal.tsx`                                                                                                                                              |
| Destructive confirmation                            | `confirmDialog` invoked from `packages/app/src/screens/settings/host-page.tsx:541-547`                                                                                                                                                                                                                   |
| Centered hero / first-run                           | `packages/app/src/components/welcome-screen.tsx`                                                                                                                                                                                                                                                         |
| Sidebar list (workspaces, hosts)                    | `packages/app/src/components/sidebar-workspace-list.tsx`, `packages/app/src/components/left-sidebar.tsx`                                                                                                                                                                                                 |
| Live list of items with sections (agents)           | `packages/app/src/components/agent-list.tsx`                                                                                                                                                                                                                                                             |
| Historical list (sessions)                          | `packages/app/src/screens/sessions-screen.tsx`                                                                                                                                                                                                                                                           |
| Workspace pane (multi-tab, split)                   | `packages/app/src/screens/workspace/workspace-screen.tsx`                                                                                                                                                                                                                                                |
| Composer / message input                            | `packages/app/src/components/composer.tsx`, `packages/app/src/components/message-input.tsx`                                                                                                                                                                                                              |
| Pane chrome with single bottom border               | `packages/app/src/components/git-diff-pane.tsx`, `packages/app/src/components/file-explorer-pane.tsx`, `packages/app/src/components/terminal-pane.tsx`                                                                                                                                                   |
| Page-level alert (info / success / warning / error) | `packages/app/src/components/ui/alert.tsx`, `packages/app/src/screens/project-settings-screen.tsx`                                                                                                                                                                                                       |
| Sidebar callout (cross-cutting alert)               | `packages/app/src/components/sidebar-callout.tsx`, `packages/app/src/contexts/sidebar-callout-context.tsx`, `packages/app/src/components/worktree-setup-callout-source.tsx`, `packages/app/src/desktop/updates/rosetta-callout-source.tsx`, `packages/app/src/desktop/updates/update-callout-source.tsx` |
| Searchable picker                                   | `packages/app/src/components/ui/combobox.tsx`, `packages/app/src/components/branch-switcher.tsx`                                                                                                                                                                                                         |
| Trigger-anchored menu                               | `packages/app/src/components/ui/dropdown-menu.tsx` (used in `sidebar-workspace-list.tsx`, theme picker)                                                                                                                                                                                                  |
| Right-click / long-press menu                       | `packages/app/src/components/ui/context-menu.tsx` (used in `sidebar-workspace-list.tsx`)                                                                                                                                                                                                                 |
| Headers (back, screen, menu)                        | `packages/app/src/components/headers/back-header.tsx`, `screen-header.tsx`, `menu-header.tsx`                                                                                                                                                                                                            |

## 15. Motion

Motion is tokenized in `packages/app/src/styles/motion.ts` — durations, easings, spring presets, and press scales. Animation code imports from there; hardcoded duration literals in animation contexts are wrong.

Durations: `instant` 60ms (exit, micro feedback), `fast` 120ms (menus and toasts), `base` 200ms (toggles, hover, focus transitions), `slow` 300ms (block entrances), `reveal` 450ms (message emphasis). Easings are three curves — `standard` (decelerate, ≈ easeOutQuart), `snap` (fast start, decisive settle), `overshoot` (slight 1.3× bounce) — usable as `Easing.bezier(...MOTION_BEZIER.x)` on Reanimated/Animated or `MOTION_EASING_CSS.x` in web CSS. Springs: `press` 600/30, `card` 320/28, `bouncy` 380/18, `drag` 1200/80/mass 0.1.

Press feedback is a scale, not an opacity dip: `MOTION_PRESS_SCALE.button` (0.95) for text buttons, `MOTION_PRESS_SCALE.iconButton` (0.92) for small circular icon buttons. Disabled stays opacity-only (§10); never combine a large opacity change with the scale.

Stream entrance animations play only when an item arrives live. History restore, pagination, reconnect snapshots, and virtualization remounts never replay them, and every new animation carries a `useReducedMotion`/`AccessibilityInfo` fallback. The installed Reanimated `Keyframe` has no custom easing, so menu enter/exit keeps its default easing and only tokenized durations.

---

## 二开对话外观

- 对话正文、回合尾部、附件与输入框共用 `MAX_CHAT_CONTENT_WIDTH = 738`；文件预览和表单仍使用 820 像素上限。窄屏随可用宽度收缩，不强制固定宽度。
- 默认 Dark 使用炭黑画布、略灰侧栏和输入面、低饱和蓝灰工作区选中态；状态色与其他主题的背景不受这套配色影响。侧栏普通文字比正文降低 8% 对比度，辅助灰字不重复弱化，用户的文字亮度设置仍生效。
- 桌面输入框采用正文在上、工具栏在下的结构；模型与思考强度在同一入口中显示，菜单去掉“角色”标题并采用 240 像素紧凑宽度；桌面模型、推理子选项可悬停展开，使用安全区衔接并允许切换相邻行，模型列表按数量收缩且最高 400 像素，权限单独保留图标，提供商功能进入角色菜单。紧凑布局继续使用模型底部面板，不堆放横向子菜单。语音、发送与停止保留原业务状态。
- 下拉浮层使用圆角表面、内缩选项和带勾的灰色选中行，不使用强调色大片填充。到底部入口是无阴影的 32 像素细箭头圆钮，扩大命中范围而不放大视觉体积。

定时发送使用发送按钮的右键或长按菜单，不添加常驻控件；分钟设置仅在小型弹窗或紧凑底部面板中展示。输入框上方待发送项采用辅助文字的一行摘要与操作菜单，失败原因在摘要下方明确显示。创建失败时保留原草稿与附件。取消定时发送先下载图片，再取消服务端消息，成功后将正文与完整附件追加回输入框，不覆盖新草稿。桌面设置浮层只保留右上角关闭按钮，使用共享 `lg` 尺寸的 44 像素点击区和 20 像素图标，移动端全屏导航保留返回。

对话与 Markdown 文档引用块使用细边框和轻微灰底，内边距 12×8 像素，不使用粗亮侧边条。模型菜单标签不可收缩，长模型值单行省略；Fast 状态在桌面和移动端首层入口用黄色闪电表达。主机筛选独立放在工作区标题操作区，保留显示偏好中的项目筛选与分组设置。

动效统一走 `styles/motion.ts` 的时长、曲线与弹簧 token；按压反馈为缩放（文本按钮 0.95、小圆形图标钮 0.92），禁用态保持纯透明度。Claude 主题对齐 Claude Desktop 暖色阶梯：表面、侧栏、边框与文字换成暖炭黑与暖中性色，陶土色强调不变。桌面与 Electron 的输入框采用单层 1px 边框叠加极淡环境影，聚焦时只加深边框色与投影，不追加第二圈外环；不使用强调色描边，原生端以边框加深近似。
