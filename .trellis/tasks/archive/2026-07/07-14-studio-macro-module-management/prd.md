# 工作室宏模块开关分组与文件管理入口

## Goal

让工作室「消息序列」编辑器更适合管理基于 `{{file:... ?enabled}}` 的模块化注入：同一条注入中来自不同子目录/宏源的模块开关应有清晰分界，引用文件和宏文件路径不再依赖纯手写，模块内容修改应跳转到既有资源管理器/工作区编辑器，而不是在消息序列弹窗内再叠一层内容编辑弹窗。

## Background / Confirmed Facts

- 当前消息序列编辑器在 `MessageSequenceEditor.vue` 中打开 `EntryEditDialog`，并传入所选 Agent 的模块列表与 `enabledModules` 草稿。
- 当前 `EntryEditDialog` 从条目的模板或引用文件正文中提取 enabled file 宏，然后把所有匹配模块过滤成一个扁平数组传给 `ModuleSwitchList`。
- 当前 `ModuleSwitchList` 直接渲染扁平模块列表，没有宏源或目录分组，导致同一条注入包含多个子目录 glob 时开关混在一起。
- Runtime `?enabled` 语义是文件名 stem 白名单：`enabledModules` 存储文件 stem，宏展开按 `fileStem(path)` 判断是否启用。用户确认同名模块跨目录同步开关是故意的，本任务保持该语义。
- 工作区已有资源管理器和编辑器路由：`workspace` 可打开目录，`workspace-editor` 可直接编辑文本文件。本任务复用它们，不新增模块内容编辑弹窗。
- 当前没有可复用的 workspace 文件选择组件；需要在 Studio 范围内新增一个轻量选择器或等价控件。

## Decisions

1. 保持 `enabledModules: string[]` 的 stem 语义，不改 contracts、不做迁移、不引入按路径独立开关。
2. 路径改进做成通用能力：普通引用文件路径和内联 `{{file:...}}` 宏都应受益，不只服务模块宏。
3. 模块内容操作提供「编辑」和「目录」两个入口：直接打开 Workspace 编辑器，或跳到资源管理器父目录。
4. 文件选择器嵌入消息条目编辑弹窗内部，不再做第二层 `FloatingWindow`，避免遮罩叠加和长列表溢出问题。
5. 从条目编辑弹窗跳到 Workspace editor/explorer 前不做自动保存；若当前条目有未保存修改，只提示“当前还有未保存的修改，如果此时离开会被丢弃。”，按钮为「确认」和「取消」。

## Requirements

### R1. 模块开关按宏源/目录分组

- 当一个消息序列条目的宏文本中包含多个 enabled file 宏，例如：
  - `{{file:modules/文风/*.md?enabled}}`
  - `{{file:modules/NSFW追加/*.md?enabled}}`
- Studio 必须按宏源/目录显示独立分组，不能把所有模块平铺混在一起。
- 每组应展示可辨认的宏路径或目录标签、该组启用数量、匹配模块列表。
- 模块 toggle 仍按 `module.stem` 更新 `enabledModules`。
- 如果同一可见范围内存在同 stem 模块，应通过提示说明这些开关按文件名同步，而不是尝试拆分状态。

### R2. 引用文件路径选择更方便

- 对 `kind: "path"` 的消息序列条目，保留手写路径输入，但必须提供「选择文件」入口。
- 选择文件后应填入 `draft.path`，并复用现有读取流程加载正文。
- 选择器应嵌入条目编辑弹窗内部，不使用第二层全局弹窗。
- 选择器应有固定滚动列表区域，内容较多时底部操作栏仍保持可见。
- 选择器应支持单击选中、双击目录进入、双击文件确认选择。

### R3. 内联 file 宏插入更方便

- 对 `kind: "template"` 的消息序列条目，保留原始文本编辑能力。
- 提供插入普通文件宏的入口：选择文件后插入 `{{file:path}}`。
- 提供插入模块目录宏的入口：选择目录后插入 `{{file:dir/*.md?enabled}}`。
- 插入控件不需要覆盖所有高级宏形式；高级用户仍可手写。

### R4. 模块内容跳转到既有工作区工具

- 模块卡片应提供「编辑」：关闭当前条目弹窗后打开该模块文件的 Workspace editor。
- 模块卡片应提供「目录」：关闭当前条目弹窗后打开该模块文件所在目录的 Workspace explorer。
- 引用文件路径处也应提供同类跳转入口（路径存在时打开编辑器或父目录）。
- 若当前条目弹窗存在未保存修改，跳转前只确认是否丢弃修改，不在此处提供保存选项。
- 不新增模块内容编辑弹窗。

### R5. 保存语义保持不变

- 模块开关修改继续进入消息序列草稿，只有点击外层「保存序列」后才写入 `agent.json`。
- 跳转到 Workspace editor 后，文件正文保存由 Workspace editor 自己负责。
- `enabledModules` 未配置表示默认包含全部，显式空数组表示全部不包含；本任务不得破坏该兼容语义。

## Acceptance Criteria

- [ ] AC1: 在一个内联条目中同时写入 `{{file:modules/文风/*.md?enabled}}` 与 `{{file:modules/NSFW追加/*.md?enabled}}` 时，规则模块面板显示两个清晰分组，而不是一个混合列表。
- [ ] AC2: 每个分组显示宏路径/目录标签、组内启用数量和组内模块文件；总体启用数量仍可见。
- [ ] AC3: 切换模块仍只更新 stem 白名单；同名模块跨目录保持同步。
- [ ] AC4: 引用文件条目可以通过嵌入式「选择文件」面板填充路径并读取文件内容，不必手动输入完整路径；长列表在面板内部滚动且底部操作栏保持可见。
- [ ] AC5: 内联文本条目可以通过选择文件插入 `{{file:path}}`，并可以通过选择目录插入 `{{file:dir/*.md?enabled}}`。
- [ ] AC6: 模块文件上的「编辑」会在必要时提示丢弃当前条目未保存修改，然后关闭条目弹窗并打开 Workspace editor；「目录」同理打开 Workspace explorer 的父目录。
- [ ] AC7: 引用文件路径上的编辑/目录跳转复用 Workspace 路由，不新增内容编辑弹窗。
- [ ] AC8: `npm run build:web` 通过，或如失败则记录真实失败输出。

## Out of Scope

- 将 `enabledModules` 改成路径标识或目录标识。
- 迁移现有 `agent.json`。
- 在消息序列弹窗中新增模块正文编辑弹窗。
- 为 Workspace explorer 增加 route-level 精确文件高亮；本任务只要求打开父目录。
- 改变 runtime 宏展开规则或 contracts 形状。
