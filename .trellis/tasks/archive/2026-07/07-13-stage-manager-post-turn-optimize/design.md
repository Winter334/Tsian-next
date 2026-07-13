# Design：stage-manager 回合后维护优化

## 架构概述

三条改动线，共同把 stage-manager 的回合后维护从"模型每回合多次回退 workspace_read + 逐个决策 scene 清理"收敛到"read_maintenance_context 一次聚合 + 批量 write + 平台自动清理 scene"。

1. **scene 自动清理 hook**：invokeAgent `workspace-with-checkpoint` commit 成功后，平台读新 runtime.activeSceneRefs，自动删除离开的 scene 文件（跳过 background）。
2. **previousTurnBody 字段**：read_maintenance_context 加返回上一回合正文，供模型判断"驻留 vs 路过"，支撑 scene 延迟创建。
3. **frontier 去冗余 + 措辞修正**：删 stage-manager contextPaths 的 frontier.json 注入；AGENT.md/SKILL 措辞从"读 frontier.json"改为"用 read_maintenance_context 返回的 timeline 字段"。

## 改动 1：scene 自动清理 hook

### 落点

`apps/platform-web/src/platform-host/index.ts:1457` 附近，invokeAgent 写入 trace 后、`finalWorkspaceChanges()` 之前。先把 scene 删除 stage 到 `workspaceTransaction`，再调用 `finalWorkspaceChanges()`，确保删除进入同一个 `post-turn-maintenance` checkpoint。

### 执行逻辑

```
commit 前（trace 写入事务后、finalWorkspaceChanges 前）
  ↓
gate: commitMode === "workspace-with-checkpoint"（仅 stage-manager 维护路径）
  ↓
从 workspaceTransaction.workspaceFiles 读 "save/playthrough/runtime.json" → 解析 runtime
  ↓
提取 runtime.activeSceneRefs → Set<ref>
  ↓
从 workspaceTransaction.workspaceFiles 过滤 path 匹配 "save/scenes/*.json"
  ↓
逐个解析 scene JSON
  ↓
判定：scene.id 不在 activeSceneRefSet 且 scene.status !== "background" → transaction.delete(scenePath)
  ↓
finalWorkspaceChanges() 把 scene 删除纳入同一次 workspace-with-checkpoint commit
  ↓
trace/log: 轻量记录 staged 删除的 scene 列表（供调试可见性）
```

### 边界与错误处理

- **runtime.json 不存在或解析失败**：跳过清理，trace warn。不抛错（清理是增强不是必须）。
- **scene 文件解析失败**：跳过该文件，trace warn，不删除（保守：解析不了的文件不动）。
- **删除失败**：trace warn，继续处理其他 scene，不中断 hook。
- **无 scene 需清理**：静默，无 trace（避免噪音）。
- **事务边界**：hook 在 `finalWorkspaceChanges()` 之前运行，直接操作 `workspaceTransaction`。scene 删除会进入同一次 `workspace-with-checkpoint` commit，维护 checkpoint 恢复后不会把已清理 scene 复活。若回溯到更早 checkpoint，那个 checkpoint 的 manifest 里有当时 scene 的 blob，restore 仍可恢复历史状态。

### 为什么不放进 storage 层（saves.ts）

`commitWorkspaceChangesWithCheckpointForSave` 是通用 commit 路径，会被非 stage-manager 的调用方使用。scene 语义是 AIRP 层概念，放进 storage 层会耦合。host 层（platform-host/index.ts）是 AIRP 运行时编排层，scene 清理属于这层的职责。清理在 host 层被 stage 到现有 `RuntimeWorkspaceTransaction`，再由 storage 层照常提交。

### sceneCleanupCandidates 字段移除

`read_maintenance_context` 当前返回 `sceneCleanupCandidates: [{ref, path, status, reason}]`（run.js:1216-1224）。hook 接管清理后，这个字段变成旧方案遗留噪音：

- 清理已经不是 Agent 职责；
- 候选列表会诱导模型继续逐个判断/读取 scene；
- 按 AI-Facing Content Changes，"不是 Agent 该关心"的概念应从模型可见面移除，而不是保留解释。

因此：

- 从 `read_maintenance_context` 输出中删除 `sceneCleanupCandidates`；
- 从 trace 里删除 cleanupCandidates count；
- AGENT.md/SKILL 不再提"清理候选"，只说：模型维护 `runtime.activeSceneRefs`，平台会自动清理离开的 scene；想保留长期据点时显式写 `status: "background"`。

## 改动 2：previousTurnBody 字段

### 落点

`workspace-templates.ts` 的 `STAGE_MANAGER_READ_MAINTENANCE_CONTEXT_RUN_JS`（run.js）。

### 实现

在 `readMaintenanceContext` 函数里，确定 turn 后，加一步读 `turn - 1` 的 turn 文件：

```
当前 turn 正文（已有 findTurnFile + extractTurnBody 逻辑）
  ↓
if turn > 1: findTurnFile(turn - 1) → extractTurnBody → previousTurnBody
else: previousTurnBody = null（第一回合无上一回合）
  ↓
output.previousTurnBody = previousTurnBody
```

### 输出形态

```js
{
  ...,
  turnBody: { user, assistant },        // 当前回合（已有）
  previousTurnBody: { user, assistant } | null,  // 上一回合（新增）
}
```

### 边界

