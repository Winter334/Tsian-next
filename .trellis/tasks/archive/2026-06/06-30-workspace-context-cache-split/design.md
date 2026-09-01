# Design — workspace.context 逐文件拆分优化前缀缓存

## 1. 架构与边界

### 1.1 改动范围

| 文件 | 改动 | 性质 |
|---|---|---|
| `apps/platform-web/src/agent-runtime/index.ts` | `formatAgentRuntimeContext` 重构 + `buildEntryAgentMessages` / `buildDelegatedAgentMessages` 调用点调整 | 核心改动 |
| `apps/platform-web/src/runtime-host/ai.ts` | `inferMessageSegmentLabel` / `segmentStability` 识别新 message 标签 | 显示层增强（可选，见 §4） |

**不改动**：contracts（无 schema 变更）、storage、context-lifecycle、workspace-tools、compression 逻辑、编排层（platform-host/assistant-chat）。

### 1.2 无跨轮状态原则

本设计的关键简化：**不引入任何跨轮状态**。

- 命中率由 provider 前缀缓存决定。把每个 contextFile 拆成独立 message 后，file 内容没变 → message 字节不变 → provider 自动缓存；变了 → 该条 miss，不影响其他 file。
- 我们不需要"判定"哪个文件稳定来决定 message 结构——拆分本身即是全部杠杆。
- 因此不需要 `Map<path, updatedAt>` 快照、不改 context.json schema、不在编排层加模块级状态。编排层（platform-host/assistant-chat）完全不动。

## 2. 核心重构：formatAgentRuntimeContext

### 2.1 现状

`formatAgentRuntimeContext`（`index.ts:753`）返回单个字符串，把 header + notesFile + contextFiles 全文 + missingContextPaths + skillIndex 拼成一坨。调用方（`buildEntryAgentMessages:897`、`buildDelegatedAgentMessages:1059`）把它包进单条 user message。

### 2.2 新设计：产出 message 数组

改为返回 `RuntimeChatMessage[]`（元信息段 + 逐文件段）。签名：

```ts
function buildAgentContextMessages_split(
  context: AgentContextEntry,
  label: "Workspace Agent 上下文" | "目标 Agent 上下文",
): RuntimeChatMessage[]
```

产出顺序：
```
[0] { user: "<label>（元信息）：\n" + meta }       // header + notesFile + missingContextPaths + skillIndex
[1] { user: "Workspace 文件 <path>：\n<fileBody>" }  // contextFiles[0]
[2] { user: "Workspace 文件 <path>：\n<fileBody>" }  // contextFiles[1]
…                                                    // 按 contextPaths 声明顺序
```

### 2.3 元信息段内容

复用现有 `formatAgentRuntimeContext` 的非 contextFiles 部分，保持字节稳定（跨轮不变即命中）：
```
Agent：{id} — {title}
Agent 摘要：{summary}
Agent 定义路径：{path}

Agent notes：
{notesFile body 或 "（无 Agent notes）"}

缺失的 contextPaths：
{missingContextPaths 或 "（无缺失 contextPaths）"}

可见 Skill Index（仅摘要，未加载 Skill 详情）：
{skillIndex 或 "（暂无可见 Skill）"}
```

### 2.4 逐文件段格式

每个 contextFile 一条 message：
```
Workspace 文件 {file.path}：
{formatWorkspaceFile(file)}
```

`formatWorkspaceFile`（`index.ts:464`）保持不变——它已经产出 `--- {path} ---\n{content}` 形态。为避免双路径前缀冗余，逐文件段直接用 `formatWorkspaceFile(file)` 作 body，message content = `Workspace 文件 ${file.path}：\n${formatWorkspaceFile(file)}`。

**空 contextFiles 处理**：若 `context.contextFiles.length === 0`，不产出逐文件段，元信息段的"缺失的 contextPaths"区已覆盖该信息（现有逻辑 `formatContextFiles` 返回"（暂无已加载 contextPaths 文件）"——这个提示移入元信息段）。

## 3. 调用点调整

### 3.1 buildEntryAgentMessages（`index.ts:873-904`）

现状：
```ts
{ role: "user", content: `Workspace Agent 上下文：\n${formatAgentRuntimeContext(context)}` },
```
改为：
```ts
...buildAgentContextMessages_split(context, "Workspace Agent 上下文"),
```

序列变为：
```
system → history → [元信息] → [file1] → [file2] → … → 当前回合 → beforeInputInjection → 玩家输入 → afterInputInjection
```

### 3.2 buildDelegatedAgentMessages（`index.ts:1048-1059`）

