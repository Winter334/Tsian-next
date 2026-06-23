# Implement — 助手前端自检工具 inspect_game_frontend

## 验证命令

```bash
# 类型检查（主要门）
cd apps/platform-web && npx vue-tsc --noEmit -p tsconfig.app.json

# 构建
cd apps/platform-web && npm run build

# 手动验证（在 dev 里，见下方各阶段验证步骤）
cd apps/platform-web && npm run dev
```

## 实现阶段（有序 checklist）

### Phase A — 工具注册骨架（让工具能被发现、调用占位返回）

目标：工具出现在 assistant enabled tool 列表，调用返回占位结果。先打通注册链路，再填实现。

- [ ] A1 `packages/contracts/src/runtime.ts`：`AgentPlatformToolName`(`:234`) 加 `"inspect_frontend"`
- [ ] A2 `agent-runtime/permissions.ts`：`AGENT_PLATFORM_TOOL_NAMES`(`:7`) 加 `"inspect_frontend"`
- [ ] A3 `agent-runtime/registry.ts`：allow-set(`:45`) 加 `"inspect_frontend"`
- [ ] A4 `agent-runtime/workspace-tools.ts`：`RUNTIME_WORKSPACE_TOOL_NAMES` 加 `inspectFrontend:"inspect_frontend"`
- [ ] A5 `agent-runtime/tool-schemas.ts`：加 `inspectFrontendSchema`（参数：`send`/`actions`/`observeBetween`/`refresh`/`wait`，无 cardId）；`buildEnabledToolSchemas`(`:300`) 加 `platformToolEnabled` 门控 + push
- [ ] A6 `agent-runtime/workspace-tools.ts`：加 `normalizeInspectFrontendArguments`（手写校验，throw toolError）；加 `executeInspectFrontend`（占位：检查 `context.runInspectFrontend`，无则 throw `INSPECT_FRONTEND_UNAVAILABLE`，有则调它返回）；`executeRuntimeWorkspaceToolCall` 加 `else if` 分支（镜像 `agent_call` `:1886-1904`）
- [ ] A7 `agent-runtime/index.ts`：`AgentRuntimeCapabilities`(`:199`) 加 `runInspectFrontend?`；两处 loop(`:1557`/`:1822`) 把 `capabilities.runInspectFrontend` threading 进 context；`buildWorkspaceToolInstructions`(`:725`) 加 inspect 文本协议示例
- [ ] A8 `storage/local-assistant-files.ts`：`defaultAssistantConfig().platformTools.enabled`(`:771`) 加 `"inspect_frontend"`
- [ ] A9 验证：vue-tsc 通过；dev 起来，assistant agent 的 enabled tool 列表含 inspect_frontend；占位调用返回 INSPECT_FRONTEND_UNAVAILABLE（因为还没注入 capability）

### Phase B — inspector 工厂 + 加载复用（能加载 active 卡前端）

- [ ] B1 新文件 `platform-host/frontend-inspector.ts`：`createFrontendInspector` 工厂骨架；模块级单会话状态（`currentDispose`/隐藏容器 lazy 创建）；`InspectFrontendInput`/`InspectFrontendResult` 类型
- [ ] B2 加载逻辑：`getPlatformActiveGameCard()` → 校验 `frontend.kind==="packaged"` → `resolvePackagedFrontendUrl` → `mountRemoteIframeFrontend(隐藏容器, 专用 bridge 占位, sandbox, onBridgeReady/onLoad)`
- [ ] B3 专用 bridge `createInspectionBridge`：runtime.getRuntimeSnapshot 返回空 snapshot 占位；interaction.sendMessage 占位 throw；query 复用 base；platform.getPlatformContext 返回 active 卡信息；runAction 返回 unavailable
- [ ] B4 `assistant-chat.ts`(`:461`) 注入 `runInspectFrontend: createFrontendInspector()`
- [ ] B5 验证：assistant 调 inspect（无 send/actions）能加载 active 卡 packaged 前端到隐藏 iframe，onBridgeReady 触发；返回 ok:true + cardId/entry（结构层/诊断层先返空）

### Phase C — 采集层（结构层 + 诊断层）

- [ ] C1 诊断层注入：onBridgeReady 后 + onLoad 超时兜底，劫持 iframe contentWindow 的 onerror/unhandledrejection/console；采集 performance entries + 资源 error 事件
- [ ] C2 结构层采集：DOM 序列化裁剪（限深、跳空、截属性）；computed style 采 `:root` CSS vars + 关键容器；渲染文本提取；bridgeState
- [ ] C3 验证：对正常前端返结构层（DOM 摘要 + computed styles + 渲染文本 + bridge ready）；对白屏前端（手动改坏 app.js）返诊断层具体原因（JS error / 资源 404 / 握手 timeout）

### Phase D — 驱动回合（send，事件时间线）

