# Design — Split platform-host index.ts (incremental, 3 seams)

## 架构总览

`platform-host/` 目录从单文件巨石演化为多模块，`index.ts` 降为 barrel + 装配层。
本次只拆 3 个接缝，引入 1 个共享状态模块 + 1 个过渡 helpers 模块，解决渐进拆分期间的
跨模块私有依赖与循环 import 问题。

### 拆分后的目录形态（本次终态）

```
platform-host/
  host-state.ts        ← 新增：runtimeEngine / baseBridge / ready 机制单例访问器
  internal.ts          ← 新增：过渡载体，承载本次未拆接缝的、被已拆子模块依赖的私有 helper
  assistant-chat.ts    ← 新增：1668–2340 段 + runAssistantChat
  covers.ts            ← 新增：2341–2551 段
  workspace-ops.ts     ← 新增：3178–3564 段（executeStudioWorkspaceOperation 等）
  index.ts             ← 瘦身：host-state 装配 playFrontendBridge + re-export 公共 API
  browser-skill-script-executor.ts  ← 不动
```

后续任务会从 `internal.ts` 继续拆出 `game-cards.ts`/`history-turns.ts`/`studio-agents.ts`/
`local-assistant.ts`，最终 `internal.ts` 消失。本次不为那个终态做任何提前拆分。

## 模块契约

### host-state.ts（新增）

单一源持有三个跨子模块共享状态，导出访问器。不 import 任何子模块 → 无循环。

```ts
import { LocalRuntimeEngine } from "../runtime-host"
import { createPlayFrontendBridge } from "../bridge"
import type { PlayFrontendBridge } from "@tsian/contracts"

const runtimeEngine = new LocalRuntimeEngine()
const baseBridge = createPlayFrontendBridge(runtimeEngine)
let ready = false
let resolveReady: (() => void) | null = null
const readyPromise = new Promise<void>((r) => { resolveReady = r })

export function getRuntimeEngine(): LocalRuntimeEngine { return runtimeEngine }
export function getBaseBridge(): PlayFrontendBridge { return baseBridge }
export function isPlatformHostReady(): boolean { return ready }
export function markPlatformHostReady(): void { /* 幂等 */ }
export async function waitForPlatformHostReady(): Promise<void> { /* 同现有 */ }
```

- `runtimeEngine` 不再从 `index.ts` export（breaking? 见"兼容性"段：无外部按名 import 它）。
- `waitForPlatformHostReady` 仍由 `index.ts` re-export，公共 API 不变。

### internal.ts（新增 · 过渡载体）

承载本次未拆接缝里、被本次已拆子模块依赖的**私有** helper。判断标准：函数当前在
`index.ts` 内、非 export、且被 assistant-chat / covers / workspace-ops 调用。

迁入候选（最终清单在 implement 阶段逐个确认）：
- `normalizeMessageContent`、`actionError`、`workspaceActionError`、`isRecord`、
  `cloneSnapshot`、`snapshotWithTurnAndMessages`（通用 helper）
- `syncActiveGameCardFromSave`、`restoreActiveSnapshotFromStorage`、
  `listEffectiveWorkspaceFilesForActiveSave`、`ensureActiveGameCardId`、
  `ensureActiveSave`、`activeSaveExists`、`gameCardForSave`、`gameCardForSaveId`
  （save/card 编排 helper，本次不单独拆 game-cards）
- `nextAssistantTurnNumber`、`readAssistantContextFromFiles`、
  `stageAssistantContextFile`、`readAgentContextFromWorkspace`、
  `stageAgentContextFile`、`stageRawAirpHistoryTurnFile`、
  `serializeRawAirpHistoryTurnRecord`、`formatRawAirpHistoryTurnPath`
  （context/history staging，本次不单独拆 history-turns）
- `executeWorkspaceOperationForActiveSave`、`executePlatformAction`、
  `writeRuntimeTraceFileForSave`、`stageRuntimeTraceFile`
  （workspace/platform action，部分被 workspace-ops 依赖）

`index.ts` 和三个新子模块都从 `./internal` import 这些函数。`internal.ts` 只 import
`host-state`、`../storage`、`../agent-runtime/*`、`@tsian/contracts`——不 import
`./index` 或其他子模块 → 无循环。

### assistant-chat.ts（新增）

- 迁入：`AssistantChatInput`、`AssistantChatResult` 接口 + `runAssistantChat` 函数 +
  `commitAssistantWorkspaceFiles`、`updateCardContentFilesForCard`（这两个是
  runAssistantChat 的私有协作函数，随之一并迁入）。
- 依赖：从 `./host-state` 拿 `getRuntimeEngine`/`markPlatformHostReady`/
  `waitForPlatformHostReady`；从 `./internal` 拿上述 helper；从 `../storage`、
  `../agent-runtime/*`、`../runtime-host/ai`、`../streaming-events`、`../debug-events`
  直接 import。
- 导出：`runAssistantChat`、`AssistantChatInput`、`AssistantChatResult`，由 `index.ts`
  re-export。

### covers.ts（新增）

- 迁入：`COVER_CONTENT_PREFIX`、`coverExtensionForMediaType`、`bytesToBase64`、
  `PlatformGameCardCoverInput`、`setPlatformGameCardCover` 及相关段（2341–2551）。
