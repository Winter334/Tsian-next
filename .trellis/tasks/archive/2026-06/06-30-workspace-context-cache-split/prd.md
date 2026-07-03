# workspace.context 逐文件拆分优化前缀缓存

## Goal

把当前单条 `Workspace Agent 上下文：…` user message 拆成「稳定元信息 + 逐文件 contextFile message」的细粒度序列，
让稳定 contextFiles（文档/README/schema-guide 等会话中不变的大文件）各自独立进入前缀缓存命中区，
动态 contextFiles（runtime.json / brief / schema 等每轮或偶变文件）单独承担未命中、互不拖累。
目标命中率 85% → ~93-95%（OpenAI/DeepSeek 系，自动前缀缓存路径）。

## Background

### 现状消息序列（`apps/platform-web/src/agent-runtime/index.ts:873-904` buildEntryAgentMessages）

```
system(稳定) → history[summary + recentTurns](稳定,append-only)
  → workspace.context(单条 user,混合稳定+动态) ← 拆分目标
  → 当前回合：N(每轮新) → 玩家本轮输入(每轮新)
```

- design 修正记录 1 已把 workspace.context 后置到 history 之后，避免提前打断 history 缓存。
- 但 workspace.context 自身是单条 message，内含所有 contextFiles 全文拼接（`formatAgentRuntimeContext` `index.ts:753`）。
- **任意一个 contextFile 变 → 整条 message 变 → 从它起的后续全部 miss**，稳定文档被动态文件拖下水；偶变文件之间也互相拖累。

### 真实 contextPaths 稳定性（`apps/platform-web/src/storage/workspace-templates.ts:1364-1470`）

**master**（游玩每轮跑，缓存主力）：
| path | 稳定性 |
|---|---|
| `README.md` | ✅ 稳定 |
| `docs/novel-airp-schema-guide.md` | ✅ 稳定（大概率最大一块） |
| `save/director/current-brief.md` | ⚠️ 偶变 |
| `save/playthrough/runtime.json` | ❌ 每轮变（master 每轮写） |
| `save/schema/current.md` | ⚠️ 偶变 |

**world-architect**（AIRP 初始化）：4 稳定 + 3 动态（schema/schema-changelog/frontier）。

**结论**：master 的 `runtime.json` 每轮变，把整条 workspace.context 连同稳定文档拖 miss——这是 15% 未命中的主嫌疑。偶变文件（brief/schema）之间在同一条 message 里也互相拖累。

### 关键技术事实（代码确认）

- **所有边界锚定逻辑不依赖固定 message index**：
  - `locateHistorySpan`（`index.ts:361`）扫 `"当前回合："` 文本前缀定位 history 段终点。
  - `locateTaskInteractionSpan`（`index.ts:444`）从末尾向前按工具形态（`role:tool` / `<tsian-tool-observation>` 等）扫描，不依赖框架段 message 数量。
  - → workspace.context 拆成 N 条 message 不影响任何压缩/边界判定。
- `WorkspaceFile.updatedAt`（`packages/contracts/src/runtime.ts:202-218`）曾考虑用于跨轮稳定判定，但 R2 证明拆分无需跨轮状态，此字段不参与本设计。

## Requirements

### R1 逐文件拆分 workspace.context

`formatAgentRuntimeContext`（`index.ts:753`）改为产出：
- **元信息段**（跨轮稳定，单条 user message）：header（Agent id/title/summary/path）+ notesFile + missingContextPaths + skillIndex。格式 `Workspace Agent 上下文（元信息）：\n…`（delegated 路径用 `目标 Agent 上下文（元信息）：`）。
- **逐文件段**：每个 contextFile 独立一条 user message，格式 `Workspace 文件 <path>：\n<formatWorkspaceFile(file)>`，按 contextPaths 声明顺序排列。

`buildEntryAgentMessages`（`index.ts:873`）把原来的单条 user message 替换为：
```
…history…
→ { user: "Workspace Agent 上下文（元信息）：\n" + meta }       ← 命中
→ { user: "Workspace 文件 README.md：\n…" }      ← 稳定,命中
→ { user: "Workspace 文件 docs/…schema-guide.md：\n…" }   ← 稳定,命中
→ { user: "Workspace 文件 save/…runtime.json：\n…" }       ← 动态,miss
→ { user: "Workspace 文件 save/…brief.md：\n…" }           ← 偶变,独立 miss
→ 当前回合：N → 玩家输入
```

不重排 contextPaths 声明顺序——稳定的自然落在前缀区、动态的在尾部（现实声明里文档在前、状态在后）。强制重排会破坏 agent 作者的语境组织意图，且 OpenAI 前缀缓存按 token 前缀匹配不按 message 边界，重排无额外收益。

### R2 无跨轮状态：拆分即全部杠杆

