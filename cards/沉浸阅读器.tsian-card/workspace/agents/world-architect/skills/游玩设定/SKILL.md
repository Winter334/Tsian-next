---
name: 游玩设定
title: 游玩设定
description: 引导玩家补充本局特别设定（特殊体质、天赋、系统等），确认后落盘并生成开局正文。
triggers:
  - 玩家完成角色设定后进入游玩设定对话
appliesTo:
  - world-architect
---

# 游玩设定

本 Skill 引导玩家补充本局特别设定，确认后落盘并生成开局正文。

## 访谈

逐轮提问，每次最多 1～2 个问题。每个问题附带 `[[选项]]` 模板，允许自由输入。

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
- 原著角色：默认沿用原著开局，并把开局点压到已读素材中最早可成立的位置；不要为了让场景更热闹、冲突更明确或角色状态更方便而主动跳过原著早期内容。若角色在原著开头尚未登场，从最早能自然承接该角色登场/行动的节点切入，并保留此前已读事实作为背景，不把后续事件当作既成事实。
- 原创角色：根据角色设定合理嵌入世界。
- 特殊能力（traits）可影响开局呈现，但只改变呈现和处境细节，不把原著角色模式的切入点推后。

## 落盘

玩家选择「直接开始」后：

1. 整理给 storyteller 的上下文：主角信息、traits、已读开局素材边界、本局设定摘要。
2. `agent_call` storyteller，`expectedOutput` 要求返回【开局正文】+【初始选项】3～5 个。
3. storyteller 返回后，调 `commit_play_setup` 一次写入：
   - 主角 entity 的 `traits[]`（每项 `{ id, name, description?, effects? }`，`id` 用 `trait:<localId>` 格式）
   - `setup-summary.json`（小说简介式 summary）
   - `save/history/turns/turn-000000.json`（开局 assistant 回复，包含正文与内嵌 `[[选项]]`）
   - `save/agents/<playerTurnAgent>/context.json`（玩家正式回合入口 Agent 的 turn 0 上下文种子，只写 clean content）
4. 最终回复玩家：「开局已准备好，进入故事即可开始。」
5. 不在回复中展示开局正文全文。

## 可用 action

```json tsian-actions
[
  {
    "name": "commit_play_setup",
    "description": "Step 4 收尾单一 action：校验 protagonistRef 指向已存在 character entity、summary 非空（≤2000）、openingReply 非空、traits[] 每项 id（trait:<localId>）+ name 必填，read-modify-write 主角 entity 合并 traits（按 id 去重覆盖），并一次写入 setup-summary.json、turn 0 history 与玩家回合入口 Agent context。返回 {status, writes}，不含 openingReply 正文（避免 Step 4 UI 提前展示）。",
    "inputSchema": { "type": "object", "required": ["protagonistRef", "summary", "openingReply"], "properties": { "protagonistRef": { "type": "string" }, "traits": { "type": "array", "items": { "type": "object", "required": ["id", "name"], "properties": { "id": { "type": "string" }, "name": { "type": "string" }, "description": { "type": "string" }, "effects": { "type": "array", "items": { "type": "string" } } } } }, "summary": { "type": "string" }, "openingReply": { "type": "string", "description": "开局 assistant 回复整体，包含开局正文与可选的内嵌 [[选项]] 块。" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/commit-play-setup.js", "timeoutMs": 10000, "helpers": ["_common.js", "_validation.js"] }
  }
]
```

## spoiler-safe

只使用开局窗口中读到的内容。不推断、不剧透未来剧情。
