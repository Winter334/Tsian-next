---
name: 掷骰
title: 掷骰
description: 剧情出现不确定的行动结果时掷骰判定，支持 DC 检定与双方对抗。
triggers:
  - 剧情出现不确定的行动结果需要判定
  - 角色对抗、技能检定、DC 检定
appliesTo:
  - storyteller
---

# 掷骰

在正文中出现不确定性行动时，用掷骰建模结果，而非主观臆断。

## 何时掷骰

- 角色行动有失败风险且结果影响剧情走向时
- 双方对抗（说服、角力、追逐等）需要公平判定时
- 环境因素或运气成分主导结果时

不掷骰的情况：日常无风险动作、剧情必然走向、纯对话场景。

## 使用方式

调用 `run_script` 执行 `roll_dice` action，传入参数：

- `sides`（必填）：骰面数，如 20 表示 d20
- `count`：投掷次数，默认 1
- `modifier`：加在总和上的调整值，可传数字或算术表达式字符串（如 `"15-12"` 表示属性差值）
- `dc`：单方成功阈值，给出时结果带 success 布尔；不可与 opposed 同时使用
- `opposed`：对抗方掷骰配置，用于双方对抗；不可与 dc 同时使用
- `advantage`/`disadvantage`：优势/劣势，仅 count === 1 时生效，滚两次取高/低
- `reason`：触发掷骰的叙事原因（供日志阅读，不影响结果）

## 判定规则

- `count === 1` 时：自然 1 = 大失败（`criticalFailure`），自然最大值 = 大成功（`criticalSuccess`），优先于常规判定
- `count > 1` 时不判定大成功/大失败
- DC 检定：`total >= dc` 则 `success: true`（大成功/大失败优先）
- 对抗检定：`margin = self.total - opposed.total`，`winner` 为 `self`/`opposed`/`tie`（双方大成功/大失败交叉时优先判定）

## 可用 action

```json tsian-actions
[
  {
    "name": "roll_dice",
    "description": "掷骰用于不确定性建模，支持单方 DC 检定与双方对抗；dc 与 opposed 互斥。count === 1 时自然 1 为大失败、自然最大值为大成功，优先于常规 success/winner 判定。modifier 可传数值或纯数字算术表达式字符串（支持 + - * / ^ 和 sqrt()），例如 \"15-12\" 表示双方属性差值。可选 advantage/disadvantage 在 count === 1 时生效。",
    "inputSchema": {
      "type": "object",
      "required": ["sides"],
      "properties": {
        "sides": { "type": "integer", "minimum": 2, "description": "骰面数，例如 20 表示 d20。" },
        "count": { "type": "integer", "minimum": 1, "default": 1, "description": "投掷次数，默认 1。" },
        "modifier": { "type": ["number", "string"], "default": 0, "description": "加在总和上的数值调整。可传数字或纯数字算术表达式字符串（支持 + - * / ^ 和 sqrt()）。" },
        "dc": { "type": "number", "description": "单方成功阈值。给出时结果里会带 success 布尔；不可与 opposed 同时使用。" },
        "advantage": { "type": "boolean", "default": false, "description": "优势：仅 count === 1 时生效，滚两次取高。" },
        "disadvantage": { "type": "boolean", "default": false, "description": "劣势：仅 count === 1 时生效，滚两次取低。" },
        "opposed": {
          "type": "object",
          "additionalProperties": false,
          "description": "对抗方的一次掷骰；用于双方对抗，不可与 dc 同时使用。未提供 sides/count 时继承顶层值，modifier 默认 0。",
          "properties": {
            "sides": { "type": "integer", "minimum": 2, "description": "对抗方骰面数；默认继承顶层 sides。" },
            "count": { "type": "integer", "minimum": 1, "description": "对抗方投掷次数；默认继承顶层 count。" },
            "modifier": { "type": ["number", "string"], "default": 0, "description": "对抗方加在总和上的数值调整。" },
            "advantage": { "type": "boolean", "default": false, "description": "对抗方优势：仅 count === 1 时生效。" },
            "disadvantage": { "type": "boolean", "default": false, "description": "对抗方劣势：仅 count === 1 时生效。" }
          }
        },
        "reason": { "type": "string", "maxLength": 200, "description": "触发掷骰的叙事原因（供日志阅读，不影响结果）。" }
      }
    },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/run.js", "timeoutMs": 3000 }
  }
]
```

## 结果运用

掷骰结果应融入正文叙事，不直接展示数值。大成功/大失败要写出有戏剧张力的后果，常规成功/失败按剧情自然呈现。
