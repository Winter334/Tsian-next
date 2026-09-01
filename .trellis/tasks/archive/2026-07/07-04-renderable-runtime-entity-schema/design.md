# Design: 可渲染运行时与实体 schema 约定

## 1. Problem

当前 Novel AIRP schema 已有实体、场景、关系、runtime、容器、status/fields/sections 等基础结构，但它们主要面向 Agent 维护与语义检索。状态栏体系要求这些数据同时可被前端渲染：左侧状态栏、在场人物、角色卡、背包、容器、物品详情，以及未来装备槽等 UI 都需要从 workspace 数据自然生成。

不能让前端理解所有动态玩法 schema。剧情中可能临时出现“腐化值”“迷雾侵蚀”“契约层数”“审判证据可信度”等字段，它们不应要求前端硬编码业务语义。

同时也不能把所有 schema 都降级成通用字段列表，否则角色卡、背包、物品卡等 UI 会缺乏设计感。因此方案采用混合模式：

- 固定基础 schema → 前端硬编码契约，做精致专门 UI。
- 动态新增字段 → 通过扩展槽与预设渲染方案自然插入专门 UI。

## 2. Existing Contract Summary

当前契约已有以下基础：

- `save/playthrough/runtime.json`：高频访问、玩家面向或前端管理的运行时摘要。
- `save/entities/<type>/<localId>.json`：实体权威；最小字段 `id` / `name` / `brief`。
- `fields`：稳定 label/value 键值对，前端状态栏/卡片行式渲染。
- `sections`：title/body 段落块，前端详情面板或 Agent 上下文使用。
- `status`：轻量描述性状态。
- `{ ref, name }`：结构化引用；`name` 是展示快照，不是权威。
- `save/scenes/<localId>.json`：场景派生导航视图，`present` 存 ref/name/brief/status 摘要。
- container entity：用 `contents` ref 链表达背包/容器/装备槽等。

本设计不替换这些基础，只在其上增加可渲染扩展约定。

## 3. Core Concepts

### 3.1 Runtime as Status Surface

`save/playthrough/runtime.json` 本身是当前局面/状态栏数据面。它可以承载：

- 当前主控角色、当前位置、当前场景。
- 剧情时间、世界变量、坐标。
- 临时机制和局势状态。
- 背包/容器摘要。
- 前端希望扫读展示的当前状态。

维护 `runtime.json` 就是在维护状态栏可消费数据。不是所有字段都必须渲染；前端按固定字段、`extensions` 和自身 UI 选择性展示。

### 3.2 Fixed UI + Dynamic Extension Slots

固定 schema 可由前端做专门 UI：

- character → 角色卡。
- scene → 在场人物/场景面板。
- container → 背包/容器面板。
- item → 物品卡。
- runtime → 当前局面状态栏。

动态字段进入 `extensions`（推荐英文结构键）或 `扩展`（可作为中文别名，若后续前端选择支持）。推荐默认使用 `extensions`，其中的子 key 可以直接是中文显示名：

```json
{
  "extensions": {
    "腐化值": {
      "render": "progress",
      "value": 37,
      "max": 100,
      "tone": "danger"
    },
    "灵脉共鸣": {
      "render": "tag",
      "tone": "accent"
    }
  }
}
```

扩展字段不是“其它字段垃圾桶”。UI 根据 render 类型把它们插入预留槽位。

### 3.3 Slot Placement by Render Type

前端 UI 可以按实体类型和 render 类型预留槽位：

| Render type | Suggested slot |
|---|---|
| `progress`, `number` | 数值/仪表区 |
| `tag`, `status` | 状态标签区 |
| `ref`, `list`, `cards` | 关联入口、背包、装备、在场对象区 |
| `section`, `text` | 详情段落区 |

是否需要 `group` / `order` / `priority` 由具体 UI 子任务按实际效果决定。Schema 约定可预留这些字段，但不要求第一版必须使用。

### 3.4 Name / Alias Semantics

- `id`：稳定引用与路径定位，格式 `<type>:<localId>`。
- localId：id 后半段，可与显示名相同，但不承担 UI 显示语义。
- `name`：必填主显示名 / 当前 UI 标签。
- `aliases`：可选替代称呼，仅在存在昵称、称号、旧名、伪装名、不同称呼时维护。

前端显示优先级：`entity.name` → `ref.name` → id localId。

## 4. Extension Item Shape

### 4.1 Common Shape

