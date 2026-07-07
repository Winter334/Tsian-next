# 设计文档：导演与 brief 移除 + timeline 建立

> 本文档记录 `07-07-director-brief-removal-timeline-setup` 的执行决策边界。父任务 `07-06-agent-roster-progressive-refactor/design.md` 记录了架构转变的完整推理（为什么移除导演、为什么 timeline 替代 brief、紧耦合原因），本文档只记录 B 特有的"怎么执行"决策。

## 1. 范围边界

### B 做什么

- **移除**：director Agent 全部定义、brief 文档体系、所有 Agent 对 brief 的引用、前端 director 残留。
- **建立**：`frontier.json.timeline` 字段（schema + seed + commit 脚本 + schema 文档）、world-architect 开局建模 Skill 的"建第一个锚点 + worldTime 元年初始化"步骤。

### B 不做什么（接口约定）

| 内容 | 归属 | B 的接口约定 |
| - | - | - |
| 游玩设定步重构（`buildPlaySetupPrompt` mode.json 残留 + agent_call storyteller） | C | B 不动 `buildPlaySetupPrompt`（`source.ts:452-478`） |
| researcher 映射 timeline → 窗口找素材 → 推进 frontier | D | B 只建立 timeline 数据结构和第一个锚点，不写映射逻辑 |
| stage-manager 回合后维护 worldTime 职责重写 | E | B 不动 `STAGE_MANAGER_STATUS_SKILL_MD` 的 worldTime 指引（`07-05` 已交付） |
| frontier 推进 Skill（ongoing）+ A' 前端触发 | E | B 只在开局建模建第一个锚点，不写推进 Skill |

### 验证点

B 的验证点是开局向导 Step 2（Understanding）。完成后浏览器检查：
- `save/playthrough/frontier.json` 有 `timeline: [{chapter:1, time:"元年", label:"开局"}]`
- `save/playthrough/runtime.json` 的 `worldTime` 为 `"元年"`
- `save/director/` 目录不存在
- 无 director Agent 产出（grep workspace 无 director agent.json）

## 2. director 移除清单

### 2.1 workspace-templates.ts 内的移除项

| 位置 | 内容 | 动作 |
| - | - | - |
| `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS` | director/brief 路径条目 | 移除 |
| `DIRECTOR_BRIEF_SKILL_MD` 常量 | 整个剧情指导维护 Skill 文本 | 删除常量 |
| `DEFAULT_WORKSPACE_FILES` director agent.json/AGENT.md/SOUL.md | director Agent 定义 | 删除 3 个文件登记 |
| `DEFAULT_WORKSPACE_FILES` `agents/director/skills/剧情指导维护/SKILL.md` | Skill 文件登记 | 删除 |
| `DEFAULT_SAVE_RUNTIME_FILES` `save/agents/director/notes.md` | director notes 种子 | 删除 |
| `DEFAULT_SAVE_RUNTIME_FILES` `save/director/*` | brief 文档种子（current-brief.md/.meta.json/README.md） | 删除 3 个文件登记 |
| storyteller `contextPaths` | `save/director/current-brief.md` | 移除该条 |
| stage-manager `contextPaths` | `save/director/current-brief.md` | 移除该条 |
| storyteller/researcher/stage-manager/world-architect `contacts` | `"director"` 条目 | 各移除 |
| `RESEARCHER_RETRIEVAL_SKILL_MD` | "brief" 提及 | 移除 |
| `WORLD_ARCHITECT_OPENING_SKILL_MD` | "agent_call 导演写 brief" 步骤 | 替换为 timeline 锚点步骤（见 §5） |
| `NOVEL_AIRP_SCHEMA_GUIDE_MD` | "runtime 与 director brief" / `save/director/` 路径 / director 职责行 | 移除或改写 |
| `NOVEL_AIRP_SCHEMA_REFERENCE_MD` | brief/director 相关段落 | 移除 |
| `TSIAN_FRAMEWORK_KNOWLEDGE_MD` | "director" 在 background specialists 列表 | 移除 |
| 顶层 `README.md` | "director files" 提及 | 移除 |
| `agents/README.md` | `director / 导演` 行 | 移除 |
| `save/README.md` | `director/` 路径登记 | 移除 |
| `save/source/README.md` | "director briefs" 提及 | 移除 |

