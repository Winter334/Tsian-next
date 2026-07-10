# 现有实现调研：可见 Play iframe 前端自检

## 1. 当前 inspector 是独立隐藏运行时

`apps/platform-web/src/platform-host/frontend-inspector.ts` 当前包含：

- 模块级隐藏 session/container 与 dispose（约 `:63-91`）；
- `InspectSessionState` 和专用 `createInspectionBridge`（约 `:93-169`）；
- active card/URL 解析和隐藏 `mountRemoteIframeFrontend`（约 `:203-283`）；
- inspector 直接驱动 ephemeral turn、订阅共享 streaming bus、手工 post `turn-completed`（约 `:284-340`, `:713-921`）；
- DOM actions、ARIA/结构、computed style、诊断和 diff（约 `:468-710`, `:960-1441`）。

可复用的是 DOM/ARIA/style/diagnostics/diff；hidden mount、inspection bridge、ephemeral turn 应整体删除。

## 2. 真实 Play iframe 的所有权

`apps/platform-web/src/views/PlayView.vue`：

- `frontendMount` 是真实挂载点（`:1-5`, `:188-205`）；
- remote mount 使用真实 `playFrontendBridge`（`:236-268`）；
- packaged mount 使用 same-origin sandbox 与真实 bridge（`:270-307`）；
- `mountActiveFrontend` 负责 replacement（`:309-360`）；
- frontend build success 的 reload event 会重挂（`:471-483`）；
- unmount 负责 dispose（`:508-528`）。

`DesktopShell.vue:309-325` 已有为 fullscreen 进行 DOM 查询的先例，但 inspector 应使用显式 registry，避免依赖桌面 DOM 结构。

桌面 app `play` 的 window id 固定为 appId（`desktop-apps.ts:174-189`, `:377-416`），同一时刻只有一个 Play window。最小化不会卸载 `PlayView`（`DesktopWindow.vue:1-69`），所以“已挂载即可检查”可实现。

## 3. Bridge 请求边界适合通用 activity

`apps/platform-web/src/bridge/remote-iframe-bridge.ts`：

- mount options/status 回调（`:59-73`）；
- mount 创建 sessionId/iframe（`:530-563`）；
- `handleRemoteRequest` 在父层统一 dispatch 所有 RPC（`:597-666`）；
- send 成功顺序当前为 bridge resolve → response → `turn-completed`（`:623-638`）；
- hello 建立 ready/session（`:668-695`）；
- mount 订阅 streaming/debug/invocation（`:698-760`）；
- disposer 清全部 listener 并移除 iframe（`:762-779`）。

因此 activity/in-flight 应属于单个 mount handle，而不是复用 `streaming-events.ts` 通用化。activity 可在 request dispatch 的同一 `try/catch/finally` 边界准确采集。

## 4. 真实回合与检查点顺序

`apps/platform-web/src/platform-host/index.ts:827-1138`：

- `interaction.sendMessage` 取得 active save/current turn，执行真实 runtime；
- 成功后 stage turn/trace/context；
- `commitSuccessfulRuntimeTurnForSave` 完成 workspace + checkpoint 提交（约 `:1095-1099`）；
- 然后 `emitTurnDebugReady` 并 resolve（`:1112-1113`）。

`remote-iframe-bridge.ts:623-638` 在 promise resolve 后才发 response/turn-completed，因此观察真实 send RPC completion 等价于主回合已经 durable。

默认前端 `useTsian.ts:155-177` 收到 turn end 后异步触发 `triggerSyncAfterTurn`。`useSyncAfterTurn.ts:35-100` 会通过真实 bridge 查询 entrypoints 并发起 `invokeAgent`，但这只是当前前端实现。inspector 不应硬编码它；“全部 bridge RPC in-flight 清零 + 2 秒静默”可以泛化覆盖连续后处理。

## 5. 检查点存储与恢复

`apps/platform-web/src/storage/checkpoints.ts`：

