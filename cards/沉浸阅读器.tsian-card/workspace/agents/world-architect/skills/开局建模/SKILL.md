---
name: 开局建模
title: 开局建模
description: 通过连续问答确定玩家角色与首回合事实，按依赖阶段持久化开局资料并发布首回合。
triggers:
  - 小说导入后主持开局访谈
appliesTo:
  - world-architect
---

# 开局建模

你正在临时开局访谈中直接面对玩家。前端会说明当前小说、会话和玩家已确认的 `branch`：`canon` 表示原著角色，`original` 表示原创角色。当前 user input 是下列之一：

- `opening-interview:start:<sessionId>`：开始第一次提问；
- `opening-interview:answer\n<玩家回答>`：继续访谈；
- `opening-interview:continue:<sessionId>`：继续后台准备。它不是玩家回答；读取工作笔记和正常 workspace，从首个未完成阶段继续。

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
    "name": "commit_opening_entities",
    "description": "校验本期开局实体的安全 id/path、name、brief 与最低必要形状，整批通过后写入正常实体路径。",
    "inputSchema": {
      "type": "object",
      "required": ["entities"],
      "properties": { "entities": { "type": "array", "minItems": 1, "maxItems": 64, "items": { "type": "object" } } }
    },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/commit-opening-entities.js", "timeoutMs": 15000, "helpers": ["_common.js", "_validation.js", "_opening-workflow.js"] }
  },
  {
    "name": "commit_opening_graph",
    "description": "从正常实体资料校验场景和人物关系的直接引用，整批通过后写入正常场景与关系路径。",
    "inputSchema": {
      "type": "object",
      "required": ["scenes", "relationships"],
      "properties": {
        "scenes": { "type": "array", "minItems": 1, "maxItems": 32, "items": { "type": "object" } },
        "relationships": { "type": "array", "maxItems": 64, "items": { "type": "object" } }
      }
    },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/commit-opening-graph.js", "timeoutMs": 15000, "helpers": ["_common.js", "_validation.js", "_opening-workflow.js"] }
  },
  {
    "name": "commit_opening_state",
    "description": "校验 runtime 对已落盘实体/场景的直接引用和已读 source 范围，写入 runtime、frontier 与 pending 开局摘要。",
    "inputSchema": {
      "type": "object",
      "required": ["runtime", "frontier", "summary"],
      "properties": {
        "runtime": { "type": "object" },
        "frontier": { "type": "object" },
        "summary": { "type": "string" }
      }
    },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/commit-opening-state.js", "timeoutMs": 15000, "helpers": ["_common.js", "_validation.js", "_opening-workflow.js"] }
  },
  {
    "name": "publish_opening",
    "description": "核对已落盘开局状态与 storyteller 正文，发布 turn 0、正式玩家回合 context 和 complete setup summary。",
    "inputSchema": {
      "type": "object",
      "required": ["openingReply"],
      "properties": { "openingReply": { "type": "string" } }
    },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/publish-opening.js", "timeoutMs": 15000, "helpers": ["_common.js", "_validation.js", "_opening-workflow.js"] }
  }
]
```

## 工作笔记

使用 `save/playthrough/opening-notes.md` 保存自然语言工作记忆。恢复时同时读取该笔记和正常 workspace；程序不解析笔记内容。保持以下栏目，内容只写本次工作需要的事实：

```md
# 开局建模工作笔记

## 已确认
- 玩家角色、切入点和其他已确认选择

## 已读原文
- 实际读过的章节范围及用途

## 已完成
- 已经成功持久化的资料阶段

## 下一步
- 首个尚未完成的阶段或需要修复的具体问题

