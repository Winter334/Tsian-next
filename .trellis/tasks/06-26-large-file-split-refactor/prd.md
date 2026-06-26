# 大文件拆分重构：agent-runtime / storage / views

## Goal

将 platform-web 中体量大、变更频繁、职责过载的超大单文件拆分为内聚的子模块，
降低单文件认知负担、减少高频改动文件的合并冲突、让后续每次开发都受益。
**纯结构重构，不改变运行时行为。**

## User Value

- AI 与人在大文件中定位代码更快（尤其 `agent-runtime/index.ts`、`storage/workspace.ts` 等热路径）。
- 高 churn 文件拆分后，并行改动落到不同子模块，合并冲突概率下降。
- 单文件职责边界清晰后，后续增量改动只需理解相关子模块，复利收益。

## Confirmed Facts（已通过仓库调查确认）

### 拆分目标与度量

| # | 文件 | 行数 | 提交数 | 职责信号 | 消费方数 | 价值档 |
|---|------|------|--------|----------|----------|--------|
| 1 | `storage/workspace.ts` | 2284 | 28 | 31 export，纯函数为主 | 6 | 🟢 高 |
| 2 | `agent-runtime/workspace-tools.ts` | 2461 | 30 | 类型定义+执行逻辑混装 | 3 | 🟡 中 |
| 3 | `agent-runtime/workspace-operations.ts` | 1386 | 13 | 中等 | 3 | 🟡 中 |
| 4 | `agent-runtime/index.ts` | 2292 | 48 | 8 export + 49 内部函数，turn 主循环，最高 churn | 3 | 🟢 高 |
| 5 | `runtime-host/ai.ts` | 1605 | 13 | 45 声明，按 provider/能力可切 | 1 | 🟡 中 |
| 6 | `views/AssistantView.vue` | 1801 | 25 | script 993 行 / template 614 / style 193 | 0（路由组件） | 🟢 高 |

### 仓库既有约定

- parent/child 任务结构已被使用（`06-22-mvp-completion` 下挂 `06-22-account-system`、`06-22-app-market`）。
- `task.py create --parent <dir>` 创建子任务时自动建立链接。
- 6 个目标均位于 `apps/platform-web/src/`。

## Requirements

- 每个大文件拆为一个**同目录子模块集合**，按内聚职责切分（不按行数均分）。
- **纯重构：公共行为、类型、运行时输出保持不变。** 拆分前后对等测试/类型检查通过。
- 每个子任务独立可规划、可实现、可检查、可归档；子任务间有顺序依赖时写入各自 prd。
- 父任务持有总体需求集、任务地图、跨子任务验收标准与最终集成评审，不直接做实现。

## Task Map（子任务，建议执行顺序）

> 顺序按"依赖基础 + 风险递增"排列；最终顺序以访谈确认为准。

1. `split-storage-workspace` — 拆 `storage/workspace.ts`（基础层、纯函数、低风险，优先打底）
2. `split-agent-runtime-workspace-tools` — 拆 `agent-runtime/workspace-tools.ts`
3. `split-agent-runtime-workspace-operations` — 拆 `agent-runtime/workspace-operations.ts`
4. `split-agent-runtime-index` — 拆 `agent-runtime/index.ts`（turn 主循环，最高 churn，放后段）
5. `split-runtime-host-ai` — 拆 `runtime-host/ai.ts`（provider/能力切分，相对独立）
6. `split-views-assistant-view` — 拆 `views/AssistantView.vue`（composables + 子组件，UI 独立）

## Cross-Child Acceptance Criteria

- [ ] 6 个子任务全部归档；每个子任务各自通过 type-check + lint + 测试。
- [ ] 拆分前后运行时行为不变（对等快照/测试对照，无新增/消失的导出公共面，除非子任务 prd 明确声明迁移）。
- [ ] 父任务做最终集成评审：全仓 type-check + lint + 测试一次通过，无回归。
- [ ] 每个拆分后的原大文件要么消失（消费方已迁移），要么降为 barrel re-export 聚合层（兼容性策略见 design.md）。
- [ ] `.trellis/spec/` 中相关包/层 spec 在拆分后同步更新（模块边界约定）。

## Out of Scope

- `platform-host/frontend-inspector.ts`（1433 行 / 2 提交，稳定，不为拆而拆）。
- `config/ai.ts`（1178 行，配置/数据文件而非逻辑，收益有限）。
- `views/WorkspaceExplorerView.vue`（1361 行 / 6 提交，稳定）。
- `storage/local-assistant-files.ts`（1091 行 / 8 提交，较稳定）。
- `platform-host/index.ts`（1068 行 / 71 提交，中央 dispatcher，churn 高是角色使然；本轮仅在相关子任务中顺手抽取可独立块，不单独立项）。
- `agent-runtime/context-lifecycle.ts`（662 行 / 7 提交，曾属活跃任务 `06-26-assistant-tool-context-persistence`，待其落地后再评估）。
- 任何行为变更、性能优化、API 重新设计（本轮只做结构拆分）。

## Decided

- [Q1] **兼容性策略 = 统一 barrel re-export**：后端模块拆分后，原文件保留为薄聚合 re-export 层，消费方导入路径零改动；`AssistantView.vue` 无外部消费方，天然只做内部 composable/子组件抽取，不保留 barrel。每个子任务的公共导出面（barrel re-export 的内容）须与拆分前等价。

## Open Questions（阻塞规划，需用户决策）

- [Q2] 待定（视下一轮证据调查结果决定是否需要用户拍板）