```json
{
  "render": "progress",
  "value": 37,
  "max": 100,
  "tone": "danger",
  "description": "接近失控阈值。"
}
```

Common fields:

- `render`：预设渲染类型，推荐必填。
- `value`：主要值。
- `label`：可选显示名；省略时使用 `extensions` 子 key。
- `tone`：可选色调，例如 `neutral` / `accent` / `success` / `warning` / `danger` / `muted`。
- `description`：可选说明。
- `visibility`：可选；遵循现有 visibility 语义。
- `group` / `order` / `priority`：可选；具体 UI 需要时再采用。

### 4.2 Preset Render Types

第一版约定建议支持以下有限集合：

| render | Purpose | Example fields |
|---|---|---|
| `text` | 单段文本 | `value` |
| `number` | 数字/短值 | `value`, `unit`, `tone` |
| `progress` | 进度/量表 | `value`, `max`, `min`, `tone` |
| `tag` | 单标签 | `value?`, `tone` |
| `tags` | 标签组 | `items` |
| `list` | 文本或轻量项列表 | `items` |
| `section` | 标题 + 正文 | `title?`, `body` |
| `ref` | 单个结构化引用 | `ref`, `name` |
| `cards` | 多个卡片/引用摘要 | `items` |

Agent 不应发明任意 `render` 类型。若需要新 UI 类型，应先更新 schema/docs 与前端预设，再使用。

## 5. Examples

### 5.1 Runtime Example

```json
{
  "turn": 6,
  "activeSceneIds": ["scene:山门冲突"],
  "activeScene": { "ref": "scene:山门冲突", "name": "山门冲突" },
  "player": {
    "character": { "ref": "character:萧玄", "name": "萧玄" },
    "location": { "ref": "location:青玄门山门", "name": "青玄门山门" }
  },
  "inventory": {
    "primaryContainer": { "ref": "container:玩家储物袋", "name": "我的储物袋" },
    "state": "near-full"
  },
  "status": [
    { "id": "constraint:储物袋接近满载", "description": "不宜继续收纳大件物品。" }
  ],
  "extensions": {
    "当前时间": { "render": "text", "value": "赤明纪十二年三月初七，黄昏" },
    "迷雾侵蚀": { "render": "progress", "value": 72, "max": 100, "tone": "danger" }
  },
  "updatedAtTurn": 6,
  "updatedBy": "post-processing"
}
```

### 5.2 Character Example

```json
{
  "id": "character:萧玄",
  "name": "萧玄",
  "brief": "青玄门外门弟子，当前卷入山门冲突。",
  "aliases": ["萧师弟"],
  "status": [
    { "id": "injury:右臂轻伤", "level": "minor", "description": "挥剑时略有迟滞。" }
  ],
  "fields": [
    { "label": "境界", "value": "炼气后期" },
    { "label": "气血", "value": "不稳", "render": "text", "tone": "warning" }
  ],
  "sections": [
    { "title": "当前目标", "body": "查清山门冲突的起因。" }
  ],
  "extensions": {
    "腐化值": { "render": "progress", "value": 37, "max": 100, "tone": "danger" },
    "契约对象": { "render": "ref", "ref": "character:玄衣少女", "name": "玄衣少女" }
  },
  "updatedAtTurn": 6,
  "updatedBy": "post-processing"
}
```

### 5.3 Container Example

```json
{
  "id": "container:玩家储物袋",
  "name": "我的储物袋",
  "brief": "下品储物法器，空间有限。",
  "contents": [
    { "ref": "item:下品灵石", "name": "下品灵石", "quantity": 12 },
    { "ref": "container:青玉匣", "name": "青玉匣", "quantity": 1 }
  ],
  "capacityNote": "接近满载",
  "status": [
    { "id": "constraint:接近满载", "description": "不宜继续收纳大件物品。" }
  ],
  "extensions": {
    "封印强度": { "render": "progress", "value": 80, "max": 100, "tone": "accent" }
  },
  "updatedAtTurn": 6
}
```

### 5.4 Item Example

```json
{
  "id": "item:云纹剑",
  "name": "云纹剑",
  "brief": "剑身有淡淡云纹的长剑。",
  "tags": ["武器", "剑"],
  "fields": [
    { "label": "品阶", "value": "下品法器" }
  ],
  "extensions": {
    "耐久": { "render": "progress", "value": 64, "max": 100, "tone": "warning" }
  }
}
```

### 5.5 Scene Example