### 2.2 前端移除项

| 文件 | 内容 | 动作 |
| - | - | - |
| `UnderstandingRunning.vue:17-23` | STAGES 数组 5 项 | 精简为 3 项（见 §6 决策） |
| `useSetupState.ts:85` | "3 = 导演校准（agent_call）" 注释 | 改写 |
| `useSetupState.ts:118-130` | `mapToolToStage` 的 `if (name === "agent_call") return 3` 分支 | 移除（见 §6 决策） |
| `source.ts:495` | `buildOpeningInitializationPrompt` 第 5 条 "agent_call 导演写初始 director brief" | 删除或替换（见 §7 决策） |

### 2.3 不动项

- `agent-runtime/` / `registry.ts` / `workspace-tools.ts` / `tool-schemas.ts`：经 Explore agent 确认，无任何 `director`/`brief`/`frontier` 字面量分支，平台运行时代码不感知 director 概念。零改动。
- `docs/active/agent-framework-runtime-workspace-direction.md` / `docs/active/current-state-handoff.md`：方向文档早于本次重构、不被代码消费，不作为 B 验收项。如需更新另立文档维护任务。

## 3. timeline 数据结构

### 3.1 frontier.json 新增字段

```json
{
  "sourceWindow": { "start": 1, "end": 8, "chapters": [...] },
  "extractedThrough": "save/source/chapters/0008.md",
  "timeline": [
    { "chapter": 1, "time": "元年", "label": "开局" }
  ],
  "notes": "...",
  "updatedAt": "...",
  "updatedBy": "world-architect"
}
```

- `timeline: Array<{ chapter: number, time: string, label: string }>`
- `chapter`：原著章节号（与 `sourceWindow` 同一坐标）。
- `time`：元年基准时间字符串，自由粒度（默认"年+季/月"，如"二年秋"）。
- `label`：一句话客观标签，**不是剧情摘要**（防止滑向 brief）。
  - ✓ `"飞星下山"`（客观标签）
  - ✗ `"飞星下山，与广刹因灵蛇剑起冲突，导演应控制此段张力"`（brief 式指导）

### 3.2 种子初始化

`frontier.json` 种子（`DEFAULT_SAVE_RUNTIME_FILES`）：

```json
{
  "sourceWindow": { "start": null, "end": null },
  "extractedThrough": null,
  "timeline": [{ "chapter": 1, "time": "元年", "label": "开局" }],
  "notes": "Track how far the imported source has been normalized, chunked, and extracted."
}
```

种子即包含第一个锚点——开局前 workspace 已有基准，world-architect 开局建模时通过 `commit_runtime_and_frontier` 写入实际 chapter（可能是 1 或 8，取决于开局读了多少章）。

**决策**：种子锚点的 `chapter` 用 `1`（占位），world-architect 开局建模时根据实际 `sourceWindow.start` 覆盖。`time` 固定 `"元年"`，`label` 固定 `"开局"`——这是基准锚点，不变。

### 3.3 与既有 frontier 字段的关系

`timeline` 与 `sourceWindow` 独立——`sourceWindow` 记录"已读章节窗口"，`timeline` 记录"时间标记锚点"。推进 frontier 时 `sourceWindow` 移动，`timeline` 追加新锚点。两者通过 `chapter` 字段关联（researcher 用 `worldTime` 映射 `timeline[].time` 定位锚点，再用锚点 `chapter` 定位 `sourceWindow` 位置）。

## 4. worldTime 元年初始化策略

### 决策：Skill 指示，不改脚本默认值

`COMMIT_RUNTIME_AND_FRONTIER_SCRIPT_JS` 当前逻辑（`:413`）：

```js
const worldTime = typeof input.runtime.worldTime === 'string' ? input.runtime.worldTime.trim() : '';
```

脚本透传 world-architect 提供的 `worldTime`，空字符串则写空。**B 不改这个默认行为**——脚本是机械透传，"元年"是领域决策，不该硬编码进脚本。