- thin manifest record 构建（`:40-75`）；
- 通用 create helper（`:78-93`）；
- list（`:95-100`）；
- restore 覆写状态文件、裁剪 append-only turn/trace，并删除 `turn > targetTurn` 的未来 checkpoint（`:102-185`）；当前实现不会删除同 turn 但创建时间晚于目标 checkpoint 的记录，本任务 finish 需要补上这一精确 baseline 边界；
- turn-0 manual 替换 initial（`:193-230`）；
- prune 保留 recent/sparse/manual/initial/current 并 GC（`:232-301`）。

`apps/platform-web/src/storage/saves.ts`：

- 新 save 创建 initial（`:64-114`）；
- 正式回合 commit 创建 after-turn，结束后 prune（`:119-181`）；
- invokeAgent workspace-with-checkpoint 创建 post-turn-maintenance，并删除同 turn after-turn（`:220-310`）；
- save 删除 cascade workspace/checkpoint/blob/index（`:329-340`）。

风险：只记录 baseline ID 而不保护时，普通 prune 或同 turn maintenance replacement 可能删除 baseline；turn-0 initial replacement 也需排除 protected ID。恢复到 baseline 之前会裁掉 baseline 需要的 turn 日志，因此调试期要加 restore floor。

## 6. Marker 适合 local meta

现有 active save、active card、assistant sessions、AI debug、platform config 都使用 `localDb.meta`（例如 `storage/saves.ts:26-55`、`storage/local-platform-config.ts`、`storage/assistant-conversations.ts`）。

调试 marker 是全局单值、无需索引、必须跨刷新且不随 save checkpoint 回滚，因此新增 meta key 比新增 Dexie table 更合适，也避免 DB name 与 Service Worker literal 变更。

## 7. 前端源码不会被 checkpoint 回滚

`platform-host/assistant-chat.ts:619-635` 将 `card-frontend` 直接写入 per-card frontend file table，并触发 rebuild；不走 save transaction。

`frontend-build/trigger.ts:10-22`, `:86-129` 在构建成功后 emit frontend reload，失败则保留旧 dist。

`storage/workspace.ts:403-423` 的 checkpoint/commit 过滤只持久化 save-runtime；storage spec 也明确 checkpoints 不 snapshot card-owned content。因此 finish 恢复 baseline 会丢弃测试运行时但保留 `frontend/src/**` 与 dist 修复。

## 8. 现有诊断/动作缺陷

- `applyAction` 已用 tagName 避免部分跨 realm `instanceof`，但 MouseEvent/Event/KeyboardEvent 仍从父 window 构造（`frontend-inspector.ts:545-665`）。
- diagnostics 注入不返回 disposer，匿名 listeners 和 console wrapper 会在可见 iframe 重复检查时叠加（`:1005-1099`）。
- resource error 仍使用父 realm HTMLElement/Script/Link/Image `instanceof`（`:1064-1080`）。
- `lastInspectSnapshot` 是全局单值，未按 iframe generation/save/card 隔离（`:496-535`）。
- 已加载后才注入，无法补回接管前 console/error（`:971-975`），应明确为契约限制。

## 9. 旧 AI-facing 契约位置

- 输入/结果类型：`agent-runtime/workspace-tools-types.ts:155-250`；
- normalize：`agent-runtime/workspace-tools.ts:915-1114`；
- native schema：`agent-runtime/tool-schemas.ts:148-204`；
- dispatcher：`workspace-tools.ts:2266-2280`；
- desktop assistant 注入：`platform-host/assistant-chat.ts:565-567`；
- 权限说明：`agent-runtime/tool-controls.ts`；
- 默认助手前端编辑说明：`storage/local-assistant-files.ts`；
- 当前方向文档：`docs/active/assistant-frontend-inspection-direction.md`。

用户要求完全替代，因此旧 send/refresh/runtime/screenshot/hidden/ephemeral/turn timeline 不应以 optional/deprecated 形式残留。
