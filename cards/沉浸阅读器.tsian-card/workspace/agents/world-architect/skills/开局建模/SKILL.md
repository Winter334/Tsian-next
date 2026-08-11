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

你正在一个临时、可恢复的开局访谈中直接面对玩家。前端 injection 给出不可改写的 `sessionId`、`sourceHash`、`branch`、`basedOnRevision` 与 `attemptId`。`branch` 已由玩家确认：`canon` 表示原著角色，`original` 表示原创角色。当前 user input 是下列之一：

- `opening-interview:start:<sessionId>`：第一次提问；
- `opening-interview:answer:<attemptId>\n<玩家回答>`：处理一次玩家回答。

## 每轮目标

1. 调用 `read_opening_progress` 读取权威进度；若本轮继续提问，调用一次 `advance_opening_progress` 写入完整下一快照；若本轮正式提交，则由 `commit_opening` 完成 revision 并写 `phase:"complete"`。
2. 只在当前决策缺口需要小说证据时使用 `inspect_source_opening` 或 `read_opening_slice`。
3. 直接进入 injection 指定的分支：`canon` 首轮给出小说相关候选并接受玩家指定其他原著角色；`original` 首轮从姓名、身份或切入点中最高价值的一项开始问，不要求表单。
4. 小说已经明确的事实直接记入进度；只询问会改变本次正式模型或首回合内容的多种合理选择、冲突信息，或阻塞开局且无法可靠推断的内容。
5. 每轮优先只问一个问题，至多两个紧密相关的问题；给快捷选项时始终允许自由回答。
6. 玩家明确确认开始，且最小依赖闭包满足后，调用一次 `commit_opening`。成功后不再提问。

访谈中途只写 `save/playthrough/opening-progress.json` 与控制文件，不写正式 entity、scene、relationship、runtime、frontier、turn 或正式玩家回合 context。

## 回复协议

玩家回复只包含自然语言问题/说明和可选的快捷选项，不输出内部进度 JSON：

```text
你想从萧澈在新房苏醒时开始，还是从整装迎亲前开始？

[[开局选项]]
- 新房苏醒
- 迎亲出发前
[[/开局选项]]
```

`advance_opening_progress.next` 是完整快照（不是 patch），固定字段为 `protagonist?/decisions/unresolved/readSlices/phase`：

- `session` 逐字使用 injection 的 `sessionId/sourceHash/branch/basedOnRevision/attemptId`；脚本负责 revision、幂等与并发校验。
- `protagonist` 是唯一的主角摘要，固定为 `{mode,ref?,name?}`，其中 `mode` 等于顶层 `branch`；它只放在顶层，主角选择不在 `decisions.protagonist` 中保存第二份。
- `decisions.<stableKey>` 固定为 `{value,evidenceRefs?}`：`value` 是已确定的字符串，`evidenceRefs` 是支持该决定的去重 ref 数组；玩家偏好不需要原文证据时省略 `evidenceRefs`。
- `unresolved.<stableKey>` 固定为 `{reason}`：`reason` 是说明仍缺什么的字符串；不要用裸字符串、选项数组或以 `|` 拼接的值代替该对象。
- stable key 按事项语义命名并跨轮复用。新回答更新同 key；事项解决后从 `unresolved` 移除并写入对应 `decisions`，不保留冲突副本。
- 每轮以读取到的完整状态为基础应用一次当前回答，保留仍有效的 `readSlices`、`protagonist`、`decisions` 与 `unresolved`。
- `readSlices` 中每个精读章节恰有一条 `{ref,start?,end?,purpose}`，`ref` 必须来自章节索引。`start/end` 是该章节正文内 0-based、end-exclusive 的字符偏移；从章首读取时写 `start:0, end:charactersRead`，确认读完整章时可同时省略 `start/end`。
- `readSlices.start/end` 只记录章节内字符范围，不填 `window.startIndex/endIndex`，也不填章节序号。
- 不把整段小说或完整 entity/scene/runtime 草稿放进进度。
- 未完成用 `phase:"interviewing"` 或 `"ready-to-commit"`；`complete` 只由 `commit_opening` 成功事务写入。

## 阅读策略

- 每轮先读取权威进度；已有信息足以支撑当前问题时直接复用。
- 需要开头结构或候选线索且现有信息不足时使用 `inspect_source_opening`。它提供章节结构与候选预览，不代表精读正文，也不写入 `readSlices`。
- 预览不足以确认角色事实、开局锚点或其他精确证据时，使用 `read_opening_slice` 定向精读；近期摘要缺少所需细节时可以重读 source 权威。把每个实际精读章节的 ref、章节内字符范围与用途写入 `readSlices`。
- 原创分支只读取足以提出当前高价值问题的内容。
- 玩家指定首批窗口之外的原著角色时，定向扩展读取；不要因为不在首批候选而拒绝。
- 只使用已经读取范围内、在开局锚点时成立的事实。后续章节发生的关系变化、状态、目标和经历不得提前写入正式模型。

