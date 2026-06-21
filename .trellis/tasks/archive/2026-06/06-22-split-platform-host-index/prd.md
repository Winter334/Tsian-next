# Split platform-host index.ts god module

## Goal

把 `apps/platform-web/src/platform-host/index.ts`（3564 行，7 个不相关职责堆在一个文件里）
按自然接缝拆分为聚焦的子模块，`index.ts` 退化为 barrel（模块状态 + `playFrontendBridge`
装配 + re-export 公共 API），并在 `.trellis/spec` 沉淀"避免超大文件"的编码约定，防止后续
开发再次堆出同类巨石。

## User Value

- 改动定位成本下降：当前任务（如 Assistant Config UI）要在 3500 行里翻找，diff 上下文
  被无关代码淹没，git blame / review 信噪比差。
- 可测试性提升：`bytesToBase64`、`slugifyGameCardIdSegment`、`coverExtensionForMediaType`、
  `resolveStudioWorkspacePath` 等纯函数拆出后可直接单测。
- 依赖关系透明化：152 行 imports 表明该模块几乎依赖 storage/agent-runtime/bridge/
  runtime-host 的全部表面；拆分后每个子模块只 import 自己真正需要的。
- 防止复发：spec 约定给未来 AI/人类开发一个可执行的拆分触发条件。

## Confirmed Facts（已勘察，非假设）

### 文件职责分布（按行段）

| 行段 | 职责 | 行数 |
|---|---|---|
| 1–152 | imports（30+ 契约类型 + 十几个内部模块） | 152 |
| 153–280 | 模块级状态 + 接口声明 | 128 |
| 281–1218 | 各类 helper：快照/历史序列化、存档/卡片解析、路径归一化、内容文件写删、平台动作执行、trace | 938 |
| 1219–1667 | `playFrontendBridge` 导出（runtime/platform/query/interaction 四组） | 449 |
| 1668–2340 | Assistant 聊天编排（`AssistantChatInput/Result` + `runAssistantChat` + 提交内容文件 + 卡片更新） | 673 |
| 2341–2551 | 封面处理（`.cover/` 前缀、扩展名映射、base64、封面写入） | 211 |
| 2552–2957 | Studio agent/skill/provider-preset 配置管理 | 406 |
| 2958–3177 | 本地 assistant 配置（`local/assistant/agent.json`、actor level） | 220 |
| 3178–3564 | Studio/本地工作区操作（`executeStudioWorkspaceOperation` 等） | 387 |

### 模块级共享状态（拆分核心约束）

- `runtimeEngine`（`LocalRuntimeEngine` 实例，export）— 被 621/627/1125/1637/1648/2136/2300/2532 行调用 `loadSnapshot`。
- `baseBridge`（`createPlayFrontendBridge(runtimeEngine)`）— 被 1230（`runtime`）、1434（`query.query` 委托）使用。
- `platformHostReady` / `platformHostReadyPromise` / `markPlatformHostReady` / `waitForPlatformHostReady` — ready 事件，被 1749（`runAssistantChat` 内）、2105（`initializePlatformHost`）使用。
- 这三个状态是跨子模块共享的，必须有一个共享 core（或留在 `index.ts`），子模块通过参数或 import 拿到引用。

### 外部消费契约（11 个文件，barrel 按名导入，公共 API 不能变）

| 消费文件 | 导入的符号 |
|---|---|
| `App.vue` | `initializePlatformHost` |
| `AssistantView.vue` | `runAssistantChat`, `getPlatformActiveGameCard`, `waitForPlatformHostReady`, `getLocalAssistantProviderPreset` |
| `AssistantConfigPanel.vue` | `getLocalAssistantConfig`, `updateLocalAssistant{Skill,PlatformTool,WorkspaceAccess,ProviderPreset}Enabled`, `type LocalAssistantConfig` |
| `StudioView.vue` | `getPlatformStudioAgentContext`, `getPlatformStudioSnapshot`, `updatePlatformStudioAgent{Skill,PlatformTool,WorkspaceAccess}Enabled`, `updatePlatformStudioAgentProviderPreset`, `waitForPlatformHostReady`, `type PlatformStudioSnapshot` |
| `GameCardDetailView.vue` | 18 个 value + `type PlatformGameCardFrontendFileSummary`（最大消费方） |
| `GameCardLibraryView.vue` | `createDefaultPlatformGameCard`, `deletePlatformGameCard`, `getPlatformActiveGameCardId`, `importPlatformGameCardPackage`, `listPlatformGameCards`, `listPlatformSaves`, `setPlatformActiveGameCard` |
| `PlayView.vue` | `getPlatformActiveGameCard`, `playFrontendBridge`, `waitForPlatformHostReady` |
| `DebugView.vue` | `playFrontendBridge`, `waitForPlatformHostReady` |
| `AppMarketView.vue` | `importPlatformGameCardPackage` |
| `WorkspaceEditorView.vue` | `listPlatformWorkspaceDirectory`, `patch/read/validate/writePlatformWorkspaceFile` |
| `WorkspaceExplorerView.vue` | `delete/list/move/searchPlatformWorkspace{Path,Directory,Roots}`, `type PlatformWorkspaceRootEntry` |

→ 拆分后 `index.ts` 必须继续 re-export 全部这些符号；消费方 import 路径不变。

