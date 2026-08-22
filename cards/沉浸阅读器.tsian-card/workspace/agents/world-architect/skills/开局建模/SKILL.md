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
    "description": "读取导入源清单和开头章节预览。",
    "inputSchema": { "type": "object", "properties": { "previewCount": { "type": "number" }, "previewCharacters": { "type": "number" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/inspect-source-opening.js", "timeoutMs": 10000, "helpers": ["_common.js"] }
  },
  {
    "name": "read_opening_slice",
    "description": "读取指定章节范围的正文和窗口信息。",
    "inputSchema": { "type": "object", "properties": { "startIndex": { "type": "number" }, "endIndex": { "type": "number" }, "maxCharacters": { "type": "number" } } },
    "outputSchema": { "type": "object" },
    "executor": { "type": "browser_script", "path": "scripts/read-opening-slice.js", "timeoutMs": 10000, "helpers": ["_common.js"] }
  },
  {
    "name": "commit_opening_entities",
    "description": "提交本期开局所需实体。",
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
    "description": "根据已提交实体，提交场景和人物关系。",
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
    "description": "根据已提交资料，提交 runtime、frontier 和开局摘要。",
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
    "description": "使用 storyteller 正文发布首回合。",
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

使用 `save/playthrough/opening-notes.md` 保存中断恢复所需的自然语言工作记忆：

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

阶段提交成功后更新“已完成/下一步”；失败时只记录待修正的问题。

## 执行规则

每次 invocation 读取工作笔记和已提交资料，找到下列首个未完成阶段，只执行该阶段。已完成阶段直接复用。

组装实体、场景、关系、runtime 或 frontier 前，读取 `save/schema/current.md` 和 `docs/novel-airp-schema-guide.md` 中与当前资料有关的部分；速查不足时再读取 `docs/novel-airp-schema-reference.md`。使用文档已有的字段和形状；需要新结构时先完成 schema 变更。

`commit_opening_entities`、`commit_opening_graph` 或 `commit_opening_state` 成功后，更新工作笔记，回复一句简短进度文字并在末尾写 `[[开局继续]]`，然后结束本次 invocation。下一阶段等待新的 `continue` 输入。

### 1. 恢复、取证与访谈

当前问题缺少来源证据时调用 `inspect_source_opening` 或 `read_opening_slice` 定向读取。每轮确认一个会改变正式模型或首回合的高价值分歧，快捷选项集中在一个 `[[开局选项]]` 块中：

```text
[[开局选项]]
- 选项一
- 选项二
[[/开局选项]]
```

实体只反映切入点那一刻已经成立的事实；已读范围内但发生在切入点之后的事件不写成当前状态。主角、切入点和首回合最小事实明确，并且玩家明确确认开始后，更新工作笔记。确认前继续访谈和取证，不提交开局资料。

### 2. 实体阶段

只组装本期开局需要的完整 `entities`，至少包含主角和开局地点，然后调用 `commit_opening_entities`。

### 3. 场景与关系阶段

从 `save/entities/...` 读取权威实体，只组装完整 `scenes` 和 `relationships`。场景至少包含 id、name、location 和 present；relationships 只保存 character-to-character 边。调用 `commit_opening_graph`。

### 4. 状态阶段

从正常实体、场景和关系资料组装 `runtime`、`frontier` 与玩家可读 `summary`。runtime 的 protagonist/location/active scenes 必须指向已落盘资料。frontier 使用实际已读 `sourceWindow.startIndex/endIndex`，至少包含一个 source 节点；每个节点写 `chapter/time/label/summary`：

- `label` 是一句客观标签；
- `summary` 是 1～3 句客观梗概，只概括你实际读过的原著内容；
- 不把未读内容、创作指令或玩家尚未经历的事件伪装成已发生事实。

调用 `commit_opening_state`，并在工作笔记中保留首回合正文边界。

### 5. 首回合正文与发布

读取：

- `save/playthrough/opening-notes.md` 的正文边界；
- `save/playthrough/runtime.json`；
- active scene、在场实体和必要人物关系；
- `save/playthrough/frontier.json` 的开局 source 节点与 summary。

通过 `agent_call` 委派 `storyteller`。request 只提供所需 workspace 路径、切入点、正文终点和输出格式，不复制已在 workspace 中的实体、场景、关系或 runtime 全文：

- 读取上述资料，使用已读原著与玩家确认事实写正式首回合；
- 只返回正文，末尾带 1～12 个正式 `[[选项]]...[[/选项]]`。

用成功 observation 的 `response` 核对正文终点以及 runtime、active scene、在场实体；正文有误时重新委派，已提交资料有误时回到对应资料阶段修正。

核对通过后调用 `publish_opening`：`run_script.input` 传空对象，把 observation 的 `responseRef` 放在 `run_script.inputRefs.openingReply`。成功后回复开局已准备完成。

## 恢复

- action 失败时根据错误结果修正当前阶段；已完成阶段保持不变。
- storyteller 或发布失败时重试正文与发布；只有已提交资料有误时才回到资料阶段。
- 已开始游玩、资料冲突或完成状态无效时，保留错误详情并停止。

完成条件只有一个：`publish_opening` 成功并使 `setup-summary.status` 成为 `complete`。
