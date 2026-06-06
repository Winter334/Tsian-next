# @tsian/contracts — 模块 CLAUDE.md

[根目录](../../CLAUDE.md) > [packages](../) > **contracts**

---

## 1. 模块职责

跨包共享的 TypeScript 类型契约。无运行时代码，只导出类型。

包名：`@tsian/contracts`，workspace 私有，构建产物在 `dist/`。

---

## 2. 入口与启动

| 入口 | 路径 |
|------|------|
| 包入口 | `src/index.ts` → 重导出 `bridge` / `debug` / `frontend-package` / `mod` / `runtime` / `workflow` |
| 构建命令 | `npm run build:contracts`（执行 `tsc -p tsconfig.json`） |

---

## 3. 对外接口（按子模块）

### 3.1 `runtime.ts` —— 运行时核心契约

- `ConversationMessageRecord`（`role` / `content`）
- `JsonValue`、`RuntimeGlobalsMap`
- `RuntimeStateShell`（`turn` / `messages` / `currentTime?` / `globals?`）
- `RuntimeSnapshotShell`（`version` / `state`）
- `EventRecord`（`time` / `status` / `entityTags` / `entityArchiveIds?` / `content`）
- `ArchiveBaseType`（`character` / `location` / `item` / `organization` / `other`）
- `ArchiveType` (string)、`ArchivePresence`（`foreground / background / retired`）
- `ArchiveRecord`（扁平 + 任意扩展字段）
- `EventPatchItem`、`ArchivePatchItem`、`MaintenancePatchDocument`
- `ApplyPatchOutput`（I3 升级到 contracts 作为公共类型）：`appliedArchives: string[]` / `appliedEventIds: string[]` / `globalsChanged: boolean` / `currentTimeChanged: boolean`；桥/API patch 兼容写入口对齐此类型
- `MessageInteractionRequest/Result`
- `DeepQueryRequest/Result<T>`
- `PlatformContextShell`、`PlatformActionRequest/Result`、`PlatformActionError`
- `RuntimeWriteRequest/Result`、`RuntimeWriteEventInput`、`RuntimeWriteArchiveInput`

### 3.2 `bridge.ts` —— 游玩前端桥契约

- `RuntimeBridge`：`getRuntimeSnapshot` + I3 新增 4 个写方法：
  - `applyPatch(patch: MaintenancePatchDocument): Promise<ApplyPatchOutput>` — 走 applier（HC-14 patch 路径）
  - `updateGlobals(path: string, value: unknown): Promise<void>` — dot-path 嵌套对象，转 maintenance patch 走 applier
  - `appendUserMessage(content: string): Promise<void>` — append 例外，直调 engine 同步方法（HC-14 append 例外，不递增 turn，§13.6）
  - `appendAssistantMessage(content: string): Promise<void>` — 同上
- `InteractionBridge` (`sendMessage`)
- `QueryBridge` (`query<T>`)
- `PlatformBridge` (`getPlatformContext`, `runAction`)
- `DebugBridge`（B1 新增）：`subscribeWorkflow(cb)` / `getRetrievalDebug()` / `getAiDebugRecords()` / `onTurnDebugReady(cb)`
- `PlayFrontendBridge` 聚合体（B1 起新增可选 `debug?: DebugBridge`；平台壳在 `platform-host` 中注入，基础桥不实现）

### 3.3 `mod.ts` —— 模组静态内容契约

- `ModManifest`、`ModFrontendConfig`
- `EntityFieldDefinition`、`EntityTypeDefinition`
- `CatalogEventTrigger`、`CatalogEventRecord`
- `ModStaticContent`（manifest / frontendConfig / entityTypeDefinitions / archiveCatalog / eventCatalog / globalsDefaults）
- `ModInitialSavePayload`（snapshot / events / archives）

### 3.6 `debug.ts` —— 调试类型契约（B1 抽离）

把 `apps/platform-web` 内的本地调试类型迁到 contracts，方便游玩前端通过 `bridge.debug` 类型对齐。