**核心洞察**：命中率由 provider 前缀缓存决定，不由我们的"稳定/动态判定"决定。把每个 contextFile 拆成独立 message 后——
- file 内容没变 → message 字节不变 → provider 自动缓存命中；
- file 内容变了 → 该 message miss，**不影响其他 file 的 message**（它们各自独立）。

我们不需要"告诉"provider 哪个稳定，也不需要跨轮比对来决定 message 结构。**拆分本身（每个 file 一条 message）就是全部命中率杠杆，无需任何跨轮状态。**

- 每轮 `buildEntryAgentMessages` 用本轮 `workspaceFiles` 的内容把每个 contextFile 各产一条 message，按 contextPaths 声明顺序排列。
- 首轮自然退化：所有 file 首次出现无前缀可命中，无需特殊分支。
- 不依赖路径启发式、不依赖 agent 声明、不依赖跨轮快照，自动适配任意卡/任意 agent。

### R3 显示标签增强（服务 AC1/AC2 验证）

在 `inferMessageSegmentLabel`（`ai.ts:53`）和 `segmentStability`（`ai.ts:67`）加识别新 message 标签：
- `"Workspace Agent 上下文（元信息）"` / `"目标 Agent 上下文（元信息）"` 开头 → label `workspace.meta`，stability `semi-stable`。
- `"Workspace 文件 "` 开头 → label `workspace.file`，stability `semi-stable`。

这是 AC1/AC2 验证的依赖：没有 `workspace.file` 标签，DebugView messageSegments 无法区分各文件段、无法跨轮对比 charLength。标 `semi-stable` 与现有 `history` 同语义（理论可变但希望多数轮次命中）。成本极低（两个 if 分支），纳入本任务范围。

命中率真实口径仍由 provider 返回的 `usage`（cached_tokens / prompt_tokens）提供，不自建跨轮快照。

### R4 Claude 适配暂不做

本任务不引入 `cache_control: {type:"ephemeral"}` 断点。Claude provider 下稳定 file 不会自动缓存，拆分对 Claude 主要省的是"稳定文档不进 input 计费"的 token 成本而非命中率——这是可接受的副作用，后续单独任务再做。

### R5 delegated agent 路径对齐

`buildDelegatedAgentMessages`（`index.ts:1057` 附近的 `目标 Agent 上下文：`）同样逐文件拆分。delegated agent 通常单次调用无跨轮快照，首轮退化即可（与 R2 一致）。

### R6 元信息段归属理由

R1 把 header + notesFile + missingContextPaths + skillIndex 归入同条元信息段，理由：
- notesFile：agent 自己的笔记，语义可变但不在 contextPaths 里、独立加载，字节量小、变化频率低，偶发 miss 可接受。
- missingContextPaths：随 contextFiles 存在性变化，但字节量极小且通常稳定。
- skillIndex：依赖 `skills/` 下 skill.config，会话中通常稳定。
- 元信息段偶发 miss（agent 编辑定义/写 notes/装 skill 时）可接受，不值得为这点字节再拆 message。

## Acceptance Criteria

- AC1：master 连续多轮（agent 每轮写 runtime.json、不动 docs/schema-guide）发送的 prompt 中，`docs/novel-airp-schema-guide.md` 全文出现在独立一条 message，且该 message 字节内容跨轮不变（可由 AiDebugRecord messageSegments 连续两轮对比验证）。
- AC2：`runtime.json` 出现在独立一条 message，跨轮内容变化；该轮 `brief.md` 若未变，其 message 字节内容保持不变（验证偶变文件互不拖累）。
- AC3：首轮或无快照退化路径，不报错，所有 contextFile 仍各一条 message，元信息段单独一条。
- AC4：现有压缩逻辑（`locateHistorySpan`、`locateTaskInteractionSpan`、`compressTaskContext`）边界不受影响——history 仍从 system 之后开始、到"当前回合："之前结束；工具交互段从末尾向前扫描仍正确定位。
- AC5：delegated agent（`目标 Agent 上下文：`）路径同样逐文件拆分，单次调用退化首轮。
- AC6：`npm run build --workspace platform-web`（含 `vue-tsc -b` 类型检查 + `vite build`）通过。项目无独立 lint/测试框架，类型检查 + 构建是主验证。

## Out of Scope

- Claude `cache_control` 显式断点（R4，后续任务）。
- observation 裁剪改动（已实现 6KB/2KB 阈值，且在缓存前缀内，非命中率杠杆）。
- workspace.context 段顺序重排 / contextPaths 声明顺序覆盖（不前置到 history 之前，避免动 design 修正记录 1 和 agent 作者语境组织）。
- 压缩触发频率调优。

## Open Questions

（无——R2/R3 简化后，原 OQ1 快照存放点已不存在；其余设计决策均已由代码查证确定。design.md 记录实现细节。）
