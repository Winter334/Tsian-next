# 当前前端自检工具实现调研

## 目标与边界

- `inspect_frontend` 的方向文档定义其用于检查和操作玩家 `/play` 中真实 packaged frontend；玩家准备场景，工具不打开 Play、不选存档、不跨 launcher（`docs/active/assistant-frontend-inspection-direction.md:5-10`）。
- 调试 session 以 save-runtime checkpoint 为 baseline，finish 恢复 save-runtime，但保留 card-owned frontend source 和 build output（`docs/active/assistant-frontend-inspection-direction.md:29-61`, `docs/active/assistant-frontend-inspection-direction.md:120-141`）。
- 工具说明要求助手编辑 `frontend/src/**`，平台自动 rebuild/reload；build status 可通过 `frontend-build-status` query resource 读取，失败时保留旧 dist 并返回 error file/line/message（`apps/platform-web/src/storage/local-assistant-files.ts:1237-1255`）。

## 合约现状

- 入参：`operation?: "inspect" | "finish"`、`actions?`、`observeBetween?`、`autoWait?`、`wait?: "runtime-settled"`、`timeoutMs?`（`apps/platform-web/src/agent-runtime/workspace-tools-types.ts:186-193`）。
- 结构返回：`domSummary`、`computedStyles`、`renderedText`、`bridgeState`（`apps/platform-web/src/agent-runtime/workspace-tools-types.ts:195-200`）。
- 诊断返回：`errors`、`console`、`resourceFailures`、`bridgeHandshake`（`apps/platform-web/src/agent-runtime/workspace-tools-types.ts:202-207`）。
- 行为/运行返回：`activity`、`runtime`、`actionSnapshots`、`fileLineMap`、`diff`、`truncated`、`error`（`apps/platform-web/src/agent-runtime/workspace-tools-types.ts:224-260`）。
- 工具 schema 当前只公开 `runtime-settled` wait，描述为 actions 触发 bridge activity 后等待 RPC quiet 2s（`apps/platform-web/src/agent-runtime/tool-schemas.ts:148-204`）。

## 噪声/缺口证据

### resourceFailures 噪声

- diagnostics collector 会监听真实资源元素 `error` 事件并写入 `resourceFailures`（`apps/platform-web/src/platform-host/frontend-inspector-diagnostics.ts:87-108`）。
- 但同一 collector 创建时还会扫描 `performance.getEntriesByType("resource")`，将 `transferSize === 0 && decodedBodySize === 0 && duration > 0` 的条目写入 `resourceFailures`，reason 为 `Resource timing has no transferred or decoded bytes.`（`apps/platform-web/src/platform-host/frontend-inspector-diagnostics.ts:147-160`）。
- 这会把 esm.sh/CDN/cached/cross-origin timing anomaly 与真正资源加载失败混在同一 failure 数组里，最多 50 条并可能触发 `truncated`（`apps/platform-web/src/platform-host/frontend-inspector-diagnostics.ts:5-8`, `apps/platform-web/src/platform-host/frontend-inspector-diagnostics.ts:47-53`）。

### computedStyles 噪声

- `collectKeyComputedStyles` 会返回 `:root` 主题变量，包括 `--void`（`apps/platform-web/src/platform-host/frontend-inspector-dom.ts:1061-1079`）。
- 对在线调试导入流程/交互复现帮助低，应默认减少或仅在 action target/布局问题时返回关键样式。

### wait 语义混淆

- live inspect 先记录 `activityCursor`，执行 actions，再处理 `wait: "runtime-settled"`（`apps/platform-web/src/platform-host/frontend-inspector.ts:140-153`）。
- actions 存在时，`waitForBridgeActivityAfter` 等待新的 bridge activity；未触发时抛 `INSPECT_RUNTIME_NOT_TRIGGERED`，最终进入 failure result（`apps/platform-web/src/platform-host/frontend-inspector.ts:153-167`, `apps/platform-web/src/platform-host/frontend-inspector.ts:856-900`）。
- `RUNTIME_TRIGGER_TIMEOUT_MS = 5_000`，无 bridge activity 时最多等 5 秒；`DEFAULT_RUNTIME_TIMEOUT_MS = 300_000` 只用于已经触发 runtime chain 后等待 settled（`apps/platform-web/src/platform-host/frontend-inspector.ts:55-57`, `apps/platform-web/src/platform-host/frontend-inspector.ts:709-749`）。
- `runtime.quietMs` 来自 `target.mount.lastActivityAt`，表示距上次 bridge RPC activity 的静默时长，不是本次 wait 耗时（`apps/platform-web/src/platform-host/frontend-inspector.ts:774-790`; `apps/platform-web/src/bridge/remote-iframe-bridge.ts:581-599`）。

