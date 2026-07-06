# Design: roll_dice 工具对抗扩展

## Overview

本任务只扩展默认 `roll_dice` Tool 的声明与脚本实现，让它支持单次调用完成双方对抗。实现仍位于 `apps/platform-web/src/storage/workspace-templates.ts` 的默认 workspace 种子中：

- `tools/roll_dice/tool.json`
- `tools/roll_dice/run.js`

不改 Tool registry、executor、Agent 配置或 Skill 文档。

## Contract

### Input

现有字段保持：

- `sides: integer >= 2`，必填。
- `count: integer >= 1`，默认 1。
- `modifier: number`，默认 0。
- `dc?: number`。
- `advantage?: boolean`。
- `disadvantage?: boolean`。
- `reason?: string`。

新增：

```json
{
  "opposed": {
    "sides": 20,
    "count": 1,
    "modifier": 0,
    "advantage": false,
    "disadvantage": false
  }
}
```

`opposed` 字段语义：

- `opposed.sides` 默认继承顶层 `sides`。
- `opposed.count` 默认继承顶层 `count`。
- `opposed.modifier` 默认 0。
- `opposed.advantage` / `opposed.disadvantage` 默认 false。
- 顶层 `reason` 描述整个对抗原因，不在 `opposed` 内重复。

### Mutually exclusive fields

`dc` 与 `opposed` 互斥。

原因：`dc` 产出“是否达到难度阈值”，`opposed` 产出“双方相对高低”。两者同时出现会制造“成功 / 胜负”双重判定。Tool 必须 fail loud，避免 Agent 在歧义输出上继续创作。

实现要求：在调用 `tsian.lib.random.dice` 前先检查互斥条件，确保错误路径不产生随机数。

### Output without opposed

保持现有结构：

```json
{
  "sides": 20,
  "count": 1,
  "modifier": 2,
  "rolls": [13],
  "kept": [13],
  "total": 15,
  "dc": 13,
  "success": true,
  "reason": "..."
}
```

### Output with opposed

新增对抗字段：

```json
{
  "sides": 20,
  "count": 1,
  "modifier": 2,
  "rolls": [13],
  "kept": [13],
  "total": 15,
  "opposed": {
    "sides": 20,
    "count": 1,
    "modifier": 1,
    "rolls": [12],
    "kept": [12],
    "total": 13
  },
  "margin": 2,
  "winner": "self",
  "reason": "..."
}
```

`winner` 计算：

- `margin > 0` → `"self"`
- `margin < 0` → `"opposed"`
- `margin === 0` → `"tie"`

平局是 AIRP 中合法叙事事实。Tool 不提供 `tieBreak`、不重投、不强制判胜方。

## Validation and errors

`run.js` 保持 fail-loud 风格，错误码沿用 `ROLL_DICE_INVALID_ARGS`。

需要在脚本层显式校验：

- `dc` 与 `opposed` 同时存在：抛 `ROLL_DICE_INVALID_ARGS`，details 包含 `{ dc, opposed: true }`。
- `modifier` 转换后不是 finite number：抛 `ROLL_DICE_INVALID_ARGS`，details 包含对应 modifier。
- `opposed.modifier` 转换后不是 finite number：抛 `ROLL_DICE_INVALID_ARGS`。
- `opposed` 如果存在但不是 object：抛 `ROLL_DICE_INVALID_ARGS`。

`sides` / `count` / advantage-dice 细节继续交给 `tsian.lib.random.dice` 校验与执行。当前 SDK 会校验 `sides >= 2`、`count >= 1`、`modifier` finite number，并返回 `{ rolls, kept, modifier, total }`。

## Implementation shape

在 `tools/roll_dice/run.js` 种子脚本中抽取内部 helper：

```js
function isRecord(value) { ... }
function invalidArgs(message, details) { ... }
function normalizeNumber(value, fallback, name) { ... }
function rollOnce(config, tsian) { ... }
```

主流程：

1. 校验 input 是 object。
2. 识别 `hasDc` 与 `hasOpposed`。
3. 如果 `hasDc && hasOpposed`，抛错并返回，不投骰。
4. 组装顶层 config 并调用 `rollOnce`。
5. 输出顶层结果。
6. 若 `dc` 存在，计算 `success`。
7. 若 `opposed` 存在，组装 opposed config，调用 `rollOnce`，计算 `margin` / `winner`。
8. 回填 `reason`。
9. `tsian.trace` 增加 `opposedTotal`、`margin`、`winner`（仅对抗时）。

## Compatibility

- 现有单方调用参数不变，输出字段不删减。
- `reason` 字段保留，继续 trim + slice 到 200。
- `advantage` / `disadvantage` 行为不改：两个都为 true 时相互抵消；只在 `count === 1` 时由 `tsian.lib.random.dice` 生效。
- `tool.json` 的 `additionalProperties: false` 继续保留，新增字段必须在 schema 中声明。

## Boundaries

本设计不改：

- Tool registry / diagnostics。
- Browser script executor / `tsian.lib.random` SDK。
- Agent / Skill / `contextPaths`。
- `mode.json`。
- UI。

## Rollback

回滚只需恢复 `workspace-templates.ts` 中 `tools/roll_dice/tool.json` 与 `tools/roll_dice/run.js` 两个种子内容。若用户 workspace 已播种旧文件，平台不做自动迁移；默认 seed 影响新建 workspace / 默认卡内容。
