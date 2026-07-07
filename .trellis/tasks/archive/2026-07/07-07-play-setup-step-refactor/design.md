# 游玩设定步重构 — 技术设计

> 父任务 `07-06-agent-roster-progressive-refactor/design.md` 记录了素材库模型转变的完整推理。本文档只记录 C 特有的「怎么执行」决策。

## 1. 变更面总览

| 层 | 变更 | 文件 |
| - | - | - |
| 前端 prompt | 清理旧残留，改为新访谈指令 | `apps/play-frontend-dev/src/lib/source.ts` `buildPlaySetupPrompt` |
| 前端 Step 4 UI | complete 时隐藏选项，防止提前展示 | `apps/play-frontend-dev/src/components/setup/step4/PlaySetupDialog.vue` |
| 默认模板 Skill | 重写《游玩设定》正文 | `apps/platform-web/src/storage/workspace-templates.ts` `PLAY_SETUP_SKILL_MD` |
| 默认模板 Skill action | 新增 `commit_play_setup` | 同上，新增脚本常量 + DEFAULT_WORKSPACE_FILES 登记 |
| 默认模板 schema 文档 | 增加 `character.traits[]` | 同上，`NOVEL_AIRP_SCHEMA_GUIDE_MD` + `NOVEL_AIRP_SCHEMA_REFERENCE_MD` + `save/schema/current.md` |
| 前端类型 | 增加 `CharacterTrait` + 解析 | `apps/play-frontend-dev/src/lib/character-types.ts` + `parse-character.ts` |
| 前端 context injection | protagonist block 输出 traits | `apps/play-frontend-dev/src/lib/context-injection.ts` `formatProtagonistBlock` |

## 2. `character.traits[]` schema

### 2.1 字段形态

```json
{
  "traits": [
    {
      "id": "trait:明镜心",
      "name": "明镜心",
      "description": "一种天生澄澈、难染外邪的心性天赋。",
      "effects": [
        "能够堪破虚妄",
        "心神不受外力影响"
      ]
    }
  ]
}
```

- `id`：必填，`trait:<localId>` 格式。
- `name`：必填，展示名。
- `description`：可选，特质本身的设定说明。
- `effects`：可选，字符串数组，具体可用效果/限制/叙事影响。

### 2.2 语义边界

| 字段 | 语义 | 例子 |
| - | - | - |
| `traits[]` | 永久稳定特质/能力来源 | 特殊体质、天赋、系统、血脉、命格 |
| `status[]` | 当前临时状态 | 受伤、中毒、灵力亏空、buff |
| `gauges[]` | 数值进度 | 血脉觉醒度、系统能量 |
| `identity` | 稳定身份键值对 | 年龄、性别、身份、所属、境界 |
| `background` | 背景叙事 | 角色来历 |

### 2.3 消费者

| 消费者 | 读法 | 决策 |
| - | - | - |
| `formatProtagonistBlock` | 读主角 entity `traits[]` | 注入 storyteller 上下文，让正文反映特质效果 |
| world-architect Skill《游玩设定》 | 写入主角 entity | Step 4 收集并落盘 |
| storyteller（正式回合，子任务 D） | 读 context injection 中的 traits | 写正文时体现特质 |

本任务不新增 traits 前端 UI。

### 2.4 前端类型与解析

`character-types.ts`：

```ts
export interface CharacterTrait {
  id: string
  name?: string
  description?: string
  effects?: string[]
}
```

`CharacterEntity` 新增 `traits?: CharacterTrait[]`。

`parse-character.ts`：新增 `parseTraits(raw)`，逐项校验 `id` 必填，`name`/`description` 可选字符串，`effects` 可选字符串数组。

## 3. Skill《游玩设定》正文设计

### 3.1 frontmatter

```yaml
name: 游玩设定
title: 游玩设定
description: 引导玩家补充本局特别设定（特殊体质、天赋、系统等），确认后落盘并生成开局正文。
triggers:
  - 玩家完成角色设定后进入游玩设定对话
appliesTo:
  - world-architect
```

### 3.2 正文骨架