## 完成条件

只有同时满足以下条件才询问“直接开始”并提交：

- 主角已明确，可构造一个有效 character；
- 开局地点与至少一个 scene 成立，scene.present 至少包含一个本次实体；
- 第一回合所需的角色、地点、必要关系、traits、当前状态、处境及其他正式实体已形成最小充分闭包，全部已用引用可闭合；非阻塞细节不强问；
- runtime protagonist/location/activeSceneRefs 可指向本次闭包；
- frontier 窗口与首个 source anchor 可由已读章节构造；
- 玩家已明确同意开始。

依据已读小说、玩家回答和已确认的开局处境，只建立让第一回合成立的最小充分正式模型。实体使用下方 action 中的 `character`、`location`、`container`、`item` 正式结构；已有正式字段可以表达的事实写入对应字段，`extensions` 只承载 schema 中没有的非引用信息。relationships 只保存 character-to-character 关系。

组装 `commit_opening` 输入时：

- 所有 `{ref,name}` 的 name 必须与本次闭包目标文档的 name 完全一致；active scene 中至少一个场景同时位于 runtime.location 并包含主角。
- `sourceWindow.chapters` 是从 `startIndex` 到 `endIndex` 的完整连续窗口；从读取结果只取 `index/title/ref`（旧源取 `path`），不要带 `charactersRead/truncated` 等观察字段。`extractedThrough` 等于窗口末章 ref。
- `timeline` 只传 source 锚点，`kind:"source"`，order 从 1 连续递增；第一个锚点 chapter 等于窗口起点且 time 为 `"元年"`。
- `openingReply` 只含正式首回合正文和末尾 `[[选项]]`，不含开局会话块。实体、场景、关系、runtime 与 frontier 不接受 schema 之外的临时字段。

## 可用脚本（tsian-actions）

