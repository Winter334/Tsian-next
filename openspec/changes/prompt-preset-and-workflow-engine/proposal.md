# Proposal: Prompt Preset System + AI Workflow Engine

## Why

当前 Tsian 主链在 `apps/platform-web/src/platform-host/index.ts` 的 `interaction.sendMessage` 与 `persistActiveSnapshot` 中硬编码三段式（检索 → 正文 → 维护），存在两层耦合：

1. **AI prompt 不可配置**：三个 AI 节点的 prompt 都是 TS 字符串字面量（`runtime-host/maintenance.ts` `buildMaintenancePrompt` / `runtime-host/retrieval.ts` 的拼装函数 / `runtime-host/engine.ts` 的 system prompt 直接走 retrieval.prompt），玩家与模组无法替换、模组无法复用 SillyTavern 酒馆生态。
2. **AI 链路硬编码**：链路顺序、并行、分支、写运行时时机全部写死在 `platform-host/index.ts` 里；模组想加节点（例如先做世界观分析、再分流给两个并行正文 AI、再合并维护）必须改平台代码。

本次变更的目标：

- **目标 1（阶段 G）**：引入 PromptPreset，复用 SillyTavern 酒馆 preset.json，让所有 AI 节点统一通过 preset + Lorebook + Regex 子集生成最终 prompt。复用形态：把 fast-tavern 源码（已克隆于 `F:/workspace/.tsian-research/fast-tavern/npm-fast-tavern/`，纯 TS 零运行时依赖 / 33 文件 / ~2796 行）复制进 `packages/prompt-engine`，剥离 Character Card / Group Chat / Quick Reply 子模块。
- **目标 2（阶段 H）**：引入 DAG 工作流引擎，"一轮玩家交互 = 执行一次工作流"，平台内置 5 种节点类型（`ai-call` / `result` / `switch` / `apply-patch` / `compute`），模组在 manifest 中整体替换默认工作流；维护 AI 退化为特殊 ai-call 节点；写运行时权限独占给平台 `apply-patch` 节点。
- **目标 3（阶段 I）**：扩展 `PlayFrontendBridge`，让模组前端能在不发消息的前提下做局部数据处理（装备计算、骰子检定、技能树选择等），并把结果写回运行时，让下一轮工作流通过占位符消费。**写运行时统一走 patch 应用器**——桥 API 与 `apply-patch` 节点复用同一段代码，fail loud 单点收口。**不**在本次 change 提供"前端按 nodeId / fragmentId 触发子工作流"的能力，那部分留给下一个 change。

收益：

- 模组可以用 `preset.json` 直接定制三段 AI（甚至 N 段 AI）行为，无需改平台代码
- 平台不再做 AI 输出 schema 保护，错误形态由 prompt 自身约束 + 节点级重试兜底（fail loud：重试仍失败视为 prompt 配置错误，前端抛错）
- 模组完全自由编排 AI 顺序 / 并行 / 分支，但写运行时仍只能走平台白名单的 `apply-patch`，安全性不变
- 模组前端可以用最熟悉的心智（TS / JS）实现交互式玩法，写回运行时的 patch 应用逻辑与 AI 维护节点共用同一份代码

## What Changes

新增：

- **`packages/prompt-engine`**（新包）：fast-tavern 子集的复制源码 + 剥离 Character Card 的 export 改造 + 一个面向 Tsian 的 `assemblePromptFromPreset` 高层 API
- **`packages/workflow-engine`**（新包）：DAG 工作流引擎，含节点定义 / 边定义 / 拓扑调度器 / 节点级重试 / 反应式 outputs store
- **`apps/platform-web/src/workflow-host/`**（新目录）：5 种内置节点的实现（`ai-call.ts` / `result.ts` / `switch.ts` / `apply-patch.ts` / `compute.ts`）+ 默认工作流定义（`default-workflow.ts`）+ 占位符注入器（`macro-resolver.ts`）

修改：