```markdown
# 游玩设定

本 Skill 引导玩家补充本局特别设定，确认后落盘并生成开局正文。

## 访谈

逐轮提问，每次最多 1～2 个问题。每个问题附带 [[选项]] 模板，允许自由输入。

### 问题 1：特别设定

> 这局你想给主角加点什么特别设定吗？可以直接选一个模板，也可以自己说。没有的话我们直接开始。

[[选项]]
- 不加特殊设定，直接开始
- 给主角一个特殊体质/天赋（如天生剑骨、明镜心、不灭血脉）
- 给主角一个系统/外挂（如签到系统、模拟器、面板提示）
- 改变主角处境（如多一个隐藏身份、被宗门误会、其实是某位大能转世）
- 我自己描述
[[/选项]]

### 问题 2：能力详情（仅当玩家选了特殊体质/天赋/系统）

> 好。请说说它是什么、能做什么。可以选快捷模板，也可以自己填。

快捷模板：
[[选项]]
- 偏修炼：提升某方面修炼速度/亲和/悟性
- 偏战斗：更强感知、爆发、恢复或防御
- 偏探索：看破幻象、发现隐藏线索、感知危险
- 偏系统：签到/任务/模拟/提示/面板
[[/选项]]

如果玩家选了快捷模板，追问名称和具体效果描述。

### 问题 3：处境详情（仅当玩家选了改变处境）

> 你想怎么改变主角的处境？

[[选项]]
- 开局多一个隐藏身份
- 被宗门/势力误会或针对
- 其实是某位大能转世
- 与原著某角色有额外关系
[[/选项]]

### 收尾确认

信息收集齐后：

> 设定已收集齐。你还有想补充或修改的吗？

[[选项]]
- 还有补充
- 想修改前面的设定
- 直接开始
[[/选项]]

## 开局钩子

不由玩家决定切入点。根据玩家设定和已读开局素材安排：
- 原著角色：默认沿用原著开局。
- 原创角色：根据角色设定合理嵌入世界。
- 特殊能力（traits）可影响开局呈现。

## 落盘

玩家选择「直接开始」后：

1. 整理给 storyteller 的上下文：主角信息、traits、已读开局素材边界、本局设定摘要。
2. agent_call storyteller，expectedOutput 要求返回【开局正文】+【初始选项】3～5 个。
3. storyteller 返回后，调 `commit_play_setup` 一次写入：
   - 主角 entity 的 `traits[]`
   - `setup-summary.json`（小说简介式 summary）
   - `opening-narrative.json`（开局正文，不含选项）
4. 最终回复玩家：「开局已准备好，进入故事即可开始。」附 [[选项]]（初始行动选项）。
5. 不在回复中展示开局正文全文。

## 可用 action

（tsian-actions 块声明 commit_play_setup）

## spoiler-safe

只使用开局窗口中读到的内容。不推断、不剧透未来剧情。
```

### 3.3 不写入 Skill 的内容

- 不写 `mode.json` / 玩法启用 / 三态选择。
- 不写 director / brief。
- 不写 storyteller 的职责说明（那是 storyteller 自己的 AGENT.md）。
- 不写 traits 的 schema 定义（那是 schema 文档）。

## 4. `commit_play_setup` action 设计

### 4.1 inputSchema

```json
{
  "type": "object",
  "required": ["protagonistRef", "summary", "openingNarrative"],
  "properties": {
    "protagonistRef": { "type": "string", "description": "主角 entity ref，如 character:萧玄" },
    "traits": {
      "type": "array",
      "description": "永久特质数组；无则省略或空数组。",
      "items": {
        "type": "object",
        "required": ["id", "name"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "effects": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "summary": { "type": "string", "description": "小说简介式设定摘要（≤2000字）" },
    "openingNarrative": { "type": "string", "description": "开局正文（不含选项块）" }
  }
}
```

### 4.2 脚本行为

1. 校验 `protagonistRef` 指向已存在 character entity。
2. 校验 `summary` 非空 ≤ 2000 字。
3. 校验 `openingNarrative` 非空。
4. 校验 `traits[]` 每项 `id`（`trait:<localId>` 格式）+ `name` 必填，`description`/`effects` 可选。
5. read-modify-write 主角 entity：合并 `traits[]`（按 `id` 去重覆盖，保留 entity 其他字段不变）。
6. 写 `save/playthrough/setup-summary.json` = `{ status: "complete", summary, committedAt }`。
7. 写 `save/playthrough/opening-narrative.json` = `{ narrative: openingNarrative, createdAt }`。
8. 返回 `{ status: "ready", writes: [...] }`，**不返回 narrative 正文**，避免 Step 4 UI 提前展示。

### 4.3 helpers

复用 `scripts/_common.js`（`isRecord`/`fail`/`normalizeString`/`normalizeEntityId` 等）。

### 4.4 与旧脚本关系

