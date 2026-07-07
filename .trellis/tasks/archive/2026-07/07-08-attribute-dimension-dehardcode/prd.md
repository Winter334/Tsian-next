# 六维属性名称去硬编码

## Goal

`attributes` 维度固定 6 个，但键名由世界架构师按世界观定义（默认六维兜底：体魄/悟性/气运/根骨/法力/魅力）。全栈去掉对 6 个固定中文名的硬编码，改为运行时遍历。不做历史数据兼容（当前全是测试数据，可丢弃）。

## Background

当前 `CharacterAttributes` 类型把 6 个中文键（体魄/悟性/气运/根骨/法力/魅力）当固定常量，全栈 8 处硬编码遍历/校验。修仙/武侠/科幻世界观维度名不同，应允许 world-architect 开局建模时改名，前端/agent 脚本/文档不写死键名。

**维度数量保持 6**（不改数量），理由：开局信息量通常不足以支撑"几个维度"的决策，固定 6 维是保守选择可应对大部分世界观；世界观明确时只改键名。

**数据形态保持 object**（不改数组），理由：`attributes.体魄` 索引对 storyteller/roll_dice 友好；维度名即显示名，中文场景不需要 id≠name；`Object.entries` 天然支持任意键名。

## Requirements

### R1: 类型放开
- `CharacterAttributes` 接口：6 个固定中文键 → `Record<string, number>`
- 注释更新：明确"固定 6 维，键名由世界架构师按世界观定义，默认体魄/悟性/气运/根骨/法力/魅力，值为正整数基线 5"

### R2: 解析遍历化
- `parseAttributes`：删除固定 `KEYS` 数组，改用 `Object.entries(raw)` 遍历取 number 值
- 非数值丢弃该键（与现有逐键校验语义一致）

### R3: 注入遍历化
- `context-injection.ts` `formatProtagonistBlock` 属性块：删除固定 `order` 数组，改用 `Object.entries(attr)` 遍历
- 按 JSON 写入顺序输出（JSON 保序）

### R4: pin 白名单移除
- `pin-types.ts` 删除 `ATTRIBUTE_KEYS` 白名单常量
- `readPinValue` attribute 分支：去掉 `ATTRIBUTE_KEYS.has(key)` 校验，直接查 `entity.attributes?.[key]`，有 number 值则命中，否则 missing
- 注释更新：`key = attributes 的维度键名`（不再列举具体名）

### R5: UI 遍历化
- `AttributesPane.vue`：删除 `ATTR_KEYS` 固定数组和 `CharacterAttributes` import，改用 `Object.entries(props.attributes ?? {})` 遍历生成 `AttrRow[]`
- `AttributeCard.vue`：注释更新（"六维基础维度单卡"→"基础维度单卡"，pin key 注释更新）
- PinButton target 的 `key: name` 不变（已是动态）

### R6: agent 脚本遍历化
- `workspace-templates.ts` `formatAttributes` 脚本（researcher read-entity tool 用）：删除固定 `order` 数组，改用 `Object.keys(attributes)` 遍历

### R7: schema 文档措辞更新
- Stage-manager maintenance skill：`attributes`（六维：体魄/…）→（固定6维，键名由世界架构师按世界观定义，默认体魄/…，基线5）
- Schema guide：同上改写
- Schema reference：`attributes` 六维基线为 5 → 固定6维，键名由世界架构师按世界观定义，基线为5
- current.md 模板：`attributes` (six dimensions 体魄/…, baseline 5) → (fixed 6 dimensions, keys defined by world-architect per worldview, defaults: 体魄/…, baseline 5)

## Acceptance Criteria

- [x] `CharacterAttributes` 改为 `Record<string, number>`，无固定中文键
- [x] `parseAttributes` / `formatProtagonistBlock` / `AttributesPane` / `formatAttributes` 脚本全部用 `Object.entries`/`Object.keys` 遍历，无固定键名数组
- [x] `pin-types.ts` 无 `ATTRIBUTE_KEYS` 白名单，`readPinValue` attribute 分支直接查 key
- [x] schema 文档（guide/reference/maintenance/current.md）措辞改为"固定6维，键名可配置"
- [x] `vue-tsc --noEmit` 无新增类型错误（预存的 CharacterPortrait/ItemDetailModal 错误不在本任务范围）
- [x] `grep` 验证全栈无残留 `'体魄', '悟性'` 固定数组 / `ATTRIBUTE_KEYS` 白名单
- [x] 前端 build 通过（play-frontend-dev + platform-web `build:web` 均通过）

## Out of Scope

- 状态栏前端报错（CharacterPortrait/ItemDetailModal TS 错误）— 用户可能重构状态栏，暂不处理
- 维度数量可配置 — 固定 6 维
- 历史数据兼容 — 测试数据可丢弃
- world-architect 开局建模流程的实际改动 — 仅改文档措辞让 agent 知道键名可配置，具体建模行为不变