- [ ] D1 `runEphemeralTurn`：`createLocalSaveFromGameCard(card)` → 组装数据（照 `index.ts:694-731`）→ 自己的 AbortController → `runAgentRuntimeTurn`（capabilities 照 `:751-827` 接全）→ 算 snapshotAfter 不 commit → `deleteLocalSave`
- [ ] D2 时间线采集：onDelta/onRoundEnd/onTool 既 push timeline 又 `emitTurnDelta/RoundEnd/Tool`（让 mount 转发给 iframe）；turn-completed push
- [ ] D3 bridge.interaction.sendMessage 接 `runEphemeralTurn`，返回 `{snapshot: snapshotAfter}`；mount 自动 postEvent turn-completed 给 iframe
- [ ] D4 验证：inspect({send:{message:"你好"}}) 跑 master 一回合，返回 timeline 含 turn-delta/turn-completed；玩家 active save/列表 UI/active 指针不变；ephemeral save 已删（listLocalSaves 不含）

### Phase E — DOM 交互（actions）+ refresh

- [ ] E1 `applyAction`：click/type/press/scroll，same-origin contentDocument.querySelector + dispatchEvent
- [ ] E2 `observeBetween`：每 action 后 await 微 tick 采 collectStructure push actionSnapshots
- [ ] E3 `refresh`：调 bridge.runtime.getRuntimeSnapshot 拉最新 snapshot，更新 structure.renderedText
- [ ] E4 验证：inspect({actions:[{type:"type",selector:"#input",text:"测试"},{type:"click",selector:"#send"}],observeBetween:true}) 返回步间状态变化；inspect({refresh:true}) 返回最新 snapshot；inspect({send:{message:"..."},actions:[...]}) 组合覆盖完整玩家流

### Phase F — 行号映射

- [ ] F1 stack source → 文件名提取（SW 虚拟路径 path 段）
- [ ] F2 文件名 → 源文件映射（`app.js`→`default-frontend-files.ts FRONTEND_APP_JS` 等），行号直接用（join 后=源行）
- [ ] F3 返回 fileLineMap
- [ ] F4 验证：对报错前端，errors[].line 能对应到源文件行

### Phase G — 复查 diff

- [ ] G1 模块级保留上次 inspect 的 structure + diagnostics.errors
- [ ] G2 diff 计算（errors 新增/消失、renderedText 变化、computedStyles 变化、domSummary 文本 diff）
- [ ] G3 返回 diff 字段
- [ ] G4 验证：连续两次 inspect，第二次结果含 diff

### Phase H — 收尾

- [ ] H1 大结果截断 + `truncated` 标志
- [ ] H2 延后项参数校验：传 `runtime:"mock"` 或 `screenshot:true` 返回 not-supported 错误（接口预留）
- [ ] H3 完整 vue-tsc + build 通过
- [ ] H4 全量 acceptance criteria 逐条验证

## 能力组装 checklist（ephemeral 回合，对照 index.ts:751-827）

runAgentRuntimeTurn 的 capabilities 必须接全，缺任一 master agent 工具调用失败：

- [ ] `callModel`：`resolveAgentModelConfig(options.agentId, providerPresetMap)` → `generateAssistantReply`
- [ ] `callModelNative`：streaming 判断 + `generateAssistantReplyNative` / `streamAssistantReplyNative`（onDelta 签名适配）
- [ ] `toolCallMode`：`resolveAgentModelConfig("master",...)?.toolCallMode ?? getBrowserAiConfig()?.toolCallMode ?? "text"`
- [ ] `runBrowserScript`：`createBrowserSkillScriptRunner({workspaceTransaction, signal, emitTrace})`
- [ ] `workspaceMutations.write/delete`：接 ephemeral workspaceTransaction，scope 校验同 index.ts
- [ ] `emitTrace`：trace.emit（可接简易 collector 或 noop）

## 风险文件 / 回退点

- **高风险**：`platform-host/frontend-inspector.ts`（新文件，全部编排逻辑）——出问题整块禁用即可
- **中风险**：`agent-runtime/index.ts`（threading capability 进两处 loop）——改错影响所有 agent 工具调用，对照现有 `runBrowserScript` threading 模式
- **低风险**：contracts/permissions/registry/local-assistant-files/tool-schemas/workspace-tools 的追加——机械追加，模式清晰
- **回退**：注释掉 `assistant-chat.ts` 的 `runInspectFrontend` 注入 + `local-assistant-files.ts` 的 platformTools.enabled 项即可禁用工具，不影响平台其他功能

## task.py start 前检查

- [ ] prd.md 有可测 acceptance criteria
- [ ] design.md 有架构 + 数据流 + 契约 + 风险
- [ ] implement.md 有有序 checklist + 验证命令 + 风险点
- [ ] 用户已审阅或批准规划产物
