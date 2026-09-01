# Implement — Split platform-host index.ts (incremental, 3 seams)

## 前置确认（动手前一次性核对）

- [ ] 确认 `runtimeEngine` 无外部按名 import：`rg "runtimeEngine" apps/platform-web/src --glob "!**/platform-host/index.ts"`，期望 0 命中（勘察已验证，动手前复查）。
- [ ] 确认 `baseBridge` 无外部按名 import：同上，期望 0。
- [ ] 确认 11 个消费方 import 列表与 PRD 记录一致（复查一遍，防止本会话后有变更）。
- [ ] 确认 `npm run build --workspace platform-web` 在起点是绿的（建立基线）。

## 执行检查表（按 commit 顺序，每步一个 commit）

每一步完成后必须跑：`npm run build --workspace platform-web` 绿了才进下一步。

### Step 1 — `host-state.ts`（共享状态抽离）

- [ ] 新建 `apps/platform-web/src/platform-host/host-state.ts`，迁入 `runtimeEngine`、
      `baseBridge`、`platformHostReady`/`platformHostReadyPromise`/
      `markPlatformHostReady`/`waitForPlatformHostReady`，改为访问器导出
      (`getRuntimeEngine`/`getBaseBridge`/`isPlatformHostReady`/`markPlatformHostReady`/
      `waitForPlatformHostReady`)。
- [ ] `index.ts` 删除原 153–160、281–308 的状态/ready 定义，改为从 `./host-state` import。
      原所有 `runtimeEngine`/`baseBridge`/`markPlatformHostReady`/`waitForPlatformHostReady`
      调用点改为访问器调用（`runtimeEngine.loadSnapshot` → `getRuntimeEngine().loadSnapshot`，
      `baseBridge.runtime` → `getBaseBridge().runtime` 等）。
- [ ] `index.ts` 继续 `export { waitForPlatformHostReady } from "./host-state"`（公共 API 不变）。
- [ ] 若 `runtimeEngine` 需要保持 export：在 `index.ts` 加
      `export { getRuntimeEngine } from "./host-state"`（仅当上一步前置检查发现外部引用时）。
- [ ] **Review gate**：`npm run build` 绿。git diff 仅 `index.ts` + 新 `host-state.ts`。
      commit: `refactor(platform-host): extract host-state.ts for shared runtime/bridge/ready`

### Step 2 — `internal.ts`（过渡 helpers 载体）

- [ ] 新建 `apps/platform-web/src/platform-host/internal.ts`。
- [ ] 按 design.md 列表，把 assistant-chat / covers / workspace-ops 依赖的私有 helper
      从 `index.ts` 迁入 `internal.ts`（逐函数迁移，每个函数迁完立刻在 `index.ts` 改为
      `import { fn } from "./internal"`）。
- [ ] 注意区分：`commitAssistantWorkspaceFiles`/`updateCardContentFilesForCard` 属于
      assistant-chat 的协作函数，**不**进 internal，留到 Step 3 随 assistant-chat 一起迁。
- [ ] `index.ts` 仍 re-export 那些原本就 export 的 helper（若有）。
- [ ] **Review gate**：`npm run build` 绿。commit: `refactor(platform-host): move shared private helpers to internal.ts (transitional)`

### Step 3 — `assistant-chat.ts`（最大块）

- [ ] 新建 `apps/platform-web/src/platform-host/assistant-chat.ts`。
- [ ] 迁入 1668–2340 段：`AssistantChatInput`/`AssistantChatResult` 接口、
      `runAssistantChat`、`commitAssistantWorkspaceFiles`、`updateCardContentFilesForCard`。
- [ ] import 依赖：`./host-state`（`getRuntimeEngine`/`markPlatformHostReady`/
      `waitForPlatformHostReady`）、`./internal`（helper）、`../storage`、
      `../agent-runtime/*`、`../runtime-host/ai`、`../streaming-events`、`../debug-events`、
      `@tsian/contracts`。
- [ ] `index.ts` 删除该段，改为 `export { runAssistantChat, type AssistantChatInput, type AssistantChatResult } from "./assistant-chat"`。
- [ ] **Review gate**：`npm run build` 绿。`runAssistantChat` 调用路径无语义变化。
      commit: `refactor(platform-host): extract assistant-chat.ts (runAssistantChat + content commit)`

### Step 4 — `covers.ts`

- [ ] 新建 `apps/platform-web/src/platform-host/covers.ts`。
- [ ] 迁入 2341–2551 段：`COVER_CONTENT_PREFIX`、`coverExtensionForMediaType`、
      `bytesToBase64`、`PlatformGameCardCoverInput`、`setPlatformGameCardCover`。