- 依赖：从 `../storage` 拿卡片/内容文件 API；从 `./internal` 拿 `actionError` 等若有。
- 导出：`PlatformGameCardCoverInput`、`setPlatformGameCardCover`，由 `index.ts` re-export。
- 纯函数（`bytesToBase64`、`coverExtensionForMediaType`）随封面接缝一起走，不单独再拆
  utils（本次范围控制）。

### workspace-ops.ts（新增）

- 迁入：`executeStudioWorkspaceOperation`、`executeLocalWorkspaceOperation`、
  `isTsianPath`、以及导出的 `listPlatformWorkspaceDirectory`/
  `listPlatformWorkspaceRoots`/`searchPlatformWorkspace`/`readPlatformWorkspaceFile`/
  `writePlatformWorkspaceFile`/`patchPlatformWorkspaceFile`/
  `deletePlatformWorkspacePath`/`movePlatformWorkspacePath`/
  `validatePlatformWorkspaceFile`（3178–3564 段 + 末尾导出函数）。
- 依赖：从 `./internal` 拿 `resolveStudioWorkspacePath`/`normalizeStudioDirectoryPath`/
  `assertCompatibleStudioMove` 等（这些迁入 internal，因为 workspace-ops 和 assistant-chat
  可能都用到路径解析）；从 `../storage` 直接 import。
- 导出：上述 9 个 `*PlatformWorkspace*` 函数，由 `index.ts` re-export。

### index.ts（瘦身）

最终内容：
1. 从 `./host-state` import 并 re-export `waitForPlatformHostReady`。
2. 从 `./host-state` 拿 `getBaseBridge`，装配 `playFrontendBridge`（1219–1667 段保留，
   但其方法体调用的实现已迁入子模块，这里变成薄委托）。
3. 从 `./assistant-chat`、`./covers`、`./workspace-ops`、`./internal` re-export 全部
   公共 API（覆盖 11 个消费方依赖的 45 个符号）。
4. 保留 `initializePlatformHost`、`listPlatformSaves` 等本次未拆的导出函数（它们留在
   `internal.ts` 或暂留 `index.ts`，视 implement 阶段确认）。

预估行数：装配 `playFrontendBridge` ~200 行 + re-export ~80 行 + 未拆导出 ~400 行 ≈
600–700 行。本次不追求 <600（那是全部 7 接缝拆完的终态），目标是显著下降且结构清晰。

## 数据流 / 调用关系

```
消费方 (11 个 Vue 文件)
    │  import { ... } from "../platform-host"   ← 路径不变
    ▼
index.ts (barrel + playFrontendBridge 装配)
    │  import from
    ├── host-state.ts        (runtimeEngine / baseBridge / ready)
    ├── assistant-chat.ts    (runAssistantChat 等)
    ├── covers.ts            (setPlatformGameCardCover 等)
    ├── workspace-ops.ts     (listPlatformWorkspace* 等)
    └── internal.ts          (未拆 helper，过渡)
            │
            └── import from ../storage, ../agent-runtime/*, @tsian/contracts
```

无循环：`host-state` ← `internal` ← 子模块 ← `index`，单向。子模块不 import `index`。

## 兼容性 / 迁移

- **公共 API 零变更**：11 个消费方的 import 路径与符号名不变。`index.ts` re-export
  全部原有导出。
- **`runtimeEngine` export**：它目前是 `export const`，但勘察确认无外部按名 import。
  改为 `host-state` 私有 + 访问器后，理论上无 breaking。implement 阶段用
  `vue-tsc -b` 验证；若发现外部引用（漏网），从 `index.ts` re-export 一个 getter 兜底。
- **行为零变更**：纯移动，不改函数体、不改调用顺序、不改错误处理。
- **不引入新依赖、不改构建配置、不改 tsconfig paths**。

## 关键权衡

1. **`internal.ts` 是过渡债务**：它不是终态，是让渐进拆分不产生循环 import 的桥。本次
   明确接受这笔债，后续任务偿还。比"一次性全拆"风险低，比"状态留 index.ts + 子模块
   import index"（循环）健康。
2. **`playFrontendBridge` 装配留在 `index.ts`**：它 449 行，是 API 表面而非可拆职责。
   其方法体调用的实现已迁入子模块，装配层变薄委托。全部 7 接缝拆完后它仍是 index 的
   主体，这是合理的——它是 barrel 的"装配"职责。
3. **纯函数（bytesToBase64 等）随接缝走，不单独建 utils.ts**：避免本次范围膨胀。
   后续若出现跨接缝复用，再拆 utils。

## 回滚

- 每个接缝一个 commit（host-state → internal → assistant-chat → covers → workspace-ops
  → index 瘦身 → spec）。
- 任一 commit 后 `vue-tsc -b && vite build` 失败 → `git revert` 该 commit 即可，不影响
  前序已绿 commit。
- 最坏情况全部回滚：`git revert` 到任务起点，无数据/配置副作用。

## 验证命令

```bash
# 唯一可用的类型+构建检查（platform-web 无独立 typecheck/lint 脚本）
npm run build --workspace platform-web   # = vue-tsc -b && vite build
# 消费方 import 零变更验证
git diff --stat -- apps/platform-web/src/views apps/platform-web/src/components apps/platform-web/src/App.vue
# 期望：这些路径无 diff（或仅 Re-export 侧改动）
```
