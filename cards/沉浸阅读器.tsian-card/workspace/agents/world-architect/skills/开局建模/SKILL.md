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
    "description": "提交本期开局所需实体。该阶段一次性全量提交。",
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
    "description": "根据已提交实体，提交场景和人物关系。该阶段一次性全量提交。",
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
        "frontier": {
          "type": "object",
          "description": "含 sourceWindow.startIndex/endIndex 与 timeline 数组；可选 entryAnchorIndex（1-based，指向 timeline 中玩家切入点所在的锚点，决定 runtime.plotOrder，缺省或越界时取第 1 个锚点）。"
        },
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

使用 `save/playthrough/opening-notes.md` 保存中断恢复所需的自然语言工作记忆。每次 invocation 的上下文都会清空，笔记里没写的东西下一轮就找不回来：

```md
# 开局建模工作笔记

## 已确认
- 玩家角色、切入点和其他已确认选择

## 已读原文
- 实际读过的章节范围及用途

## 切入点锚点
- 玩家切入点落在 frontier.timeline 的第几个锚点（1-based），以及该锚点对应的章节

## 世界观口径与刻度
- 已写入 save/schema/current.md 的档位、阶梯与维度定义，一句话摘要

## 已落盘路径
- 每次 commit 成功后，把返回的 writes 路径原样抄到这里

## 已完成
- 已经成功持久化的资料阶段

## 下一步
- 首个尚未完成的阶段或需要修复的具体问题

## 正文边界
- 首回合从哪里开始、停在哪个等待玩家选择的瞬间
```

阶段提交成功后更新“已落盘路径/已完成/下一步”；失败时只记录待修正的问题。

## 执行规则

**每次 invocation 的第一步**：并行读取工作笔记 `save/playthrough/opening-notes.md` 与本 skill 目录下的 `agents/world-architect/skills/开局建模/workspace-map.md`。后者给出全部路径格式、提交语义、锁定规则与完整性判据——不要用 glob、list 或语义搜索去找存档文件的位置。

然后从首个未完成阶段继续，已完成阶段直接复用。阶段划分：

| 阶段 | invocation 安排 |
|---|---|
| §1 访谈 | 逐轮问答，玩家确认后结束 |
| §2 实体 + §3 场景与关系 | **允许在同一次 invocation 内连做** |
| §4 状态 | 独立一次 |
| §5 正文与发布 | 独立一次 |

组装任何资料前，先读 `save/schema/current.md`（已注入上下文）确认本存档口径；字段形状查 `docs/novel-airp-schema-guide.md` 中相关的部分，速查不足时再查 `docs/novel-airp-schema-reference.md`。使用文档已有的字段和形状；需要新结构时先完成 schema 变更。

一次 invocation 该做的阶段全部提交成功后，把返回的 `writes` 路径记入工作笔记，回复一句简短进度文字并在末尾写 `[[开局继续]]`，然后结束本次 invocation。下一阶段等待新的 `continue` 输入。

### 1. 恢复、取证与访谈

当前问题缺少来源证据时调用 `inspect_source_opening` 或 `read_opening_slice` 定向读取。每轮确认一个会改变正式模型或首回合的高价值分歧，快捷选项集中在一个 `[[开局选项]]` 块中：

```text
[[开局选项]]
- 选项一
- 选项二
[[/开局选项]]
```

主角、切入点和首回合最小事实明确，并且玩家明确确认开始后，更新工作笔记。确认前继续访谈和取证，不提交开局资料。

### 2. 实体阶段

**前置：先填写 `save/schema/current.md`。** 按 `docs/属性刻度规范.md` 的方法读出本作的力量体系阶梯、选定档位、算出各阶区间、定下维度名称与类别，写进该文件的对应槽位。若该文件还是旧版无槽位的内容，整体重写它。这一步定下的口径，后续场记与写手都会沿用。

然后组装本期开局需要的**全部**实体，至少包含主角和开局地点，调用 `commit_opening_entities`。

两条硬约束（详见 `workspace-map.md`）：

