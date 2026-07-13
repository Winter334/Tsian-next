# 消息序列编辑 UI

## Goal

在 Studio Agent 配置面板中添加可视化消息序列编辑器，让玩家不用编辑 agent.json 就能配置 contextPaths 的 position / role / 内容，并预览组装后的消息序列。后端声明机制（task 07-13-message-sequence-declaration）已完成。

## Background

### 后端已完成

- contextPaths 支持 `position` 字段（before-history / workspace-context / after-input / tail）
- `AgentContextEntry.contextInjectionsByPosition` 按 position 分组
- `getPlatformStudioAgentContext`（studio-agents.ts:274）已返回 `contextInjectionsByPosition`
- `mergeConsecutiveRoleMessages` 整合器在发送前合并连续同 role 消息
- storyteller 已配置 4 层 position（before-history / workspace-context / after-input / tail）

### 现有 UI 基础设施

- StudioView.vue 有 4 tab（agent / soul / skills / tools），消息序列编辑器为第 5 tab
- reorder 模式：up/down 按钮（ModelConfigScreen.vue），无拖拽库
- UI 组件库：Select / Switch / Input / Tabs / ScrollArea / Collapsible / Tooltip / Popover
- 桌面级浮窗：FloatingWindow.vue（`<Teleport to="body">` + `z-[60]` + 可拖拽），slot 模式用于模型配置弹窗
- 写入模式：studio-agents.ts 的 update handler + writeAgentConfigRecord，即时保存
- 对话框：openDialogForm（form 模式）/ FloatingWindow slot 模式 / confirm / toast composables
- 代码编辑器：WorkspaceCodeEditor.vue（现用于 AGENT.md/SOUL.md 只读展示，可复用为可编辑）

### 缺失项

- `updatePlatformStudioAgentContextPaths` handler 不存在
- 无 contextPaths 编辑 UI
- 无消息序列预览 UI
- 无 workspace 文件路径选择器

## Requirements

### R1：StudioView 新增"消息序列"tab

在 sections 数组添加第 5 tab，展示当前选中 agent 的 contextPaths 编辑器。

### R2：按最终发送顺序排列的单列表编辑器

消息序列 tab 展示一个纵向 timeline，列表从上到下就是运行时消息发送顺序。列表中混排两类行：
- 固定不可编辑层：system prompt（AGENT.md / SOUL.md / 工具说明）、history / context snapshot、workspace context meta、tool memories、turn runtime、frontend injection、player input 等，用锁定样式展示，帮助玩家理解整体骨架。
- 可编辑 contextPaths 插入区：before-history / workspace-context / after-input / tail 四个落点按骨架顺序嵌在固定层之间。玩家可在每个落点添加条目，也可拖拽条目跨落点移动；跨落点移动自动改变 position。

说明文字不要挤在主 UI；使用已有 `ParamTip` tip 按钮承载位置说明、缓存提示和固定层来源说明。

### R3：条目编辑对话框（FloatingWindow slot 模式）

点击条目的铅笔图标弹出桌面级浮窗（`FloatingWindow.vue` slot 模式，`<Teleport to="body">` + `z-[60]`，与模型配置弹窗一致）：
- 类型选择：文件路径（path）或内联模板（template），互斥
- path 模式：workspace 文件路径输入 + 文件正文编辑区（嵌入 WorkspaceCodeEditor 或等价编辑器组件）
- template 模式：多行文本输入（支持 `{{file:...}}` `{{random:...}}` 宏）
- role 选择：system / user / assistant
- position 选择：before-history / workspace-context / after-input / tail
- 宏模块条目（`{{file:modules/*.md?enabled}}`）：编辑 role / position + 展开显示各模块文件 enabled/disabled 开关

### R4：序列即预览

主 timeline 本身就是消息序列预览：
- 按骨架顺序展示各层（固定层用锁定标记，如 [system prompt] [history] [player input]）
- contextPaths 注入显示 role / source / path-or-template 摘要，必要说明放入 ParamTip
- 可选高级折叠：后续如需要可显示整合器合并后的结果（mergeConsecutiveRoleMessages 后），本轮不作为必需项

### R5：后端 handler

新增 `updatePlatformStudioAgentContextPaths` handler，接收完整的 contextPaths 数组替换。

### R6：纯字符串条目兼容

现有 contextPaths 可能有纯字符串条目（如 `"save/agents/storyteller/writing-rules.md"`）。编辑器需正确显示和编辑这类条目（默认 role=user, position=workspace-context）。

### R7：模块开关整合

`{{file:modules/*.md?enabled}}` 条目在编辑器中展开显示各模块文件的 enabled/disabled 开关列表（现有 tools tab 的模块开关移到此处）。不改变 modules 机制——enabledModules 字段仍控制 `?enabled` 包含，只是开关入口从 tools tab 移到消息序列编辑器。

## Acceptance Criteria

- [ ] 消息序列 tab 以单列 timeline 展示，固定层 + contextPaths 落点按最终发送顺序混排
- [ ] 固定层显示为锁定不可编辑行，玩家能看到 AGENT.md/SOUL.md/history/player input 等所在位置
- [ ] 条目可添加/编辑/删除/拖拽排序（同 position 内 + 跨 position 移动）
- [ ] 编辑对话框支持 path/template 互斥切换、role 选择、position 选择
- [ ] 纯字符串条目正确显示为 path 模式（role=user, position=workspace-context）
- [ ] 保存后 agent.json 正确更新 contextPaths 数组
- [ ] 预览面板展示骨架顺序的消息序列，contextPaths 内容宏展开
- [ ] 无新增 npm 依赖（除拖拽库外，使用现有 UI 组件）

## Out of Scope

- ~~拖拽排序~~ 已纳入范围（引入拖拽库支持同内排序 + 跨块移动）
- 实时 API 调用预览（只展示组装结构，不实际调用模型）
- AGENT.md / SOUL.md 编辑（现有 read-only 行为不变）
- 前端 InjectionMessage 编辑（前端注入由游戏卡代码控制，不在 agent.json 里）

## Open Questions

无。所有产品决策已与用户对齐：
- 保存语义：草稿 + 显式保存（消息序列是编排型编辑，拖拽/添加/删除/编辑不立即写入，点击“保存序列”后统一写 agent.json；可撤销更改）
- 预览粒度：未合并视图（展示 role + source + 宏展开内容，按骨架顺序）
- 模块整合：宏条目内嵌开关（不改变 modules 机制，开关入口移到编辑器）
- 内容编辑范围：配置 + 文件内容（path 模式下可编辑文件正文）
- 弹窗形式：FloatingWindow slot 模式（桌面级浮窗，与模型配置弹窗一致）
- 排序方式：拖拽（vuedraggable-plus），同 position 内排序 + 跨 position 移动