### 初步识别的接缝（前期分析 + 本次勘察确认）

- `assistant-chat.ts` ← 1668–2340 + bridge 的 `interaction` 段（含 `runAssistantChat` ~360 行，最大单函数）
- `covers.ts` ← 2341–2551（封面，纯函数为主）
- `studio-agents.ts` ← 2552–2957（Studio agent/skill/provider-preset）
- `local-assistant.ts` ← 2958–3177（本地 assistant 配置）
- `studio-workspace-operations.ts` ← 3178–3564（工作区操作）
- `history-turns.ts` ← AIRP 历史回合序列化/staging（281–551 中的相关段）
- `game-cards.ts` ← 卡片元数据/ID/内容文件管理（883–1004 段 + 导出的卡片 API）
- `utils.ts` ← `bytesToBase64`/`slugify`/`normalizeContentMediaType`/`isRecord` 等纯工具
- `index.ts`（barrel）← 模块状态 + `playFrontendBridge` 装配 + re-export

### 现有 spec 现状（勘察确认）

- **无任何文件大小 / LOC / 行数约定**，无"god file"反模式条目。
- `platform-web/frontend/directory-structure.md:21` 现有规则：
  > "Keep `platform-host/index.ts` as the orchestration boundary until behavior is reused by multiple actions."
  这条规则目前在**为现在的巨石背书**（"直到被多个 action 复用才拆"）。
- 新约定最自然落点：`guides/`（横向原则），并在上述现有规则处补充。
- `guides/` 已有 `data-fileification-principle.md` 作为同形态参照（Thinking Triggers + Anti-Patterns + Relationship 小节）。

## Requirements

### R1 — 拆分（行为保持）
- `index.ts` 退化为 barrel：模块级共享状态（`runtimeEngine`/`baseBridge`/ready 机制）+
  `playFrontendBridge` 装配 + re-export 公共 API。
- 内部实现按自然接缝分散到同目录子模块文件。
- **不改变任何公共 API 签名、不改变外部 import 路径、不改变运行时行为**——纯结构调整。
- 每抽一块都要编译通过 + 既有测试/检查通过，再抽下一块。

### R2 — spec 沉淀
- 在 `guides/` 新增一个"模块结构 / 避免超大文件"的横向原则（参照
  `data-fileification-principle.md` 形态：触发条件 + 反模式 + 与其他指南的关系）。
- 更新 `platform-web/frontend/directory-structure.md:21` 那条现有规则，使其与新指南
  一致（"index.ts 仍是 barrel/orchestration 边界，但内部实现按职责拆分"）。
- spec 约定必须可执行（有触发条件，不是口号）。

### R3 — 验收
- `index.ts` 行数显著下降（目标 < 600 行，仅 barrel + 装配 + re-export）。
- 所有消费方的 import 语句不变。
- type-check / lint / build 全绿。
- spec 新约定写入并能在 `guides/index.md` 索引里看到。

## Acceptance Criteria

- [ ] `apps/platform-web/src/platform-host/index.ts` 仅含模块状态、`playFrontendBridge`
      装配、re-export；行数 < 600。
- [ ] 拆出的子模块每个职责单一、只 import 自己需要的依赖。
- [ ] 11 个消费文件的 import 路径与符号名零变更（git diff 验证）。
- [ ] `npm run build --workspace platform-web` 通过（= `vue-tsc -b && vite build`，
      项目无独立 typecheck/lint 脚本，此命令是类型+构建的统一检查）。
- [ ] `.trellis/spec/guides/` 新增模块结构原则文件，并登记进 `guides/index.md`。
- [ ] `platform-web/frontend/directory-structure.md` 现有 `platform-host/index.ts` 规则
      已更新为与新指南一致。

## Out of Scope

- 不改变任何公共 API 语义、不重构业务逻辑、不做性能优化。
- 不拆 `agent-runtime/`、`storage/` 等其他目录（本次只处理 `platform-host/index.ts`）。
- 不引入新依赖、不改构建配置。
- 不在本任务里拆 `playFrontendBridge` 对象本身的方法（它留在 `index.ts` 作为装配；其
  方法体调用的实现已随各接缝迁入子模块）。

## Decisions（已拍板）

- **范围（渐进）**：本次抽 3 个接缝——`assistant-chat`、`covers`、`studio-workspace-operations`。
  其余 4 个（`studio-agents`、`local-assistant`、`history-turns`、`game-cards`）作为后续独立任务。
- **spec 阈值（定性为主）**：新指南写"一个文件一个职责；出现互不相关的职责即拆"，
  配可执行触发清单（新增函数与文件主题无关 / import 覆盖 4+ 个不相关领域 / 多个 helper
  只被本文件一小段使用）。不设硬性行数。
- **共享状态（抽 `host-state.ts`）**：新增 `platform-host/host-state.ts`，持有
  `runtimeEngine`/`baseBridge`/ready 机制，导出访问器 `getRuntimeEngine()`/
  `getBaseBridge()`/`markPlatformHostReady()`/`waitForPlatformHostReady()`。子模块
  import 访问器；`index.ts` 也 import 它装配 `playFrontendBridge`。无循环依赖。

## Open Questions

无。三个决策点已全部拍板，可进入 design + implement。
