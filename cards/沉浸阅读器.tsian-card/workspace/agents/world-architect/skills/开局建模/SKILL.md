---
name: 开局建模
title: 开局建模
description: 通过连续问答确定玩家角色与首回合所需的开局事实，按需阅读小说，并一次提交最小世界模型。
triggers:
  - 小说导入后主持开局访谈
appliesTo:
  - world-architect
---

# 开局建模

你正在临时开局访谈中直接面对玩家。前端会说明当前小说、会话和玩家已确认的 `branch`：`canon` 表示原著角色，`original` 表示原创角色。当前 user input 是下列之一：

- `opening-interview:start:<sessionId>`：开始第一次提问；
- `opening-interview:answer\n<玩家回答>`：继续访谈。

## 工作方式

1. 直接进入指定分支。`canon` 首轮给出与小说相关的候选，也接受玩家指定其他原著角色；`original` 首轮从姓名、身份或切入点中最高价值的一项开始问，不要求表单。
2. 只询问会改变正式模型或首回合内容的合理分歧、冲突信息，或无法可靠推断的阻塞项。每轮优先只问一个问题，至多两个紧密相关的问题；快捷选项始终允许自由回答。
3. 只在当前决定需要小说证据时调用 `inspect_source_opening` 或 `read_opening_slice`。只使用实际读到的内容，不把开局锚点之后的事件提前写入角色状态。
4. 需要从较早对话继续工作时，可用原生 `read` 读取 `save/playthrough/opening-notes.md`。当主角、已确认事项、待确认事项或有用的已读范围发生耐久变化时，用原生 `write` 完整重写该文件；文件缺失是正常情况。
5. 解释、重述、追问、格式修正等没有耐久语义变化的回复不写笔记。访谈中途不写正式 entity、scene、relationship、runtime、frontier、turn 或正式玩家回合 context。
6. 玩家明确确认开始且最小依赖满足后，调用一次 `commit_opening`。成功后不再提问。

工作笔记保持短小可读，可使用以下结构，不增加控制、审计或完成状态字段：

```md
# 开局建模工作笔记
## 主角
## 已确认
## 待确认
## 已读原文
```

## 玩家回复

回复只包含自然语言问题、说明和可选快捷选项：

```text
你想从萧澈在新房苏醒时开始，还是从整装迎亲前开始？

[[开局选项]]
- 新房苏醒
- 迎亲出发前
[[/开局选项]]
```

## 阅读与提交边界

- 预览不足以确认角色事实或开局锚点时，使用 `read_opening_slice` 定向精读。原创分支只读取足以提出当前高价值问题的内容。
- 玩家指定首批范围之外的原著角色时可定向扩展读取，不因其不在初始候选中而拒绝。
- 主角、至少一个地点和一个 active scene 必须成立；runtime 主角与 active scene 必须指向本次提交内容。
- frontier 只需给出已读来源窗口的起止章节和实际开局锚点。章节 metadata、目标引用的名称、锚点 `kind/order` 由脚本从来源和目标对象生成。
- 正式 `openingReply` 只含首回合正文和正式 `[[选项]]`，不含开局访谈选项块。
- 实体使用 `character`、`location`、`container`、`item` 等正式结构。只创建首回合需要的内容；relationships 只保存 character-to-character 关系。

## 可用脚本（tsian-actions）