### action result 缺口

- `runInspectDomActions` 当前只在 `observeBetween` 时记录 `{ step, action, after: { domSummary, bridgeState } }`；没有 matchedCount、命中元素摘要、target 状态、DOM/bridge effect summary（`apps/platform-web/src/platform-host/frontend-inspector-dom.ts:125-174`）。
- 如果 action 成功后 wait 抛错，catch 走 `buildFailureResult`，现有 `actionSnapshots` 不会传入 failure result（`apps/platform-web/src/platform-host/frontend-inspector.ts:141-201`, `apps/platform-web/src/platform-host/frontend-inspector.ts:856-900`）。

### DOM / interactables 缺口

- `domSummary` 是自定义 accessibility-like tree，只遍历元素；generic 元素只有 id 或首个非 generic class 作为 identifier（`apps/platform-web/src/platform-host/frontend-inspector-dom.ts:888-915`）。
- 只有 heading/button/link/listitem 等 name-from-contents 标签/role 会从 textContent 生成 name；普通 clickable div/card 若无 role/aria/data，语义偏薄（`apps/platform-web/src/platform-host/frontend-inspector-dom.ts:966-1020`）。
- 当前没有单独的 interactables / selector map，Agent 需要从 domSummary/renderedText 反推 selector。

## frontendBuild 现状

- build status 是 per-card 模块级状态：`idle | building | ok | failed`，含 `lastBuiltAt` 和单个 error `{ message, file?, line? }`（`apps/platform-web/src/frontend-build/build-status.ts:9-18`）。
- `triggerFrontendRebuild` 在 `frontend/src/**` 写入后 debounce 800ms 构建；成功 set ok + reload，失败 set failed + 不 reload + 保留旧 dist（`apps/platform-web/src/frontend-build/trigger.ts:11-27`, `apps/platform-web/src/frontend-build/trigger.ts:47-58`, `apps/platform-web/src/frontend-build/trigger.ts:86-135`）。
- `platform-host` 已提供 `frontend-build-status` query resource，默认 cardId 为 active game card（`apps/platform-web/src/platform-host/index.ts:764-772`）。
- inspect 当前只在 target readiness 中拒绝 `building` 状态，没有在 result 中返回精简 build status（`apps/platform-web/src/platform-host/frontend-inspector.ts:351-367`）。

## sourceHints 现状

- 当前已有 `fileLineMap`：仅当 diagnostics errors 有 source+line 且能按文件名匹配 card frontend files 时返回 `{ source, line }[]`（`apps/platform-web/src/platform-host/frontend-inspector.ts:824-853`）。
- 方向文档提到 source hints，但当前合约没有独立 `sourceHints` 字段（`docs/active/assistant-frontend-inspection-direction.md:63-68`; `apps/platform-web/src/agent-runtime/workspace-tools-types.ts:224-260`）。
- MVP 可先保留/整合高置信来源：runtime error fileLineMap + build error path，不做 visible text/class 泛化源码搜索。

## 相关规格

- `platform-web` 目录职责：`agent-runtime` 拥有 Agent Runtime 工具/编排，`platform-host` 拥有本地平台 orchestration/bridge/checkpoint，新增职责不要堆到 `index.ts`（`.trellis/spec/platform-web/frontend/directory-structure.md:7-21`）。
- 类型安全：跨包 payload 使用 `@tsian/contracts`，不要在 platform-web 重定义共享形状；运行时边界要 normalize unknown data（`.trellis/spec/platform-web/frontend/type-safety.md:1-15`）。
- 质量：platform-web 变更需 `npm run build:web`；contract shape 变更需 `npm run build:contracts`（`.trellis/spec/platform-web/frontend/index.md:16-19`）。
- AI-facing surface 变更要避免残留噪声；不要把不该由 Agent 选择的内部机制写进 tool schema/prompt（`.trellis/spec/guides/ai-facing-content-changes.md:1-39`）。