```json
{
  "id": "scene:山门冲突",
  "name": "山门冲突",
  "location": { "ref": "location:青玄门山门", "name": "青玄门山门" },
  "present": [
    { "ref": "character:萧玄", "name": "萧玄", "brief": "青玄门外门弟子。", "status": "右臂轻伤" },
    { "ref": "character:赵长老", "name": "赵长老", "brief": "内门执法长老。" }
  ],
  "status": "active",
  "extensions": {
    "戒严等级": { "render": "progress", "value": 3, "max": 5, "tone": "warning" }
  },
  "updatedTurn": 6,
  "updatedBy": "post-processing"
}
```

## 6. Agent / Skill Guidance

The data files should contain state and display metadata, not maintenance instructions. Maintenance behavior belongs in:

- `agents/post-processing/AGENT.md` for role responsibility.
- `skills/world-state-maintenance/SKILL.md` for structured write guidance.
- `save/schema/current.md`, `changelog.md`, `deprecated.md`, and pending patches for living schema decisions.
- `docs/novel-airp-schema-guide.md` / reference for reusable schema instructions.

Agent guidance should say:

- Use fixed fields when a value belongs to an established schema.
- Use `extensions` for new/temporary player-visible fields that need UI rendering.
- Pick render types from the preset list.
- Do not invent arbitrary UI types in data files.
- Remove or update expired runtime/entity extension fields opportunistically when touching related files.

## 7. Compatibility

- All new fields are optional; old saves remain valid.
- New default `save/playthrough/runtime.json` should include `extensions: {}` to make runtime extensibility explicit.
- Existing saves or older runtime files without `extensions` are treated as if `extensions` were `{}`.
- Frontends should ignore unknown render types or display a safe fallback.
- No IndexedDB migration is needed.
- No platform contract change is needed unless future frontend code wants shared TS types; this task can be documentation/template-only.

## 8. Tradeoffs

### Why `extensions` instead of arbitrary top-level fields?

Top-level Chinese fields are readable but make it harder for frontends to distinguish fixed schema from dynamic display fields. A dedicated `extensions` object preserves fixed schema clarity while still allowing Chinese display names as extension keys.

### Why not a universal renderer?

A universal renderer would make every UI look like a generic JSON dashboard. The desired player experience needs character cards, backpacks, item cards, scene panels, and future equipment slots to be custom-designed. The generic part is only the extension slot inside those UIs.

### Why keep `name` instead of using id localId?

`id` is for stable references and file paths; `name` is for display. They often match today but can diverge for localization, aliases, disguises, slugs, or revealed identities.

## 9. Open Questions (动工前讨论)

> 以下问题在 2026-07-05 设计评审中提出。本任务主体在评审前已由 airp-roster 子任务（默认 Agent/Skill 模板重写）顺带完成，OQ 处理结果记录如下。

### OQ-1: 契约可执行原型 ~~（待讨论）~~ → 关闭

讨论结论：任务 2（`07-04-frontend-runtime-render-infra`）本身就是契约的可执行验证——它会实现完整的前端解析基础设施。单独再做一个 30 行原型无意义。若任务 2 发现契约不好用，回头改 schema docs（这正是 schema 任务"文档级"性质的好处）。

### OQ-2: render type 演进策略 ~~（待讨论）~~ → 部分解决 + 转移

讨论结论：不补 meter/grid/badge/timer 等新预设类型。用户判断：Agent 通过脚本写入时校验更可靠，新 render 类型的字段定义交给"脚本校验 + 实际需求"驱动，在 `action-resolution-system` / `containers` 等任务里由对应 Skill + 脚本一起定，而不是现在空想。

本任务只补一句 schema 约定："`render` 可省略 → 朴素文本展示；写了 `render` 但值不在 preset 里 → fail loud（warn + 隐藏），不静默降级"。已落地到 `novel-airp-workspace-schema-direction.md` §render preset 段落和 `NOVEL_AIRP_SCHEMA_GUIDE_MD`。

"脚本校验前移"导向了独立的平台层任务 `07-05-agent-tool-mechanism`（类 MCP 工具发现 + 卡定制层），不属本任务。

### OQ-3: ref 快照 vs entity 权威的漂移校验 ~~（待讨论）~~ → 关闭

讨论结论：本任务已定义 ref 快照语义（§3.4 name/aliases/localId 语义 + direction doc P4 runtime/entity authority）。实际的场记漂移校验机制归 `07-04-airp-agent-roster-skills` OQ-4（场记漂移校验钩子），不在 schema 任务范围。