- `commit-setup-summary.js` 和 `commit-opening-narrative.js` 保留在默认模板文件列表中（不删文件，避免破坏已有存档/其他引用），但 Skill《游玩设定》正文只引导用 `commit_play_setup`。
- 开局建模 Skill《开局建模》不引用 `commit_play_setup`（它不提交 setup summary）。

## 5. 前端 Step 4 UI：不提前展示开局正文与选项

### 5.1 opening narrative 不展示

world-architect 最终回复不包含开局正文全文（Skill 指令约束 + `commit_play_setup` 返回值不含正文），因此 `PlaySetupDialog` 自然不会展示正文。无需额外前端改动。

### 5.2 初始选项不在 Step 4 可操作

world-architect 最终回复包含 `[[选项]]`（供 StoryView 恢复），但 Step 4 对话界面不应让玩家操作这些选项。

当前 `PlaySetupDialog.vue`：

```vue
<StoryOptions
  v-if="msg.options && msg.options.length > 0"
  :options="[...msg.options]"
  :disabled="status === 'running' || status === 'complete'"
  @select="onSelectOption"
/>
```

`disabled` 已阻止点击，但选项内容仍可见。改为 complete 时隐藏：

```vue
<StoryOptions
  v-if="msg.options && msg.options.length > 0 && status !== 'complete'"
  ...
/>
```

这样 Step 4 complete 后选项不显示，但 context slot 中的 `[[选项]]` 仍保留，供 `loadPlaySetupOptions()` 恢复到 StoryView。

### 5.3 buildPlaySetupPrompt 重写

新 prompt 只传达：
- 玩家已完成导入、理解、角色设定，进入游玩设定对话。
- 请作为 world-architect 使用 Skill《游玩设定》引导玩家。
- 附书名、玩家角色信息。
- 开始第一轮对话。

不包含：mode.json、三态玩法、commit_mode、agent_call storyteller 步骤（这些放 Skill 正文）。

## 6. context injection 更新

`formatProtagonistBlock`（`context-injection.ts`）在 status/gauges 之后追加 traits block：

```ts
const traits = characterJson["traits"]
if (Array.isArray(traits) && traits.length > 0) {
  const traitLines: string[] = []
  for (const t of traits) {
    if (!isRecord(t)) continue
    const tName = getString(t, "name") ?? getString(t, "id")
    if (!tName) continue
    const description = getString(t, "description")
    let entry = `  · ${tName}`
    if (description) entry += ` — ${description}`
    traitLines.push(entry)
    const effects = t["effects"]
    if (Array.isArray(effects)) {
      for (const e of effects) {
        if (typeof e === "string" && e.trim()) {
          traitLines.push(`    · 效果：${e.trim()}`)
        }
      }
    }
  }
  if (traitLines.length > 0) {
    lines.push("- 特质：")
    lines.push(...traitLines)
  }
}
```

这让 storyteller 在正式回合中能看到主角 traits，从而在叙事中体现。

## 7. schema 文档更新

### 7.1 `save/schema/current.md`

`Recommended fields` 列表增加 `traits`。

### 7.2 `NOVEL_AIRP_SCHEMA_GUIDE_MD`

- 实体推荐字段列表增加 `traits`。
- 新增 `traits` 条目：永久特质数组，每项 `{ id, name, description?, effects? }`；表示特殊体质、天赋、系统、血脉、命格等稳定能力来源；区别于 `status[]`（当前临时状态）。

### 7.3 `NOVEL_AIRP_SCHEMA_REFERENCE_MD`

- character 详尽示例增加 `traits`。
- 字段说明增加 `traits` 条目。

## 8. tradeoffs

| 决策 | 选择 | 放弃的替代 | 理由 |
| - | - | - | - |
| 收尾落盘 | 单 action `commit_play_setup` | 保留分散 `commit_setup_summary` + `commit_opening_narrative` + 新增 `commit_traits` | 避免半写入；避免正文泄露到 UI；减少 Agent 协调错误 |
| 永久特质 | 新增 `traits[]` | 扩义 `status[]` | 语义清晰；status 保持临时状态语义；traits 有真实消费者 |
| traits UI | 本任务不做 | 状态栏/人物卡新增 traits 区 | 按玩家流程渐进重构；当前步骤没到游戏界面 |
| storyteller AGENT | 不改 | 补「可被 world-architect 调用生成开局正文」 | 避免把具体流程写进常驻身份；留给子任务 D |
| 调性 | 不问 | 新增偏好字段 + 持续注入 | 无稳定消费者；空谈 |
| 开局钩子 | Agent 安排 | 玩家决定切入点 | 玩家未必知道原著 |