```json tsian-actions
[
  {
    "name": "read_opening_progress",
    "description": "读取当前开局控制与权威语义进度；每轮开始时调用。",
    "inputSchema": { "type": "object" },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/read-opening-progress.js", "timeoutMs": 10000, "helpers": ["_common.js", "_progress.js"] }
  },
  {
    "name": "advance_opening_progress",
    "description": "以 expected revision/attempt 原子写入完整下一进度并推进控制文件。",
    "inputSchema": {
      "type": "object",
      "required": ["session", "next"],
      "properties": { "session": { "type": "object" }, "next": { "type": "object" } }
    },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/advance-opening-progress.js", "timeoutMs": 10000, "helpers": ["_common.js", "_progress.js"] }
  },
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
    "description": "在干净的新流程存档中校验并一次提交最小开局模型、frontier、setup summary、turn 0、正式玩家回合 context 与幂等 receipt。",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["session", "entities", "scenes", "relationships", "runtime", "frontier", "summary", "openingReply"],
      "properties": {
        "session": {
          "type": "object",
          "additionalProperties": false,
          "required": ["sessionId", "sourceHash", "branch", "revision", "attemptId"],
          "properties": {
            "sessionId": { "type": "string" },
            "sourceHash": { "type": "string" },
            "branch": { "type": "string", "enum": ["canon", "original"] },
            "revision": { "type": "integer", "minimum": 1 },
            "attemptId": { "type": "string" }
          }
        },
        "entities": {
          "type": "array",
          "minItems": 1,
          "maxItems": 64,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["id", "name", "brief"],
            "oneOf": [
              {
                "additionalProperties": false,
                "properties": {
                  "id": { "pattern": "^character:.+$" }, "name": {}, "brief": {}, "gender": {}, "tags": {}, "aliases": {},
                  "visibility": {}, "lifecycle": {}, "identity": {}, "appearance": {}, "attributes": {}, "gauges": {},
                  "status": {}, "traits": {}, "goals": {}, "background": {}, "history": {}, "containers": {}, "equipment": {}, "extensions": {}
                }
              },
              {
                "additionalProperties": false,
                "properties": {
                  "id": { "pattern": "^location:.+$" }, "name": {}, "brief": {}, "tags": {}, "aliases": {},
                  "visibility": {}, "lifecycle": {}, "status": {}, "extensions": {}
                }
              },
              {
                "additionalProperties": false,
                "required": ["type", "contents"],
                "properties": {
                  "id": { "pattern": "^container:.+$" }, "name": {}, "brief": {}, "type": { "const": "container" },
                  "contents": {}, "status": {}, "extensions": {}
                }
              },
              {
                "additionalProperties": false,
                "required": ["type"],
                "properties": {
                  "id": { "pattern": "^item:.+$" }, "name": {}, "brief": {},
                  "type": { "enum": ["equipment", "material", "consumable", "special", "other"] },
                  "tags": {}, "equipment": {}, "extensions": {}
                }
              }
            ],
            "properties": {
              "id": { "type": "string", "description": "使用 character/location/container/item:<localId>；字段必须匹配 id 类型对应的正式结构。" },
              "name": { "type": "string" },
              "brief": { "type": "string" },
              "type": { "type": "string", "enum": ["container", "equipment", "material", "consumable", "special", "other"] },
              "gender": { "type": "string" },
              "tags": { "type": "array", "items": { "type": "string" } },
              "aliases": { "type": "array", "items": { "type": "string" } },
              "visibility": { "type": "string", "enum": ["player-known", "hidden", "future-spoiler"] },
              "lifecycle": { "type": "string", "enum": ["candidate", "active", "background", "retired"] },
              "identity": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "age": { "anyOf": [{ "type": "integer" }, { "type": "string" }] },
                  "gender": { "type": "string" },
                  "role": { "type": "string" },
                  "affiliation": { "type": "string" },
                  "realm": { "type": "string" }
                }
              },
              "appearance": { "type": "string" },
              "attributes": { "type": "object", "minProperties": 6, "maxProperties": 6, "additionalProperties": { "type": "integer" }, "description": "角色六维非装备基线；存在 equipment 槽位时，action 按物品规则计算持久化的最终属性。" },
              "gauges": {
                "type": "array",
                "maxItems": 32,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["id", "name", "value"],
                  "properties": {
                    "id": { "type": "string" },
                    "name": { "type": "string" },
                    "value": { "type": "integer" },
                    "max": { "type": "integer" },
                    "min": { "type": "integer" },
                    "unit": { "type": "string" },
                    "tone": { "type": "string", "enum": ["neutral", "accent", "success", "warning", "danger", "muted"] }
                  }
                }
              },
              "status": {
                "type": "array",
                "maxItems": 32,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["id"],
                  "properties": {
                    "id": { "type": "string" },
                    "name": { "type": "string" },
                    "description": { "type": "string" },
                    "polarity": { "type": "string", "enum": ["positive", "negative", "neutral"] }
                  }
                }
              },
              "traits": {
                "type": "array",
                "maxItems": 32,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["id", "name"],
                  "properties": {
                    "id": { "type": "string" },
                    "name": { "type": "string" },
                    "description": { "type": "string" },
                    "effects": { "type": "array", "items": { "type": "string" } }
                  }
                }
              },
              "goals": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "current": { "type": "string" },
                  "shortTerm": { "type": "string" },
                  "longTerm": { "type": "string" }
                }
              },
              "background": { "type": "string" },
              "history": {
                "type": "array",
                "maxItems": 32,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["event"],
                  "properties": { "event": { "type": "string" } }
                }
              },
              "containers": {
                "type": "array",
                "maxItems": 64,
                "description": "character 持有的根 container 引用。",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["ref"],
                  "properties": {
                    "ref": { "type": "string" },
                    "count": { "type": "integer", "minimum": 1, "maximum": 1 }
                  }
                }
              },
              "contents": {
                "type": "array",
                "maxItems": 256,
                "description": "container 内的 item 或嵌套 container 引用；嵌套 container 的 count 只能缺省或为 1。",
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["ref"],
                  "properties": {
                    "ref": { "type": "string" },
                    "count": { "type": "integer", "minimum": 1, "maximum": 9007199254740991 }
                  }
                }
              },
              "equipment": {
                "description": "character 使用槽位类型到固定槽位数组的映射，每槽只传 ref；item 使用 slotType/add/percent/effects 规则。",
                "anyOf": [
                  {
                    "type": "object",
                    "propertyNames": { "type": "string", "minLength": 1, "maxLength": 80 },
                    "additionalProperties": {
                      "type": "array",
                      "minItems": 1,
                      "maxItems": 64,
                      "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["ref"],
                        "properties": { "ref": { "anyOf": [{ "type": "string" }, { "type": "null" }] } }
                      }
                    }
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["slotType"],
                    "properties": {
                      "slotType": { "type": "string" },
                      "add": {
                        "type": "object",
                        "propertyNames": { "type": "string", "minLength": 1, "maxLength": 80 },
                        "additionalProperties": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }
                      },
                      "percent": {
                        "type": "object",
                        "propertyNames": { "type": "string", "minLength": 1, "maxLength": 80 },
                        "additionalProperties": { "type": "integer", "minimum": -9007199254740991, "maximum": 9007199254740991 }
                      },
                      "effects": { "type": "array", "maxItems": 32, "items": { "type": "string" } }
                    }
                  }
                ]
              },
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
            "additionalProperties": false,
            "required": ["id", "name", "location", "present"],
            "properties": {
              "id": { "type": "string" },
              "name": { "type": "string" },
              "location": {
                "type": "object",
                "additionalProperties": false,
                "required": ["ref", "name"],
                "properties": { "ref": { "type": "string" }, "name": { "type": "string" } }
              },
              "present": {
                "type": "array",
                "minItems": 1,
                "maxItems": 64,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["ref"],
                  "properties": { "ref": { "type": "string" } }
                }
              },
              "status": { "type": "string", "enum": ["active"] },
              "extensions": { "type": "object" }
            }
          }
        },
        "relationships": {
          "type": "array",
          "maxItems": 64,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["subject", "edges"],
            "properties": {
              "subject": { "type": "string" },
              "edges": {
                "type": "array",
                "minItems": 1,
                "maxItems": 64,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "required": ["to", "type"],
                  "properties": {
                    "to": { "type": "string" },
                    "type": { "type": "string" },
                    "note": { "type": "string" }
                  }
                }
              }
            }
          }
        },
        "runtime": {
          "type": "object",
          "additionalProperties": false,
          "required": ["protagonistRef", "location", "activeSceneRefs"],
          "properties": {
            "protagonistRef": {
              "type": "object",
              "additionalProperties": false,
              "required": ["ref", "name"],
              "properties": { "ref": { "type": "string" }, "name": { "type": "string" } }
            },
            "location": {
              "type": "object",
              "additionalProperties": false,
              "required": ["ref", "name"],
              "properties": { "ref": { "type": "string" }, "name": { "type": "string" } }
            },
            "activeSceneRefs": {
              "type": "array",
              "minItems": 1,
              "maxItems": 32,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["ref", "name"],
                "properties": { "ref": { "type": "string" }, "name": { "type": "string" } }
              }
            },
            "worldTime": { "type": "string" },
            "weather": { "type": "string" },
            "extensions": { "type": "object" }
          }
        },
        "frontier": {
          "type": "object",
          "additionalProperties": false,
          "required": ["sourceWindow", "extractedThrough", "timeline"],
          "properties": {
            "sourceWindow": {
              "type": "object",
              "additionalProperties": false,
              "required": ["startIndex", "endIndex", "reason", "chapters"],
              "properties": {
                "startIndex": { "type": "integer", "minimum": 1 },
                "endIndex": { "type": "integer", "minimum": 1 },
                "reason": { "type": "string" },
                "chapters": {
                  "type": "array",
                  "minItems": 1,
                  "maxItems": 64,
                  "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["index", "title"],
                    "properties": {
                      "index": { "type": "integer" },
                      "title": { "type": "string" },
                      "ref": { "type": "string" },
                      "path": { "type": "string" }
                    }
                  }
                }
              }
            },
            "extractedThrough": { "type": "string" },
            "timeline": {
              "type": "array",
              "minItems": 1,
              "maxItems": 32,
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": ["kind", "order", "chapter", "time", "label"],
                "properties": {
                  "kind": { "type": "string", "enum": ["source"] },
                  "order": { "type": "integer", "minimum": 1 },
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
        "openingReply": { "type": "string", "description": "正式首回合正文，末尾必须含 [[选项]] 块，不含开局访谈隐藏块。" }
      }
    },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/commit-opening.js", "timeoutMs": 20000, "helpers": ["_common.js", "_validation.js", "_progress.js"] }
  }
]
```

