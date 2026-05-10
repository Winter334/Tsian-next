# Tasks — Plan Phase Output

> 由 `/ccg:spec-plan` 阶段生成（2026-05-10），基于 `design.md §1-§14` 与 `_research-notes.md` 的 28 项研究输入。
>
> **依赖排序说明**：原骨架中 I1（抽离 `patch-applier.ts`）与 H4（实现 5 种内置节点，含 `apply-patch`）存在依赖矛盾——`apply-patch` 节点的实现必须调用 `applyMaintenancePatch`。本次重排把 **I1 提前到 H4 之前**，避免"先实现节点桩位再回头改"的二次返工。任务 ID 保留原值（G1-G5 / H1-H12 / I1-I6），便于 design / research-notes 中已有的交叉引用继续可定位；执行顺序以下表的"执行序号"为准。
>
> **格式契约**：所有任务 MUST 保持 `- [ ] X.Y description` 复选框格式，OPSX CLI 解析依赖此格式。

## 执行顺序总览

| 序 | 任务 ID | 简要描述 | 依赖 |
|----|--------|---------|------|
| 1  | G1     | 复制 fast-tavern 源到 `packages/prompt-engine/src/` | — |
| 2  | G2     | CharacterCard / GroupChat / QuickReply 语义校准（保留全部 fast-tavern API） | G1 |
| 3  | G3     | 实现 `tsian/assemble.ts` 高层 API | G2 |
| 4  | G4     | 真实 ST preset round-trip 验证 | G3 |
| 5  | G5     | `build:contracts` + `build:web` 通过 | G4 |
| 6  | H1     | `packages/contracts/src/workflow.ts` 类型契约 | G5 |
| 7  | H2     | `ModManifest` 扩展 workflow/presets/customMacros | H1 |
| 8  | **I1** | **抽离 `patch-applier.ts` → `applyMaintenancePatch`**（前置）| H2 |
| 9  | H3     | DAG 调度器 + abort + 节点级重试 | I1 |
| 10 | H4     | 5 种内置节点（apply-patch 节点直接调 I1 抽离出的 applier）| H3 |
| 11 | H5     | 3 个内置 PresetInfo（retrieval/chat/maintenance）| H4 |
| 12 | H6     | `default-workflow.ts` 兜底工作流 | H5 |
| 13 | H7     | `outputs-store.ts` shallowRef 实现（per-turn ref，§13.7）| H4 |
| 14 | H8     | 改写 platform-host：sendMessage 走工作流 | H6, H7 |
| 15 | H9     | `LocalRuntimeEngine` 收敛 + 新增 atomic 方法 | H8 |
| 16 | H10    | 灰盐镇默认工作流跑通 | H9 |
| 17 | I3     | `bridge.ts` 类型扩展 4 个 runtime 方法 | I1 |
| 18 | I4     | `play-frontend-bridge.ts` 实现 4 个方法（共用 applier）| I3 |
| 19 | I5     | 测试模组最小写运行时例子 | I4 |
| 20 | H11    | 调试面板可视化节点状态机 + 桥 API 写入轨迹 | I4 |
| 21 | H12    | 7 条 SC-CRIT 全部跑通 | I5, H11 |
| 22 | I6     | 桥 API ≡ apply-patch 节点错误一致性验收（P-I-1）| H12 |

> I2（"apply-patch 节点改为调 applyMaintenancePatch"）已合并入 H4——节点首次实现时即调用 I1 抽离的 applier，不再有"回头改"步骤。

---

## Phase G — Prompt Preset System

- [x] G1. 复制 fast-tavern 源码到 `packages/prompt-engine/src/`，按 `design.md §1.1` 表格原样保留（含 gemini channel；CharacterCard/GroupChat/QuickReply 剥离由 G2 负责）
- [x] G2. 识别 CharacterCard 为 Tsian 模组主角资源容器（worldBook+regex+`{{char}}` 宏），保留全部 fast-tavern API；GroupChat 唯一字段 `newGroupChatPrompt` 保留；QuickReply 在源码中 0 命中无需处理（design.md §1.1 已修订）
- [x] G3. 实现 `tsian/assemble.ts` 高层 API（输入 PresetInfo + macros + history，输出 ChatMessage[]）
- [x] G4. 编写 1 个真实 SillyTavern preset.json round-trip 验证（满足 P-G-2）
- [x] G5. `npm run build:contracts && npm run build:web` 通过（满足 SC-1）

