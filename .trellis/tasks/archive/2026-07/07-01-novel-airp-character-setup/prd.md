# 小说 AIRP 角色设定向导 Step 3

## Parent

- `.trellis/tasks/06-27-default-card-novel-reader-airp`

## Goal

实现开局向导第 3 步"角色设定"：玩家在初始理解完成后，选择扮演原著角色或原创角色，设定角色身份信息，将结果写入 workspace 供后续 Agent 回合使用。

## Background

开局向导 5 步：① 导入小说 → ② 初始理解 → ③ 角色设定 → ④ 游玩倾向 → ⑤ 开局确认。

Step 1-2 已实现：导入小说后 world-architect agent 执行 `commit_opening_understanding`，产出理解包（entities、scene、relationships、frontier、understanding-summary、runtime.json）。

`understanding-summary.json` 包含 `candidateCharacters`（最多 8 个原著角色候选，每个有 `id`/`name`/`brief`）。
`runtime.json` 当前 `player: { character: null, location: null }` — 玩家角色未设定。

Step 2 末尾 `UnderstandingReady` 组件已提供"原著角色 / 原创角色"分支选择，选中后 emit → `goToStep(3)` → 当前进入 stub。

## Confirmed Facts From Repository

- `OpeningUnderstandingSummary.candidateCharacters`: `OpeningCandidateCharacter[]`，每项 `{ id?, name, brief }`（source.ts:87-99）
- `candidateCharacters` 由 commit 脚本从 entities 中 `character:` 前缀的实体自动选取，或由 agent 显式提供（workspace-templates.ts:907）
- `runtime.json` 的 `player.character` 当前为 `null`，是玩家角色引用的落点（workspace-templates.ts:920）
- `runtime.json` 路径：`save/playthrough/runtime.json`，初始结构 `{ turn, activeSceneIds, activeScene, player: { character, location }, inventory, status, updatedAtTurn, updatedBy }`
- 实体文件存于 `save/entities/<type>/<localId>.json`，角色实体 `type` 为 `character`
- `UnderstandingReady` 已有 `select` emit 传递 `"canon" | "original"` 分支
- 向导壳 `SetupWizard` 用 `stage-fade` Transition 切换子屏，action bar 有 secondary/primary 按钮
- `useSetupState` 是模块级单例，管理 step/subView/understandingStatus 等状态
- 父 PRD 规定：开局流程采用"向导式 UI + architect 对话"混合形态——结构性选择用 UI，开放性创作用 Agent 对话
- 烛火书卷风格 token：`--void-deep`/`--ember`/`--ember-bright`/`--prose`/`--prose-dim`/`--line`/`--line-strong`（tokens.css）

## Requirements

### R1: 原著角色选择（canon 分支）

- 玩家选择"原著角色"后，Step 3 展示候选角色竖向列表（来自 `candidateCharacters`）
- 每行显示：标记字 + 角色名 + 一句话简介
- 玩家选中一行后高亮，action bar primary 按钮变为"确认选择"
- 确认后将所选角色 ref 写入 `runtime.json` 的 `player.character`（格式 `{ ref: characterId, name }`）
- 如果 `candidateCharacters` 为空数组，显示提示"未找到合适的原著角色候选，请选择原创角色"，引导回到分支选择
- 原著角色不需要表单，不需要 Agent 访谈——角色信息已在理解包 entity 文件中

### R2: 原创角色创建（original 分支）

- 玩家选择"原创角色"后，Step 3 展示角色创建表单
- 必填字段：角色名、一句话简介
- 可选字段：外貌描述、性格特征、背景故事（折叠在"展开更多"中）
- 确认后创建新 `character:` 实体写入 `save/entities/character/original-<name>.json`
- 同时将新角色 ref 写入 `runtime.json` 的 `player.character`（格式 `{ ref: "character:original-<name>", name }`）
- Agent 访谈完善角色是后续步骤的事，不在 Step 3 UI 内。Agent 可通过 ref 前缀 `original-` 判断是否原创角色，在运行时通过 skill 决定是否引导访谈——不在 UI 上分支

### R3: 分支选择传递

- Step 2 `UnderstandingReady` 的分支选择（canon/original）结果传递到 Step 3
- Step 3 根据 branch 渲染对应子界面（原著列表 / 原创表单）
- 提供"返回分支"让玩家重新选择分支

### R4: 确认屏

- 角色确认后（选择原著角色或提交原创表单），显示"已选定角色"确认屏
- 确认屏展示角色名片（标记字 + 名字 + 简介）+ "返回修改" / "下一步"按钮
- "下一步"推进到 Step 4（目前 stub）
- "返回修改"回到对应的选择/表单界面

### R5: 状态持久化与恢复

- 角色设定结果写入 workspace（save-runtime scope）
- 向导状态机推进：角色设定完成 → step 3 done → 可进入 step 4
- 重载恢复：已有 `player.character` 非null 时跳过选择直接显示确认屏

### R6: 视觉一致性

- 延续烛火书卷风格
- 原著角色列表行复用 branch-card 的视觉模式（标记字 + 正文 + 括号），但改为竖向列表布局
- 原创角色表单用 setup-btn / 烛火色输入框
- 确认屏角色名片复用 branch-card 样式

## Acceptance Criteria

- [ ] Step 2 选中"原著角色"后进入 Step 3，展示 `candidateCharacters` 竖向列表
- [ ] 每行候选显示标记字 + name + brief，点击高亮选中
- [ ] `candidateCharacters` 为空时显示提示并引导回到分支选择
- [ ] Step 2 选中"原创角色"后进入 Step 3，展示角色创建表单
- [ ] 原创角色表单：角色名 + 一句话简介（必填），外貌 + 性格 + 背景（可选，折叠）
- [ ] 确认角色后写入 `runtime.json` 的 `player.character`（ref 格式 `{ ref, name }`），save-runtime scope
- [ ] 原创角色同时创建 `save/entities/character/original-<name>.json` 实体文件
- [ ] 确认后显示"已选定角色"确认屏，可返回修改或推进到 Step 4
- [ ] 重载恢复：已有 `player.character` 时跳过选择，直接显示确认屏
- [ ] "返回分支"按钮可回到 Step 2 分支选择
- [ ] `play-frontend-dev` 构建通过

## Out Of Scope

- 原创角色 Agent 对话访谈（后续步骤，Agent 通过 ref 前缀 `original-` 在运行时通过 skill 分支）
- 角色详细属性/数值系统
- 角色外观图片上传
- 多角色选择（第一版只选一个玩家角色）
- Step 4 游玩倾向 / Step 5 开局确认

## Design Decisions

1. 原创角色 `localId`：`original-` 前缀 + 角色名（如 `original-萧玄`）。同名冲突加序号后缀（`original-萧玄-2`）。id 为 `character:original-萧玄`。后续 Agent 回合产生的原创角色不在此流程内。
2. `player.location` 不设，由开局组装或首回合 Agent 推断。
3. 原创角色不需要 `sourceRefs`，原创角色不来源于原文。
4. 只写 `runtime.json` 的 `player.character`。`player.json` 留给 Step 4。
5. 确认后先显示"已选定角色"确认屏，再推进到 Step 4。
6. 原著角色不经过表单/访谈，直接列表选择。原创角色第一版用前端表单，Agent 访谈是后续步骤。