- **一次写全。** 场景或关系一旦落地，实体路径即锁死，开局期内没有回头补的机会。
- **只写切入点那一刻已经成立的事实。** 已读范围内、但发生在切入点之后的事件不写成当前状态。写下每条事实前问一句「玩家按下第一个选项之前，这件事已经发生了吗」。

属性数值按 `current.md` 刚写下的档位与区间取，不要凭印象给，也不要全填基线。

### 3. 场景与关系阶段

读取已落盘的权威实体（路径见 `workspace-map.md` 的 ref→路径表；**场景与关系不在 `save/entities/` 下**），组装本期的全部 `scenes` 和 `relationships`，调用 `commit_opening_graph`。

- `relationships` 只保存 character-to-character 边。
- **每个被引用的角色都要有自己的 subject 分片**；只出现在别人 `edges[].to` 里而没有分片的角色等于没有关系数据。
- **双向关系两边各写一条**；单向的认知、暗恋、隐瞒可只写主体侧。
- 首回合登场的每个角色都应有分片，尤其是唯一登场的那个 NPC。
- 本阶段同样是一次性全量提交，状态阶段完成后即锁死。

### 4. 状态阶段

从已落盘的实体、场景和关系组装 `runtime`、`frontier` 与玩家可读 `summary`。runtime 的 protagonist/location/active scenes 必须指向已落盘资料。frontier 使用实际已读 `sourceWindow.startIndex/endIndex`，至少包含一个 source 节点；每个节点写 `chapter/time/label/summary`：

- `label` 是一句客观标签；
- `summary` 是 1～3 句客观梗概，只概括你实际读过的原著内容；
- 不把未读内容、创作指令或玩家尚未经历的事件伪装成已发生事实。

**传 `frontier.entryAnchorIndex`**（1-based）：玩家切入点落在 timeline 的第几个锚点。它决定 `runtime.plotOrder`，场记据此判断何时推进 frontier。当 timeline 里含有切入点之前的前史锚点时，这个字段必须显式传——缺省会退回第 1 个锚点，把玩家的剧情位置标错。

调用 `commit_opening_state`，并在工作笔记中保留首回合正文边界。

### 5. 首回合正文与发布

读取工作笔记的正文边界、runtime、active scene、在场实体、必要人物关系，以及 frontier 的开局 source 节点与 summary。

通过 `agent_call` 委派 `storyteller`。request 只提供所需 workspace 路径、切入点和正文终点，**不复制已在 workspace 中的实体、场景、关系或 runtime 全文**。

输出格式**以 storyteller 自身的输出格式说明为准**，不要在 request 里另行规定选项标记、字数或选项条数。写手的输出契约由它自己维护；在这里重复一遍只会在契约改版后留下过期指令，而过期的选项标记会让 `publish_opening` 直接投影失败。

拿到成功 observation 的 `response` 后，逐条核对并**把判定结果写在回复里**，全部通过才能发布：

1. 正文终点停在工作笔记记录的那个瞬间；
2. 正文出现的人物、地点、物件都已落盘；
3. 正文没有写入切入点之后才成立的事实；
4. 正文事实与实体权威一致——外貌、伤势、位置、持有物、称谓逐项对照实体 json，不凭正文读感放行；
5. 选项都是玩家角色下一步可执行的动作。

任一条不过：正文问题重新委派 storyteller，已提交资料有误则回到对应资料阶段修正。

核对通过后调用 `publish_opening`：`run_script.input` 传空对象，把 observation 的 `responseRef` 放在 `run_script.inputRefs.openingReply`。成功后回复开局已准备完成。

## 恢复

- action 失败时根据错误结果修正当前阶段；已完成阶段保持不变。常见错误码与成因见 `workspace-map.md`。
- storyteller 或发布失败时重试正文与发布；只有已提交资料有误时才回到资料阶段。
- 已开始游玩、资料冲突或完成状态无效时，保留错误详情并停止。

完成条件只有一个：`publish_opening` 成功并使 `setup-summary.status` 成为 `complete`。