- [ ] import 依赖：`../storage`、`./internal`（`actionError` 等若用到）、`@tsian/contracts`。
- [ ] `index.ts` re-export `PlatformGameCardCoverInput`、`setPlatformGameCardCover`。
- [ ] **Review gate**：`npm run build` 绿。commit: `refactor(platform-host): extract covers.ts`

### Step 5 — `workspace-ops.ts`

- [ ] 新建 `apps/platform-web/src/platform-host/workspace-ops.ts`。
- [ ] 迁入 3178–3564 段：`executeStudioWorkspaceOperation`、`executeLocalWorkspaceOperation`、
      `isTsianPath` + 9 个导出的 `*PlatformWorkspace*` 函数。
- [ ] 路径解析相关 helper（`resolveStudioWorkspacePath`/`normalizeStudioDirectoryPath`/
      `assertCompatibleStudioMove`/`normalizeWorkspaceActionRequest`/`storageFileToStudioFile`/
      `storagePathToStudioPath`）若 workspace-ops 独占则随它迁；若 assistant-chat 也用则
      留 `internal.ts`。implement 时按实际调用图判定。
- [ ] `index.ts` re-export 9 个 `*PlatformWorkspace*` 函数。
- [ ] **Review gate**：`npm run build` 绿。commit: `refactor(platform-host): extract workspace-ops.ts`

### Step 6 — `index.ts` 收尾

- [ ] 清理 `index.ts`：删除已迁出代码的残留 import、注释、空段。
- [ ] 确认 `index.ts` 主体是：host-state import + `playFrontendBridge` 装配 + re-export 块
      + 本次未拆的导出函数（留在 internal 或 index）。
- [ ] 全量 re-export 清单核对：对照 PRD 的 11 个消费方 45 符号表，逐一确认每个符号仍从
      `../platform-host` 可导入。
- [ ] **Review gate**：`npm run build` 绿。消费方 import 零变更：
      `git diff --stat -- apps/platform-web/src/views apps/platform-web/src/components apps/platform-web/src/App.vue`
      期望 0 改动。
- [ ] commit: `refactor(platform-host): slim index.ts to barrel + bridge assembly`

### Step 7 — spec 沉淀

- [ ] 新建 `.trellis/spec/guides/module-structure-guide.md`，参照
      `data-fileification-principle.md` 形态：
  - 原则：一个文件一个职责；出现互不相关的职责即拆。
  - 触发清单（可执行）：新增函数与文件主题无关 / import 覆盖 4+ 个不相关领域 /
    多个 helper 只被本文件一小段使用 / 文件里出现可按行段切分的独立职责块。
  - 反模式：按行号均分而非按接缝拆、为规避而凑行数、抽 barrel 却不拆实现。
  - 与其他指南的关系：链接 `code-reuse-thinking-guide`（复用触发抽取）、
    `data-fileification-principle`（数据文件粒度 vs 源码模块粒度）。
- [ ] 更新 `.trellis/spec/guides/index.md`：在表格 + Quick Reference 里登记新指南。
- [ ] 更新 `.trellis/spec/platform-web/frontend/directory-structure.md:21` 那条
      `platform-host/index.ts` 规则：改为"index.ts 是 barrel + 装配边界，内部实现按职责
      拆分到同目录子模块；新增职责不堆进 index.ts，直接放对应子模块或新建。"
- [ ] commit: `docs(spec): add module-structure guide, update platform-host directory rule`

## 验证命令汇总

```bash
# 每步必跑
npm run build --workspace platform-web

# Step 6 消费方零变更验证
git diff --stat -- apps/platform-web/src/views apps/platform-web/src/components apps/platform-web/src/App.vue

# 行数对比（前后）
wc -l apps/platform-web/src/platform-host/*.ts
```

## 风险点 / 回滚

- **最大风险**：`runAssistantChat`（~360 行单函数）迁移时漏带依赖或 import 路径错。
  缓解：`vue-tsc -b` 会立即报错；Step 3 单独一个 commit，失败即 revert。
- **`internal.ts` 误迁**：把不属于过渡的函数塞进去，变成新的巨石。缓解：严格按
  "被本次已拆子模块依赖"这一条筛选；implement 时逐函数核对调用图。
- **`runtimeEngine` export 漏网外部引用**：前置检查 + `vue-tsc -b` 双重保险。
- **回滚粒度**：每步独立 commit，`git revert <commit>` 即可；无数据/配置副作用。

## 后续任务（不在本次范围）

- 拆 `game-cards.ts`、`history-turns.ts`（从 `internal.ts` 继续）。
- 拆 `studio-agents.ts`、`local-assistant.ts`。
- 最终 `internal.ts` 消失，`index.ts` 进一步瘦身到 < 600 行。
- 评估是否拆 `utils.ts`（若纯函数出现跨接缝复用）。