- turn === 1：`previousTurnBody: null`。SKILL 措辞处理"无上一回合时无法判断驻留，按当前正文判断"。
- turn 文件不存在（回溯后）：`previousTurnBody: null`，同上。
- 字节量：上一回合正文通常几百到一两千字，可接受。

## 改动 3：frontier 去冗余 + 措辞修正

### 3a. 删 contextPaths 注入

`workspace-templates.ts:3059`，stage-manager agent.json contextPaths 删掉：
```
{ path: "save/playthrough/frontier.json", role: "user", position: "workspace-context" },
```

### 3b. 改措辞（5 处）

| 位置 | 原文 | 改为 |
|---|---|---|
| AGENT.md:3111 | "每回合维护：读 `save/playthrough/frontier.json` 的 timeline，判断玩家当前剧情走到哪个 source 锚点之后" | "每回合维护：用 `read_maintenance_context` 返回的 `timeline.sourceAnchors`，判断玩家当前剧情走到哪个 source 锚点之后" |
| AGENT.md:3115 | "读 frontier.json 的 timeline，在玩家视角发生显著事件时追加 player 锚点" | "在玩家视角发生显著事件时追加 player 锚点（用 `read_maintenance_context` 返回的 `timeline` 判断当前锚点状态）" |
| SKILL:1289 | "每回合维护：读 `save/playthrough/frontier.json` 的 timeline..." | "每回合维护：用 `read_maintenance_context` 返回的 `timeline.sourceAnchors`..." |
| SKILL:1299 | "1. 读 `save/playthrough/frontier.json` 的 timeline，筛选 `kind: \"source\"` 的锚点，按 order 排序。" | "1. 用 `read_maintenance_context` 返回的 `timeline.sourceAnchors`（已按 kind 筛好，按 order 排序）。" |
| SKILL:1330 | "读 `save/playthrough/frontier.json` 的 timeline，在玩家视角发生显著事件时追加 player 锚点。" | "在玩家视角发生显著事件时追加 player 锚点（用 `read_maintenance_context` 返回的 `timeline` 判断当前锚点状态）。" |

### 3c. tool.json 描述（可选）

`workspace-templates.ts:1047`，`includeTimeline` 参数描述：
```
当前: "是否包含 frontier.json timeline 摘要（source/player 锚点列表）。默认 false。"
改为: "是否包含 timeline 摘要（source/player 锚点列表）。默认 false。"
```
去掉 "frontier.json" 提及——模型不需要知道 timeline 从哪个文件来。

### 3d. scene 生命周期措辞（SKILL）

SKILL 的"回退流程"段（line 1282）和 scene 维护段（line 1311-1316）加一句：清理由平台自动执行，模型只更新 activeSceneRefs，想保留写 background。

### AI-Facing 合规自检

- **删诱导指令**：5 处"读 frontier.json"全删，改为"用 timeline 字段"。
- **不加禁令**：不写"不要 read frontier.json"。
- **零 surface trace**：grep stage-manager AGENT.md/SKILL，"frontier.json"零命中（tool.json 描述 3c 也清）。
- **不描述机制**：不说"timeline 是从 frontier.json 聚合的"，只说"用 timeline 字段"。

## 数据流

```
stage-manager 回合后维护
  ↓
read_maintenance_context({ turn, includeTimeline: true })
  ↓ run.js 读 turn 正文 + (turn-1) 正文 + runtime + active scenes + entities(brief) + relationships + timeline
  ↓
返回 { turnBody, previousTurnBody, runtime, activeScenes, entities, relationships, timeline }
  ↓
模型基于聚合上下文：
  - 用 timeline.sourceAnchors 设 plotOrder（不再 read frontier.json）
  - 用 turnBody + previousTurnBody 判断驻留 vs 路过，决定是否建 scene
  - 更新 runtime.activeSceneRefs（不逐个读 scene 全文）
  - 罕见：想保留据点 → 写 scene status: "background"
  ↓
workspace_write 批量写入（runtime + scene + relationship + memory）
  ↓
[NEW] pre-finalize hook: 读新 runtime.activeSceneRefs，在同一 workspaceTransaction 中 stage 删除离开的 scene（跳过 background）
  ↓
finalWorkspaceChanges + commit (workspace-with-checkpoint)
  ↓
emitAgentInvocation completed
```

## 兼容性

- **已有存档**：首次触发 hook 时，离开的 scene 被清理，background 保留。无迁移代码。
- **无 stage-manager 的卡**：postTurnMaintenance 未配置 → 不走 invokeAgent → hook 不触发。无影响。
- **scene 文件不存在的存档**：hook 静默无操作。
- **previousTurnBody**：第一回合 null，模型按当前正文判断（SKILL 措辞覆盖）。
- **contextPaths 删 frontier.json**：aggregate.timeline 已含 sourceWindow，覆盖 stage-manager 所有 frontier 用途。

## 不做

- 不自动建 scene（延迟创建靠 SKILL 措辞约束模型，平台不自动建）。
- 不把 scene 清理放进 storage 层（归 host 层）。
- 不加"不要 read frontier.json"禁令（删诱导指令即可）。
- 不动 world-architect/researcher 的 frontier.json contextPaths（它们不走 read_maintenance_context，有自己的访问路径）。
- 不改 frontier.json 的 schema 或 world-architect 的写入逻辑。
