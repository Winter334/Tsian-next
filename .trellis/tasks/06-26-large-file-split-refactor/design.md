# Design — 大文件拆分重构

> 纯结构重构，不改变运行时行为。本设计适用于全部 6 个子任务；子任务各自 `design.md` 可补充文件特定的 seam 细节，但必须遵守此处的共享约定。

## 1. 拆分方法论（来自 spec，强制）

依据 `.trellis/spec/guides/module-structure-guide.md`，本重构遵循以下已验证约定（先例任务 `06-22-split-platform-host-index` 将 `platform-host/index.ts` 从 3722 行拆至 1068 行即用此法）：

1. **判定标准是职责，不是行数**：1000 行单一职责 OK，500 行混 4 域不 OK。seam 由 call graph / data flow 决定，不按行数切。
2. **一个 seam 一个 commit，每个之后 green build**。失败的 commit `git revert`，先前的 seam 保留。
3. **原文件降为 barrel re-export**：消费方导入路径零改动，内部重构对公共 API 不可见。
4. **防循环导入**：子模块需要原文件 helper 时，把 helper 抽到 shared internal module，**不要 import barrel**。`index ↔ sub-module` 循环在 ESM 能跑但脆弱、伤 tree-shaking、破坏 HMR。
5. **shared state 用 accessor 模式**：多子模块共享的 module-level state 放专门 state module + accessor（`getRuntimeEngine()`），state module 不 import 子模块 → 无环。不跨多调用点传 state 参数。

## 2. 兼容性策略（已定：统一 barrel re-export）

- 后端 5 个文件拆分后，**原文件保留为薄聚合 re-export 层**，消费方导入路径不变。
- `AssistantView.vue` 是路由组件、无外部消费方，**不保留 barrel**，直接做内部 composable + 子组件抽取。
- **公共导出面等价是硬约束**：每个 barrel re-export 的符号集必须与拆分前该文件的 public export 完全等价。子任务验收须对照确认（无新增/消失的 public export，除非子任务 prd 明确声明迁移并同步消费方）。

### spec 反模式提醒（必须规避）

- ❌ barrel 只 re-export 但实现仍留在原文件 → 文件没真正变小。
- ❌ `internal.ts` 式过渡模块无消解计划 → 过渡债永不偿还，长成新 god file。
- ❌ 函数移到子模块但 import 留在原文件 → 死 import 堆积。
- ❌ 无 green build 就连续拆多个 seam → 一次回归使整批重构失效。

## 3. 各子任务拆分边界草案

> 草案基于已知职责信号；子任务 `design.md` 阶段以 call graph 复核 seam，可调整。

### 3.1 split-storage-workspace（`storage/workspace.ts`，2284 行，31 export，6 消费方）
纯函数为主，风险最低，优先打底。按 31 个 export 的内聚域分组（路径判定 / 模板 / CRUD / 事务 / checkpoint 等），每组一个子模块，`workspace.ts` 降为 barrel。

### 3.2 split-agent-runtime-workspace-tools（`agent-runtime/workspace-tools.ts`，2461 行，3 消费方）
类型定义层与执行逻辑层混装。按"类型 schema 层 / 解析层 / 执行层"切分。注意 `lib/workspace-path.ts` 已是共享 path 核心，**勿重新复制 path 算法**（见 quality-guidelines Known Tech Debt）。

### 3.3 split-agent-runtime-workspace-operations（`agent-runtime/workspace-operations.ts`，1386 行，3 消费方）
中等。search helpers（`createPreview`/`normalizeSearchLimit`/`fileName`）是单一 live caller，**勿为单一消费者强行抽象**；除非拆分中暴露第二消费者，否则留在原内聚模块。

### 3.4 split-agent-runtime-index（`agent-runtime/index.ts`，2292 行，48 提交，49 函数，3 消费方）
turn 主循环，全场最高 churn，风险最高放后段。49 个内部函数按 turn 阶段/职责聚类。spec 将此文件列为 Source Reference，拆分须格外保守：严格一 seam 一 commit + green build。唯一跨子任务软依赖：从此文件 import `workspace-operations` 的一个 type（已在 3.3 拆分后随 barrel 保持稳定）。

### 3.5 split-runtime-host-ai（`runtime-host/ai.ts`，1605 行，1 消费方）
45 声明，按 provider / 能力切分。仅 1 消费方，barrel 兼容压力小，但仍保留 barrel 以统一策略。

### 3.6 split-views-assistant-view（`views/AssistantView.vue`，1801 行，script 993，无外部消费方）
993 行 `<script setup>` 拆为 composables（按 hook-guidelines：可复用 state + UI 协调，不藏 persistence/runtime 副作用，mutation 用显式 command）+ 子组件（用现有 `components/ui/` primitives）。screen-local state 可留 view；shared logic 移出。template 614 行可按 UI 区块拆子组件。不保留 barrel（路由组件，无外部 import）。

## 4. 数据流与契约

- **不改变任何运行时数据流**。barrel 只重定向导出，实现搬家不改逻辑。
- **contract shape 不变**：本重构不触碰 `@tsian/contracts` / `@tsian/runtime-core` 的导出形状，故无需 `build:contracts` / `build:runtime-core`（除非某子任务意外触及，届时补跑）。
- **Dexie 表 / bridge API 不变**：quality-guidelines Review Checklist 中的 snapshot shape、query resource、sendMessage rollback、Dexie 表名均不在本重构触及范围。

## 5. 验收手段（来自 quality-guidelines）

- **主验收**：`npm run build:web`（含 `vue-tsc -b` 类型检查）每个 seam 后 green。
- **导出面等价**：子任务验收时对照拆分前后 barrel 的 public export 符号集一致。
- **手动冒烟**：因仓库无自动化测试网，每子任务结束后对相关热路径做手动冒烟（assistant 对话、workspace 增删改查、AI 调用等对应文件的功能）。
- **无 lint/test 脚本**：仓库无 eslint/vitest 配置，不为本重构补建测试网（不在范围）；风险控制靠 green build + 导出面等价 + 冒烟。

## 6. 权衡

- **barrel 留过渡债**：原文件不消失，降为薄聚合层。这是 spec 认可的兼容性手段，但须确保实现真正移出（非反模式 1）。未来若有任务迁移消费方到深导入，可届时删 barrel。
- **无测试网下的重构风险**：靠 seam 粒度（小步）+ 每 seam green build + 导出面等价对照兜底。`agent-runtime/index.ts` 风险最高，故放最后且最保守。
- **不在本重构补测试**：补测试是独立决策，不在本父任务范围；若用户后续要求，另开任务。

## 7. 回滚形态

- 粒度=seam=commit，回滚单位=单 commit `git revert`。
- 子任务级别回滚=该子任务全部 commit revert（barrel 保证消费方未动，revert 不影响其他子任务）。
- 6 子任务相互独立（仅 3.4→3.3 一个 type 软依赖），任一子任务失败不阻塞其余。