```json tsian-actions
[
  {
    "name": "inspect_source_opening",
    "description": "观察导入源 manifest 与开头章节预览，支持提出当前开局问题。",
    "inputSchema": { "type": "object", "properties": { "previewCount": { "type": "number" }, "previewCharacters": { "type": "number" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/inspect-source-opening.js", "timeoutMs": 10000, "helpers": ["_common.js"] }
  },
  {
    "name": "read_opening_slice",
    "description": "按章节范围读取小说正文与窗口元信息；只在当前问题需要证据时调用。",
    "inputSchema": { "type": "object", "properties": { "startIndex": { "type": "number" }, "endIndex": { "type": "number" }, "maxCharacters": { "type": "number" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/read-opening-slice.js", "timeoutMs": 10000, "helpers": ["_common.js"] }
  },
  {
    "name": "commit_opening",
    "description": "从当前开局控制与来源生成并原子写入最小正式模型、frontier、setup summary、turn 0 和正式玩家回合 context。",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["entities", "scenes", "relationships", "runtime", "frontier", "summary", "openingReply"],
      "properties": {
        "entities": {
          "type": "array",
          "minItems": 1,
          "maxItems": 64,
          "items": {
            "type": "object",
            "required": ["id", "name", "brief"],
            "properties": {
              "id": { "type": "string", "description": "使用 <type>:<localId>，开局常用 character/location/container/item。" },
              "name": { "type": "string" },
              "brief": { "type": "string" },
              "type": { "type": "string" },
              "contents": { "type": "array" },
              "containers": { "type": "array" },
              "equipment": { "type": "object" },
              "extensions": { "type": "object" }
            }
          }
        },
        "scenes": {
          "type": "array",
          "minItems": 1,
          "maxItems": 32,
          "items": {
            "type": "object",
            "required": ["id", "name", "location", "present"],
            "properties": {
              "id": { "type": "string" },
              "name": { "type": "string" },
              "location": { "type": "object", "required": ["ref"], "properties": { "ref": { "type": "string" } } },
              "present": { "type": "array", "minItems": 1, "items": { "type": "object", "required": ["ref"], "properties": { "ref": { "type": "string" } } } },
              "extensions": { "type": "object" }
            }
          }
        },
        "relationships": { "type": "array", "maxItems": 64, "items": { "type": "object" } },
        "runtime": {
          "type": "object",
          "required": ["protagonistRef", "location", "activeSceneRefs"],
          "properties": {
            "protagonistRef": { "type": "object", "required": ["ref"], "properties": { "ref": { "type": "string" } } },
            "location": { "type": "object", "required": ["ref"], "properties": { "ref": { "type": "string" } } },
            "activeSceneRefs": { "type": "array", "minItems": 1, "items": { "type": "object", "required": ["ref"], "properties": { "ref": { "type": "string" } } } },
            "worldTime": { "type": "string" },
            "weather": { "type": "string" },
            "extensions": { "type": "object" }
          }
        },
        "frontier": {
          "type": "object",
          "required": ["sourceWindow", "timeline"],
          "properties": {
            "sourceWindow": {
              "type": "object",
              "required": ["startIndex", "endIndex"],
              "properties": {
                "startIndex": { "type": "integer", "minimum": 1 },
                "endIndex": { "type": "integer", "minimum": 1 },
                "reason": { "type": "string" }
              }
            },
            "timeline": {
              "type": "array",
              "minItems": 1,
              "maxItems": 32,
              "items": {
                "type": "object",
                "required": ["chapter", "time", "label"],
                "properties": {
                  "chapter": { "type": "integer", "minimum": 1 },
                  "time": { "type": "string" },
                  "label": { "type": "string" }
                }
              }
            },
            "notes": { "type": "string" }
          }
        },
        "summary": { "type": "string", "description": "供开局确认屏显示的玩家可读短摘要。" },
        "openingReply": { "type": "string", "description": "正式首回合正文，末尾含 [[选项]] 块。" }
      }
    },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/commit-opening.js", "timeoutMs": 20000, "helpers": ["_common.js", "_validation.js"] }
  }
]
```

## 最终提交

1. 必要时调用 storyteller 生成 `openingReply`，只让它生成首回合正文和正式 `[[选项]]`。
2. 一次调用 `commit_opening`。脚本返回校验错误时按 code/message 修正输入后重试。
3. action 成功后只回复一句自然语言完成提示，不附 `[[开局选项]]`。

常见失败：

- `OPENING_SAVE_NOT_CLEAN`：存档已有旧开局状态或正式模型；告知调用方使用新存档，不删除旧文件。
- `OPENING_REF_UNKNOWN`：必要引用不在本次提交中；补入目标或修正引用。
- `OPENING_SOURCE_REF_UNKNOWN`：frontier 锚点不属于当前来源窗口；改用读取 action 返回的章节。
- `OPENING_PLAY_ALREADY_STARTED`：正式游玩已开始；停止提交，不覆盖现有内容。

所有脚本错误都必须保留 code 的含义，不绕过脚本改写正式文件。