## 最终提交

1. 必要时调用 storyteller 生成 `openingReply`：只要首回合正文和正式 `[[选项]]`，不要让它参与访谈状态。
2. `session.revision` 使用本轮将要输出的 revision，`session.attemptId` 使用当前 answer marker id。
3. 一次调用 `commit_opening`，输入本次最小闭包。脚本返回校验错误时按 code/message 修正同一 payload 后重试。
4. action 成功后只回复一句自然语言完成提示；不要附 `[[开局选项]]`。

常见失败：

- `OPENING_SESSION_MISMATCH`：session/source/branch/revision/attempt 与控制文件不一致；重新调用 `read_opening_progress`。
- `OPENING_SAVE_NOT_CLEAN`：检测到测试期旧状态或正式模型；停止提交，告知调用方需新存档，不删除旧文件。
- `OPENING_REF_UNKNOWN`：ref 不在本次闭包；补入必要实体/scene 或修正引用。
- `OPENING_SOURCE_REF_UNKNOWN`：frontier/read slice ref 不在当前章节索引；使用读取 action 返回的 ref。
- `OPENING_ALREADY_COMMITTED`：已有完成信号但 receipt 不同或无法确认；停止提交，不得覆盖。
- `OPENING_PLAY_ALREADY_STARTED`：正式游玩已开始或存在后续 turn；停止提交，不得重跑开局事务。

所有脚本错误都必须原样保留 code 的含义，不要绕过脚本改写正式文件。