- `apps/platform-web/src/platform-host/index.ts`：`interaction.sendMessage` 改为"加载活动模组的工作流 → 执行 → 返回 result 节点输出"；`persistActiveSnapshot` 改为只负责 snapshot/history/checkpoint 持久化（patch 写入由 `apply-patch` 节点负责）
- `apps/platform-web/src/runtime-host/engine.ts`：移除 `sendMessageWithContext({ prompt })`，改成 `LocalRuntimeEngine` 仅暴露原子操作（`appendUserMessage` / `appendAssistantMessage` / `applyRuntimeStatePatch`），让工作流节点编排
- `apps/platform-web/src/runtime-host/retrieval.ts`：保留 `assembleRetrievalContext` 的核心评分逻辑，但拆出"拼 retrieval prompt 字符串"的部分——节点通过占位符消费 retrieval 输出
- `apps/platform-web/src/runtime-host/maintenance.ts`：硬编码的 maintenance prompt 改为内置默认 preset（迁移到 `apps/platform-web/src/workflow-host/builtin-presets/maintenance.preset.json`）
- `packages/contracts/src/runtime.ts`：扩展 `ModStaticContent` / `ModManifest`，新增 `workflow?: WorkflowDefinition` / `presets?: Record<string, PresetInfo>` / `customMacros?: Record<string, string>` 字段
- `packages/contracts/src/`：新增 `workflow.ts`（`Node` / `Edge` / `Workflow` / `NodeOutputExtractRule` 等类型契约）
- `apps/platform-web/src/runtime-host/patch-applier.ts`（新文件）：把当前 `persistActiveSnapshot` 中的 patch 应用代码（`applyArchivePatchesForSave` / `applyEventPatchForSave` / `applyRuntimeStatePatch` 串起来的部分）抽成纯函数 `applyMaintenancePatch({ patch, runtimeEngine, currentTime, archives, events, globals })`，**`apply-patch` 节点与桥 API 共用同一份**
- `packages/contracts/src/bridge.ts`：扩展 `PlayFrontendBridge.runtime`，新增 `applyPatch(patch: MaintenancePatchDocument)`、`updateGlobals(path, value)`、`appendUserMessage(content)`、`appendAssistantMessage(content)` 方法（前端写运行时入口）；老的 `interaction.sendMessage` 入口保留
- `apps/platform-web/src/bridge/play-frontend-bridge.ts`：上面新方法的实现，全部转调 `patch-applier.ts` 同一份代码

破坏性变更（原型期允许）：

- 旧的 `RuntimeMemoryContext.prompt` 入口废弃（不再有"平台拼好 prompt 灌进去"的概念）
- IndexedDB 中 mod 关联存档的某些字段如包含 `prompt` 缓存，直接清本地重建
- 灰盐镇 mod 的 `ModStaticContent` 需要补 manifest.workflow 与 manifest.presets，否则跑默认兜底工作流

## Impact

- 影响 specs：新增 `prompt-engine` / `workflow-engine` 两个 capability spec
- 影响代码：`apps/platform-web/src/platform-host/`、`apps/platform-web/src/runtime-host/`、`packages/contracts/`、`builtin/mods/grey-salt-town/`
- 不影响：游玩前端 (`builtin/play-frontends/official-default/`)、`apps/platform-server`、Dexie 表结构（除可能清缓存外）
- 不影响：检索的具体评分算法、维护 AI 的 patch JSON schema（仍然由 `MaintenancePatchDocument` + `apply-patch` 节点解析）

## Out of Scope

- 玩家级可视化工作流编排 UI（ComfyUI 风格）
- 多 preset 切换 UI
- 模组工坊 / preset 市场 / 社区分发
- 工作流局部覆盖（局部 patch / merge）
- 完整 JS 沙箱（QuickJS / Sval / SES）—— compute 节点只做超时 + try/catch
- DAG 长跨度跳跃依赖优化
- 占位符表达式求值 / 计算占位符 / 模组代码注册占位符回调
- Token 级 AI 流式（接口预留即可）
- 模组自定义"写运行时"节点（保持沙箱不变量）
- 节点输出版本化 / 历史回放 / 节点市场
- **前端按 nodeId / fragmentId 触发子工作流**（B-2 决策：拆下一个 change，不在本次范围）
- **前端临时数据袋**（C-1 决策：所有数据回流走 `globals`，不引入新命名空间）