现状：
```ts
{ role: "user", content: `目标 Agent 上下文：\n${formatAgentRuntimeContext(targetContext)}` },
```
改为：
```ts
...buildAgentContextMessages_split(targetContext, "目标 Agent 上下文"),
```

delegated 路径首轮退化天然成立：单次调用无前缀可命中，所有 message 首次出现，provider 无缓存可吃——与改动前行为一致（改动前也是单次调用首次出现）。

## 4. 边界逻辑安全性验证

### 4.1 locateHistorySpan（`index.ts:361`）

扫 `"当前回合："` / `"当前问答轮次："` 文本前缀定位 history 段终点。workspace.context 拆成 N 条后，这些 N 条仍在 history 和"当前回合："之间，`end` 仍指向"当前回合："那条。**安全。**

### 4.2 locateTaskInteractionSpan（`index.ts:444`）

从末尾向前按工具形态扫描（`role:tool` / `<tsian-tool-observation>` / `<tsian-tool-call>`）。workspace.context 拆出的 message 都是 `role:user` 且不含工具标签 → `isTaskInteractionMessage` 返回 false → 不被误判为工具交互段。**安全。**

### 4.3 压缩段定位（compressTaskContext / compressContext）

`compressTaskContext` 入参的 interactionSpan 由 `locateTaskInteractionSpan` 提供（§4.2 已验证）。`compressContext`（剧情压缩）操作的是 `AgentContextSnapshot.recentTurns`，与 workspace.context message 无关。**安全。**

### 4.4 inferMessageSegmentLabel / segmentStability（`ai.ts:53-73`）

新 message 标签 `"Workspace 文件 …"` 和 `"…（元信息）："` 当前会落入 `inferMessageSegmentLabel` 的兜底 `"message"` 分支，`segmentStability` 标为 `dynamic`。这会让 DebugView 缓存断点可视化误把稳定文件标成 dynamic，且 AC1/AC2 验证无法跨轮区分各文件段。

**本任务做（PRD R3 已纳入范围）**：在 `inferMessageSegmentLabel` 加识别：
- text 以 `"Workspace Agent 上下文（元信息）"` / `"目标 Agent 上下文（元信息）"` 开头 → label `"workspace.meta"`，stability `semi-stable`
- text 以 `"Workspace 文件 "` 开头 → label `"workspace.file"`，stability `semi-stable`

标 `semi-stable` 而非 `stable`：因为这些文件理论上可变（agent 写 runtime.json），只是希望多数轮次命中。这与现有 `history` 标 `semi-stable` 同语义。

## 5. 兼容性与迁移

- **无 schema 变更**：不改 `AgentContextSnapshot`、不改 `WorkspaceFile`、不改 context.json。
- **无存储改动**：编排层、storage 层完全不动。
- **无持久化迁移**：旧 context.json / 会话消息存储照常工作；本改动只在内存组装 message 时生效。
- **回滚**：单文件 `index.ts` 改动（+ `ai.ts` 显示标签），`git revert` 即可恢复，无数据残留。

## 6. tradeoffs

| 决策 | 选择 | 理由 | 放弃的选项 |
|---|---|---|---|
| 拆分粒度 | 逐文件 | 消除偶变文件互相拖累，增量 2-3% 命中率 | 两条（稳定/动态分组）：偶变文件同组互相拖累 |
| 跨轮状态 | 无 | 拆分即全部杠杆，判定不改变 message 结构 | updatedAt 快照：改 schema 或加模块级状态，复杂度高、收益为零 |
| 顺序 | 保持 contextPaths 声明顺序 | 稳定文件自然在前缀区；重排破坏 agent 作者语境组织且无收益 | 强制稳定前置：需覆盖声明顺序、处理边界、收益为零 |
| Claude cache_control | 不做 | 用户明确暂不适配 | 加断点：后续单独任务 |
| 元信息段归属 | header+notes+missingPaths+skillIndex 同条 | 字节量小、变化频率低，偶发 miss 可接受 | 每个独立一条：message 数量膨胀无收益 |

## 7. 操作与回滚

- 验证主路径：DebugView 观察 master 连续两轮的 `messageSegments`，确认 `docs/novel-airp-schema-guide.md` 那条 `charLength` 跨轮不变、`runtime.json` 那条变化。
- 验证压缩：跑一个会触发 `compressTaskContext` 的长任务，确认 `locateTaskInteractionSpan` 仍正确定位、压缩产出正常。
- 回滚点：`git revert` 单 commit，无数据迁移、无残留状态。
