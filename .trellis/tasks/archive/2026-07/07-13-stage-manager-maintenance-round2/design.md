# Design：stage-manager 维护优化第二轮

## 架构概述

两条改动线，继续把 stage-manager 回合后维护从 5 轮收敛到 2-3 轮。

1. **readEntity 全文返回**：run.js 的 `readEntityBrief` 改为 `readEntity`，返回完整 entity JSON。已读全文却丢弃是纯浪费——既然 `readJsonFile` 已经读了完整 JSON，就返回完整 JSON。
2. **memory 文件路径明确 + 注入授权**：指明 recall/scene/npc_action 写 `save/memory/records.md`；新增 records.md 模板 + contextPaths；AGENT.md 措辞正面引导用注入内容。

## 改动 1：readEntity 全文返回

### 落点

`workspace-templates.ts` 的 `STAGE_MANAGER_READ_MAINTENANCE_CONTEXT_RUN_JS`（run.js），`readEntityBrief` 函数（line 1118-1124）。

### 实现

当前：
```js
async function readEntityBrief(tsian, ref, signal) {
  const path = refToEntityPath(ref);
  if (!path) return { ref: ref, name: ref, brief: '' };
  const entity = await readJsonFile(tsian, path, signal);
  if (!isRecord(entity)) return { ref: ref, name: ref, brief: '' };
  return { ref: ref, name: entity.name || ref, brief: typeof entity.brief === 'string' ? entity.brief : '' };
}
```

改为：
```js
async function readEntity(tsian, ref, signal) {
  const path = refToEntityPath(ref);
  if (!path) return { ref: ref, name: ref };
  const entity = await readJsonFile(tsian, path, signal);
  if (!isRecord(entity)) return { ref: ref, name: ref };
  // 返回完整 entity JSON，附 ref（ref 不一定等于 entity.id，保持下游消费一致）
  entity.ref = ref;
  return entity;
}
```

- 返回完整 entity JSON 对象，附 `ref` 字段（下游 `entities` 数组消费 `ref` 做匹配）。
- 文件不存在/解析失败时返回 fallback `{ref, name: ref}`（无 entity 字段，下游识别"无 entity 数据"）。
- 调用点（line 1211）`const brief = await readEntityBrief(...)` 改为 `const entity = await readEntity(...)`，`entities.push(brief)` 改为 `entities.push(entity)`。
- run.js 注释里 "相关 entity/relationship 摘要" 改为 "相关 entity（完整）/relationship 摘要"。

### 输出形态

```js
entities: [
  { ref: "character:飞星", id: "character:飞星", name: "飞星", brief: "...", identity: {...}, attributes: {...}, status: [...], traits: [...], goals: {...}, ... },
  { ref: "character:玉霜", id: "character:玉霜", name: "玉霜", ... },
]
```

每项是完整 entity JSON + `ref` 字段。

### 边界

- entity JSON 很大（含 background/appearance 等长字段）：可接受。活跃 entity 通常 2-3 个，每个几百到一两千字。比起省掉的 1-2 轮 workspace_read（每轮一个 API round + tool observation 往返），token 开销更小。
- entity 含 `portrait.path` 等媒体指针：返回无妨，stage-manager 重写 entity 时应保留 portrait 字段（AGENT.md 已有此约束）。
- fallback `{ref, name: ref}` 无 entity 字段：下游（模型）识别"无 entity 数据"时不写该 entity，与当前 brief fallback 行为一致。

### 为什么不选"扩 brief 加几个字段"

见 PRD 约束段：选哪几个字段是拍脑袋判断，最终会演化成返回全文。一步到位 readEntity 更干净。原则 9 约束 schema 字段存不存在，不约束聚合工具返回多少字段。

## 改动 2：memory 文件路径明确 + records.md + 注入授权

### 2a. AGENT.md "记忆格式"段

当前（line 3082-3090）：
```
## 记忆格式

回合后维护 memory 时，按标签记忆格式追加，每条一行：
`- [序号] <recall|scene|npc_action> 关键词: 简短关键词; 摘要: 一句客观事实`
...
```

改为：
```
## 记忆格式

回合后维护 memory 时，基于上下文已注入的 `save/memory/records.md` 内容，按标签记忆格式追加，每条一行：
`- [序号] <recall|scene|npc_action> 关键词: 简短关键词; 摘要: 一句客观事实`
...
```

### 2b. AGENT.md "伏笔追踪"段

当前（line 3095）：
```
维护 `save/memory/seeds.md`：
```

改为：
```
基于上下文已注入的 `save/memory/seeds.md` 内容维护伏笔：
```

### 2c. 新增 records.md 模板

`workspace-templates.ts` 新增 `save/memory/records.md` 文件条目，内容：
```markdown
# 回合记忆记录

按标签记忆格式追加，每条一行：
`- [序号] <recall|scene|npc_action> 关键词: 简短关键词; 摘要: 一句客观事实`

- `recall`：玩家可回忆的前文事件
- `scene`：当前场景的关键状态变化
- `npc_action`：NPC 的自主行动

只记客观事实，去修辞。序号递增。不复制整段正文原文。
```

### 2d. stage-manager contextPaths 加 records.md

stage-manager agent.json contextPaths（line 3055-3063）加：
```
{ path: "save/memory/records.md", role: "user", position: "workspace-context" },
```

放在 seeds.md 之后。

### 2e. SKILL.md 同步

SKILL 的 memory 维护段（如有）同步措辞，指向 records.md + 注入授权。

### AI-Facing 合规自检

- **正面引导**：措辞用"基于上下文已注入的 X 内容追加/更新"，不用"不要 read X"。
- **不加禁令**：不写"不要 workspace_read records.md / seeds.md"。
- **与 frontier.json 修法一致**：删诱导动词（"维护 X"→"基于已注入的 X 内容维护"），让注入内容被授权为权威。

## 数据流

```
stage-manager 回合后维护
  ↓
read_maintenance_context({ turn, includeTimeline: true })
  ↓ run.js 读 turn 正文 + (turn-1) 正文 + runtime + active scenes + 完整 entities + relationships + timeline
  ↓
返回 { turnBody, previousTurnBody, runtime, activeScenes, entities[完整], relationships, timeline }
  ↓
模型基于聚合上下文：
  - 用完整 entity 判断 status/goals/traits 等是否要改 → workspace_edit/write（不读全文）
  - 基于已注入的 records.md / seeds.md 追加记忆/更新伏笔（不读文件）
  - 用 timeline.sourceAnchors 设 plotOrder
  - 更新 runtime.activeSceneRefs
  ↓
workspace_write 批量写入
  ↓
commit (workspace-with-checkpoint) + scene 自动清理
```

## 兼容性

- **已有存档无 records.md**：首次维护时 contextPaths 注入缺失文件 → assembleAgentContext 报 missingContextPaths，模型 workspace_write 创建。无迁移代码。
- **readEntity 返回完整 entity**：下游（模型）消费完整 entity，fallback `{ref, name: ref}` 仍可识别。无 breaking change。
- **records.md 分文件**：与 seeds.md 分开，按自然单元（recall/scene/npc_action vs 伏笔）分片，符合 AIRP 原则 5。

## 不做

- 不动 activeScenes/relationships/runtime/timeline 聚合字段。
- 不动 researcher/world-architect 的 entity 读取（它们有自己的路径）。
- 不加"不要 read records.md / seeds.md"禁令。
- 不改 entity schema（readEntity 只是返回已有 entity，不改 entity 结构）。
