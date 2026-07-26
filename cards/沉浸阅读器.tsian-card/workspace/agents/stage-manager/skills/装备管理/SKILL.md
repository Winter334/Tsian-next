---
name: 装备管理
title: 装备管理
description: 以确定性规则装备、卸下或刷新角色装备投影。
triggers:
  - 角色穿戴、卸下或替换装备
  - 角色基础属性或持有关系变化后刷新装备投影
appliesTo:
  - stage-manager
---

# 装备管理

只通过本 Skill 维护角色的 `attributes` 与 `equipment`。物品继续留在角色独占的容器图内；不要先用通用编辑工具改装备投影。

## 操作

- `equip`：把可达的装备物品放入已有槽位，也可直接替换占用槽。传入当前槽位精确 `expectedCurrentRef`。
- `unequip`：清空已有占用槽。传入当前非空 `expectedCurrentRef`。
- `refresh`：在物品规则、持有关系或角色非装备属性发生变化后重算整张装备投影。普通属性增减放入 `attributeChanges`，它表示对非装备基线的增量。

脚本会验证引用、固定槽位容量、容器独占、可达数量、属性名与安全整数，并在全部计算完成后仅写一次角色文件。失败时按返回的稳定 code 修正数据后重试；`EQUIPMENT_REFRESH_REQUIRED` 表示先执行 `refresh`，再重试装备或卸下。

```json tsian-actions
[
  {
    "name": "equip",
    "description": "为角色已有槽位装备或替换一件可达装备。expectedCurrentRef 必须与槽位当前 ref 精确一致。",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["characterRef", "slotType", "slotIndex", "expectedCurrentRef", "itemRef"],
      "properties": {
        "characterRef": { "type": "string" },
        "slotType": { "type": "string" },
        "slotIndex": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
        "expectedCurrentRef": { "type": ["string", "null"] },
        "itemRef": { "type": "string" }
      }
    },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/equip.js", "timeoutMs": 30000, "helpers": ["equipment-core.js"] }
  },
  {
    "name": "unequip",
    "description": "卸下角色已有槽位中的装备。expectedCurrentRef 必须是槽位当前非空 ref。",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["characterRef", "slotType", "slotIndex", "expectedCurrentRef"],
      "properties": {
        "characterRef": { "type": "string" },
        "slotType": { "type": "string" },
        "slotIndex": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 },
        "expectedCurrentRef": { "type": "string" }
      }
    },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/unequip.js", "timeoutMs": 30000, "helpers": ["equipment-core.js"] }
  },
  {
    "name": "refresh",
    "description": "从非装备基线重算角色全部装备；可用 attributeChanges 传入本次普通属性增量，并清理结构合法但已失效的装备槽。",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["characterRef"],
      "properties": {
        "characterRef": { "type": "string" },
        "attributeChanges": { "type": "object", "additionalProperties": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 } }
      }
    },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/refresh.js", "timeoutMs": 30000, "helpers": ["equipment-core.js"] }
  }
]
```