`WORLD_ARCHITECT_OPENING_SKILL_MD` 新增步骤指示 world-architect：建模末尾调用 `commit_runtime_and_frontier` 时，`runtime.worldTime` 传 `"元年"`，`frontier.timeline` 传 `[{ chapter: <开局起始章>, time: "元年", label: "开局" }]`。

### 理由

- 脚本职责：机械透传 + 校验格式，不做领域决策。
- Skill 职责：指导 Agent 做领域决策（何时建锚点、时间标记怎么定）。
- 如果脚本硬编码 `"元年"`，后续若想改基准时间表述（如"赤明纪元年"）要改脚本；由 Skill 指示则只改 Skill 文本。

## 5. commit_runtime_and_frontier 脚本改动

### 当前行为（`:446-459`）

```js
const runtimeFile = { turn, worldTime, location, weather, activeSceneRefs, protagonistRef, extensions, updatedAtTurn: turn, updatedBy: 'world-architect' };
const frontierFile = { sourceWindow: { start, end, chapters: window.chapters }, extractedThrough, notes, updatedAt, updatedBy: 'world-architect' };
```

### 改动

`frontierFile` 新增 `timeline` 字段，从 `input.frontier.timeline` 透传：

```js
const timeline = Array.isArray(input.frontier?.timeline) ? input.frontier.timeline : [];
// 校验每项 { chapter: number, time: string, label: string }
const frontierFile = { sourceWindow: ..., extractedThrough, timeline, notes, updatedAt, updatedBy: 'world-architect' };
```

校验：每项必须有 `chapter`（number）、`time`（string）、`label`（string）。校验失败按既有脚本错误模式 fail。

### 不改 runtime.json 写入

`runtimeFile` 已含 `worldTime`（`:413` 透传），无需改动。

## 6. 前端 STAGES 精简决策

### 现状（bug + dead code）

`UnderstandingRunning.vue:17-23` STAGES 5 项：

```
[0] "正在观察导入结构…"
[1] "正在阅读开头剧情…"
[2] "正在整理开局资料…"
[3] "正在写入…"
[4] "导演正在校准剧情方向…"
```

`useSetupState.ts:118-130` `mapToolToStage` 产出范围 0-3：
- `agent_call → 3`
- `write/edit/...→ 2`
- `read/list/...→ 1`

**bug**：`STAGES[4]` 从不可达（mapping 最大产出 3），是 dead code。`STAGES[3]` 显示"正在写入…"，但 `:85` 注释说"3 = 导演校准"——注释与数组错位。

### 决策：精简为 3 项

移除 director 后，理解阶段只剩：

```
[0] "正在观察导入结构…"
[1] "正在阅读开头剧情…"
[2] "正在整理开局资料…"
```

`mapToolToStage` 移除 `agent_call → 3` 分支。新模型下 world-architect 开局不 agent_call 任何 Agent（timeline 锚点自己建，不委托），所以 `agent_call` 事件在理解阶段不会触发。即便触发（如 agent_call researcher），归类为"阅读"（stage 1）更合理——但移除分支后 `agent_call` 不匹配任何条件，返回当前 stage（不推进），这也是可接受的（agent_call 是内部协调，不需要面向玩家展示独立阶段）。

### 理由

- 移除 `STAGES[3]` "正在写入…"：它与 `STAGES[2]` "正在整理开局资料…"语义重叠，write 事件已映射到 2。
- 移除 `STAGES[4]` "导演正在校准…"：dead code + director 已移除。
- 注释 `:85` 改为 `// 0 = 观察，1 = 阅读，2 = 整理/写入`。

## 7. 开局 prompt 第 5 条决策

### 现状（`source.ts:495`）

```
"5. 建模完成后，agent_call 导演写初始 director brief（save/director/current-brief.md）；你不代写 brief。",
```

### 决策：删除该条，不替换为 timeline 指令

理由：

- 开局 prompt 是高层指令，第 1 条已说"按 Skill《开局建模》的步骤执行"——timeline 锚点步骤在 Skill 正文里，prompt 不需要重复枚举。
- 原第 5 条存在是因为"agent_call 导演"是**跨 Agent 协作**，需要在 prompt 层提醒；timeline 锚点是 world-architect **自身职责**，不需要跨 Agent 提醒。
- 删除后第 6、7 条顺位上移为 5、6。新 prompt：