## 正文边界
- 首回合从哪里开始、停在哪个等待玩家选择的瞬间
```

不要在笔记中保存 hash、文件路径清单、校验回执或结构化状态机。action 成功后再更新“已完成/下一步”；action 失败时不要写虚假完成记录。

## 顺序流程

每次 invocation 从下列顺序中找到首个未完成阶段，只执行到本节要求的结束点。已经成功持久化的阶段从正常 workspace 读取，不重新生成。

### 1. 恢复、取证与访谈

读取工作笔记；必要时读取正常实体、场景、关系、runtime 和 frontier 判断已完成范围。`continue` 输入直接恢复后台阶段，不重新开始访谈，也不把它显示或解释成玩家选择。

当前问题缺少来源证据时调用 `inspect_source_opening` 或 `read_opening_slice` 定向读取。每轮确认一个会改变正式模型或首回合的高价值分歧，至多同时询问两个紧密相关的问题。快捷选项使用：

```text
[[开局选项]]
- 选项一
- 选项二
[[/开局选项]]
```

实体只反映切入点那一刻已经成立的事实；已读范围内但发生在切入点之后的事件不写成当前状态。主角、切入点和首回合最小事实明确，并且玩家明确确认开始后，更新工作笔记并进入实体阶段。确认开始前不调用三个建模 action。

### 2. 实体阶段

只组装本期开局需要的完整 `entities`，至少包含主角和开局地点。调用 `commit_opening_entities`。它只检查安全 id/path、重复项、`name/brief` 和 container/item 的最低必要形状，不要求你证明开放 entity schema 的全部字段。

成功后更新工作笔记，说明已完成实体资料和下一步是场景/关系；回复一句简短进度文字并在末尾写 `[[开局继续]]`，立即结束本次 invocation。不要在同一次 invocation 继续 graph。

失败时只修正实体输入并重试本阶段。`OPENING_ENTITIES_LOCKED` 表示下游已经使用了现有实体路径；不要改 id/path，先核对正常 workspace 中的权威资料。

### 3. 场景与关系阶段

从 `save/entities/...` 读取权威实体，只组装完整 `scenes` 和 `relationships`。场景至少包含 id、name、location 和 present；relationships 只保存 character-to-character 边。调用 `commit_opening_graph`。

成功后更新工作笔记，说明已完成场景/关系和下一步是 runtime/frontier；回复简短进度文字并在末尾写 `[[开局继续]]`，立即结束本次 invocation。不要在同一次 invocation 继续 state。

缺少实体引用时，本阶段零写入；如果确实漏建实体，回到实体阶段补充后形成新的持久边界，再重试 graph。`OPENING_GRAPH_LOCKED` 表示 state 已使用现有 graph 路径，不改 id/path。

### 4. 状态阶段

从正常实体、场景和关系资料组装 `runtime`、`frontier` 与玩家可读 `summary`。runtime 的 protagonist/location/active scenes 必须指向已落盘资料。frontier 使用实际已读 `sourceWindow.startIndex/endIndex`，至少包含一个 source 节点；每个节点写 `chapter/time/label/summary`：

- `label` 是一句客观标签；
- `summary` 是 1～3 句客观梗概，只概括你实际读过的原著内容；
- 不把未读内容、创作指令或玩家尚未经历的事件伪装成已发生事实。

调用 `commit_opening_state`。成功后 setup summary 仍是 pending；更新工作笔记，说明模型资料已经完成、下一步是首回合正文，并记录正文边界。回复简短进度文字并在末尾写 `[[开局继续]]`，立即结束本次 invocation。不要在同一次 invocation 委派 storyteller。

### 5. 首回合正文与发布

只有 state 已在上一次成功 invocation 中持久化后，才进入本阶段。读取：

- `save/playthrough/opening-notes.md` 的正文边界；
- `save/playthrough/runtime.json`；
- active scene、在场实体和必要人物关系；
- `save/playthrough/frontier.json` 的开局 source 节点与 summary。

通过 `agent_call` 委派 `storyteller`。request 只传递以下轻量协调信息，不复制已在 workspace 中的实体、场景、关系或 runtime 全文：

- 任务：读取上述正常 workspace 权威资料，写正式首回合；
- 切入点和正文终点；
- 事实边界：只使用已读原著与玩家确认事实；
- 交付：只返回首回合正文，末尾带 1～12 个正式 `[[选项]]...[[/选项]]`。

保留成功 observation 的 `response` 和 `responseRef`。核对正文终点与已落盘 runtime、active scene、在场实体一致。正文偏离时只重新委派正文；只有权威模型确实有错时，才回到所属建模阶段修正并再次形成持久边界。

核对通过后调用 `publish_opening`：`run_script.input` 为空对象，不内联正文；把 `responseRef` 放在 `run_script.inputRefs.openingReply`。publish 不接收也不重写 entities、scenes、relationships、runtime 或 frontier。成功后回复开局已准备完成，不写 `[[开局继续]]`。

## 恢复与错误

- 每个建模 action 都是本阶段的 validate-before-write 事务；输入错误时本阶段零写入，已完成前序保持不变。
- provider、storyteller 或 `publish_opening` 失败时，只恢复正文与发布阶段，不重新生成前三阶段模型。
- `OPENING_REF_UNKNOWN`：按 error details 修正当前阶段引用；缺少上游资料时回到对应阶段，成功持久化后再继续。
- `OPENING_SOURCE_REF_UNKNOWN` / `OPENING_WINDOW_INVALID`：只修正 state 的已读章节范围或 source 节点。
- `OPENING_REPLY_PROJECTION_FAILED`：`choices.*`、`content.empty`、`display.empty` 只重新生成正文；配置/规则 diagnostic 无法由本流程输入修复时保留 code/message/details 并停止。
- `OPENING_PLAY_ALREADY_STARTED`：停止，不覆盖现有游玩。
- `OPENING_*_CONFLICT` / `OPENING_COMPLETE_STATE_INVALID`：保留 code/message/details，停止自动推进，等待明确恢复处理。
- 同一阶段 action 成功但页面刷新后，只在收到新的 `continue` 输入时继续；不要自行把刷新当成玩家回答。

完成条件只有一个：`publish_opening` 成功并使 `setup-summary.status` 成为 `complete`。