## Phase H — Workflow Engine

- [ ] H1. `packages/contracts/src/workflow.ts` 定义 `WorkflowDefinition / WorkflowNode / WorkflowEdge / NodeOutputDeclaration` 等类型
- [ ] H2. 扩展 `ModManifest` 增加 `workflow / presets / customMacros` 字段；HC-13 守卫禁止 mod 注册 `apply-patch` 节点
- [ ] **I1**. 抽离 `apps/platform-web/src/runtime-host/patch-applier.ts`：把当前 `platform-host/index.ts` 中的 patch 应用代码（`applyArchivePatchesForSave` + `applyEventPatchForSave` + `applyRuntimeStatePatch`）合并为纯函数 `applyMaintenancePatch(input): Promise<ApplyPatchOutput>`，内部应用顺序固定 currentTime → globals → archives → events（design.md §13.1）。**前置位置：H4 之前**。
- [ ] H3. `packages/workflow-engine` 实现 DAG 拓扑调度器 + AbortController 传播 + 节点级重试（design.md §5）；加载期校验 6 条（design.md §13.4）
- [ ] H4. `apps/platform-web/src/workflow-host/` 实现 5 种内置节点（ai-call / result / switch / apply-patch / compute）；apply-patch 节点直接调 I1 抽离出的 `applyMaintenancePatch`，4 端口对齐 ApplyPatchOutput（§13.3）；compute 节点遵守 §10 + P-H-7/P-H-8 沙箱约束
- [ ] H5. `apps/platform-web/src/workflow-host/builtin-presets/` 编写 3 个内置 `PresetInfo`（retrieval / chat / maintenance）
- [ ] H6. `default-workflow.ts` 兜底工作流（design.md §8）
- [ ] H7. `outputs-store.ts` shallowRef 实现：per-turn 新建 ref；上轮 abort 节点不可写入下一轮 ref（§13.7）
- [ ] H8. 改写 `platform-host/index.ts`：`sendMessage` 走工作流引擎，`persistActiveSnapshot` 重命名为 `persistAfterTurn`；`state.turn++` 在 sendMessage 入口、workflow.execute 之前发生（§13.6）
- [ ] H9. `LocalRuntimeEngine` 收敛：去掉 `sendMessageWithContext`，新增 `appendUserMessage` / `appendAssistantMessage`（不递增 turn，§13.6）
- [ ] H10. 灰盐镇 mod 跑通默认工作流（验证不退化，覆盖 SC-CRIT-1/2/3）
- [ ] H11. 提供测试模组 / 在调试面板可视化节点状态机 + 桥 API 写入轨迹
- [ ] H12. 7 条 success criteria 全部跑通（见 `_research-notes.md` §2 SC-CRIT-*）

## Phase I — 前端写运行时桥 API

- [ ] I3. 扩展 `packages/contracts/src/bridge.ts`：`PlayFrontendBridge.runtime` 新增 `applyPatch / updateGlobals / appendUserMessage / appendAssistantMessage` 类型签名（设计 §12.1）
- [ ] I4. `apps/platform-web/src/bridge/play-frontend-bridge.ts`：实现上述 4 个方法，全部转调 I1 抽离出的 `applyMaintenancePatch` / runtimeEngine 原子方法；桥 API 路径传 `pushCheckpointReason: undefined`（§13.9）
- [ ] I5. 灰盐镇 / 测试模组在前端写一个最小例子（点按钮 → `updateGlobals("demo.counter", n+1)` → 下一轮工作流读到 `{{globals.demo.counter}}`）
- [ ] I6. 验收：非法 patch 在桥 API 与 `apply-patch` 节点中错误一致（P-I-1，证明两路径共用 applier；HC-14）

> **已并入 H4 / 已废弃**：原 I2「apply-patch 节点改为调 applyMaintenancePatch」——因 I1 提前，H4 实现节点时直接调 applier，无须二次改动。