```
"5. 保持未来剧情 spoiler-safe；只使用开头窗口中读到的内容。",
"6. 如果写入遇到格式或校验错误，请按错误修正后重试，直到写入成功或明确失败。",
```

## 8. visibility 枚举 `director-only` 决策

### 现状

`NOVEL_AIRP_SCHEMA_GUIDE_MD` 受控词表（`:975-981`）：

```
player-known      # 玩家面向的叙述/前端安全；省略时默认
hidden            # 玩家当前看不见，但背景 Agent 可用
future-spoiler    # 未来的原著信息；不要泄露进玩家面向的叙述
director-only     # 策划/原著风险材料；说书人默认不应使用
```

### 决策：移除 `director-only`

按 Principle 9（每个字段必须有一个真实消费者）：

- `director-only` 的定义是"说书人默认不应使用"——但导演移除后，没有人来消费"导演专用"这个标记。
- 剩余三个值（`player-known`/`hidden`/`future-spoiler`）覆盖所有用例：
  - 原 `director-only` 的"原著风险材料"用 `future-spoiler` 覆盖。
  - 原 `director-only` 的"说书人不应使用"用 `hidden` 覆盖（背景 Agent 可用）。
- 保留 `director-only` 会让 Agent 困惑"这个 visibility 给谁看"——没有导演了。

### 影响面

- `NOVEL_AIRP_SCHEMA_GUIDE_MD` 受控词表段落：移除 `director-only` 行。
- `NOVEL_AIRP_SCHEMA_REFERENCE_MD` 若有对应段落：同步移除。
- schema guide `visibility` 字段说明中"deprecated keys"列表可补 `director-only`（标记为已废弃值）。
- grep 确认无 entity 实际使用 `director-only` 值（种子实体均未设置 visibility）。

## 9. schema 文档同步

### 9.1 NOVEL_AIRP_SCHEMA_GUIDE_MD

- 移除"runtime 与 director brief"措辞 → 改为"runtime 与 frontier.timeline"。
- 移除 `save/director/` 路径登记。
- 移除 director 职责行（Agent职责表）。
- `frontier.json` 段落补 `timeline` 字段说明。
- 受控词表移除 `director-only`。

### 9.2 NOVEL_AIRP_SCHEMA_REFERENCE_MD

- runtime fixed fields 段落：`worldTime` 已有，无需改。
- frontier 段落（若有）：补 `timeline`。
- 移除 brief/director 相关段落。

### 9.3 save/playthrough/README.md

- `frontier.json` 字段列表补 `timeline`。
- `runtime.json` 字段列表已有 `worldTime`，无需改。

## 10. 验证策略

### 10.1 构建验证

```bash
npm run build --workspace play-frontend-dev
npm run build:web
```

### 10.2 静态验证

```bash
# director/brief 零残留
rg -i "director|导演" apps/platform-web/src/storage/workspace-templates.ts
rg "current-brief|director brief|剧情指导" apps/platform-web/src/storage/workspace-templates.ts
rg -i "director" apps/play-frontend-dev/src

# timeline 已建立
rg "timeline" apps/platform-web/src/storage/workspace-templates.ts
```

### 10.3 浏览器验证

1. 开局向导导入小说 → Step 2 Understanding 运行 → 完成。
2. 检查 workspace：
   - `save/playthrough/frontier.json` 含 `timeline: [{chapter:1, time:"元年", label:"开局"}]`（chapter 可能被 world-architect 覆盖为实际开局章）。
   - `save/playthrough/runtime.json` 的 `worldTime` 为 `"元年"`。
   - `save/director/` 目录不存在。
   - `save/agents/director/` 目录不存在。
3. 检查 understanding loader：阶段文案正常推进（观察→阅读→整理），无"导演校准"阶段。

## 11. 回滚点

- B 是紧耦合原子任务，不建议中间回滚。若构建失败，整体 revert 后重做。
- 若浏览器验证发现 world-architect 未建 timeline 锚点，检查 Skill 正文是否清晰（可能需要补强步骤说明，不需回滚移除部分）。