- `AiDebugRecord`（含 `usage?: { input?, output?, total? }` + `turn?` —— B3 token usage 字段）
- `RetrievalDebugRecord` / `RetrievalCandidateDebugRecord` / `RetrievalArchiveDebugRecord` / `RetrievalCatalogEventDebugRecord` / `RetrievalSemanticDebugRecord`
- `WorkflowOutputsSnapshot` / `WorkflowNodeOutputs` / `WorkflowNodeStatus`
- `BridgeDebugTurnContext`
- 共 11 个类型

### 3.5 `workflow.ts` —— 工作流类型契约

H4-H7 阶段引入，定义工作流 DAG 的所有类型：

- `WorkflowDefinition`、`WorkflowNode`、`WorkflowEdge`
- `WorkflowNodeType`（`ai-call` / `result` / `switch` / `compute` / `state-query` / `state-write` / `template-compose` / `record-filter` / `record-merge` / `record-format`）
- `AiCallNodeConfig`、`ResultNodeConfig`、`SwitchNodeConfig`、`ComputeNodeConfig`、`StateQueryNodeConfig`、`StateWriteNodeConfig`、`TemplateComposeNodeConfig`、`RecordFilterNodeConfig`、`RecordMergeNodeConfig`、`RecordFormatNodeConfig`
- `NodeOutputDeclaration`、`NodeOutputExtractRule`

---

### 3.4 `frontend-package.ts` —— 前端包清单

- `PlayFrontendManifest`（`id` / `name` / `version` / `entry` / `runtimeVersion` / `author?` / `description?` / `icon?`）

---

## 4. 关键依赖与配置

- 无运行时依赖
- 配置：`tsconfig.json`（产物到 `dist/`，开启声明文件）

---

## 5. 数据模型

**契约自身即数据模型**。所有持久化与运行时状态都以这里定义的类型为准。

特别关注：
- `MaintenancePatchDocument` 是维护 AI 输出的标准形态（`currentTime / globals / events / archives`）
- `archives` 字段集合允许扩展（保持扁平），AI 只看最终 `type` 与字段
- `entityTags` / `linkedNames` 是名称弱引用；`entityArchiveIds` / `linkedArchiveIds` 是强引用 ID

---

## 6. 测试与质量

无单元测试。质量门槛 = `npm run build:contracts` 必须通过。

---

## 7. 常见问题 (FAQ)

**Q：为什么 `ArchiveType = string` 而不是联合类型？**
A：原型期允许模组自定义类型（character/location 之外还有 monster / equipment / consumable / material / clue 等），共享父类字段由消费方决定。

**Q：为什么 patch 文档没有 `del` 动作？**
A：见 `docs/active/patch-contract-skeleton.md` —— 当前刻意不引入删除语义。

---

## 8. 相关文件清单

- `src/index.ts`、`src/runtime.ts`、`src/bridge.ts`、`src/debug.ts`、`src/mod.ts`、`src/frontend-package.ts`、`src/workflow.ts`
- `package.json`、`tsconfig.json`
- 构建产物 `dist/*.d.ts`（不手工维护）

---

## 9. 变更记录 (Changelog)

| 时间 | 变更 |
|------|------|
| 2026-05-05 17:52:53 | 初始化架构师首次生成模块文档 |
| 2026-05-11 | I3：`RuntimeBridge` 新增 4 个写方法（applyPatch / updateGlobals / appendUserMessage / appendAssistantMessage）；`ApplyPatchOutput` 升级到 `runtime.ts` 作为公共类型（HC-14 收口） |
| 2026-05-14 | B1：抽离调试类型契约 `debug.ts`（11 个类型，`AiDebugRecord` / `RetrievalDebugRecord` / `WorkflowOutputsSnapshot` 等）；`bridge.ts` 新增 `DebugBridge` 接口与 `PlayFrontendBridge.debug?` 可选字段 |

---

_文档生成时间：2026-05-05 17:52:53_
