# Implement：固定注入层 role 可配置

## 执行清单

### 1. contracts 类型（packages/contracts/src/runtime.ts）
- [ ] 新增 `MessageLayerConfig` 接口（`role?: "system" | "user" | "assistant"`）
- [ ] 新增 `MessageLayersConfig` 接口（4 个可选字段：historySummary / workspaceContextMeta / toolMemory / turnRuntime）
- [ ] `AgentConfig` 加 `messageLayers?: MessageLayersConfig`
- [ ] `AgentRegistryEntry` 加 `messageLayers: MessageLayersConfig`（非可选，解析后默认空对象）

### 2. registry 解析（apps/platform-web/src/agent-runtime/registry.ts）
- [ ] `buildAgentRegistryEntry` 中解析 `config.messageLayers`，默认 `{}`
- [ ] 验证命令：`npx vue-tsc -b --noEmit`（类型检查）

### 3. 层标记常量（apps/platform-web/src/agent-runtime/index.ts）
- [ ] 新增层标记常量：`WORKSPACE_CONTEXT_META_TAG` / `TOOL_MEMORY_TAG` / `TURN_RUNTIME_TAG` / `PLAYER_INPUT_TAG`
- [ ] 新增 `LAYER_PREFIX = "<!-- tsian-layer:"` 常量

### 4. locateHistorySpan 重构（index.ts:320-375）
- [ ] start：去掉 `messages[0].role !== "system"` 检查，改为 `messages.length <= 1` 检查
- [ ] start：兜底检测去掉 `role === "user"` 条件，纯 content 匹配
- [ ] end：去掉 `role === "user"` 条件和 5 个内容锚点前缀列表，改为扫描 `text.startsWith(LAYER_PREFIX)`
- [ ] 验证：无 messageLayers 配置时行为等价

### 5. stripInternalMarkers 函数（index.ts）
- [ ] 新增 `stripInternalMarkers(messages)`：剥离消息开头的 `<!-- tsian-layer: -->` 和 `<!-- source: -->` 前缀
- [ ] 只处理 string content，不处理 ContentPart[]

### 6. buildAgentContextMessages 改造（index.ts:273-292）
- [ ] 加 `historySummaryRole?` 参数
- [ ] summary 消息用 `historySummaryRole ?? "user"`
- [ ] 空占位用 `historySummaryRole ?? "user"`
- [ ] recentTurns 保持原始 entry.role，不改

### 7. buildAgentContextMessages_split 改造（index.ts:779-790）
- [ ] 加 `metaRole?` 参数
- [ ] meta 消息加 `WORKSPACE_CONTEXT_META_TAG` 前缀
- [ ] meta 消息用 `metaRole ?? "user"`

### 8. buildEntryAgentMessages 改造（index.ts:906-997）
- [ ] 读取 `context.agent.messageLayers`
- [ ] historyMessages 传 `historySummaryRole`
- [ ] workspace-context split 传 `metaRole`
- [ ] toolMemory 消息加 `TOOL_MEMORY_TAG` 前缀 + 用 `toolMemoryRole`
- [ ] turnRuntime 消息加 `TURN_RUNTIME_TAG` 前缀 + 用 `turnRuntimeRole`
- [ ] playerInput 消息加 `PLAYER_INPUT_TAG` 前缀

### 9. buildDelegatedAgentMessages 改造（index.ts:1094-1176）
- [ ] 从 `targetContext.agent.messageLayers` 读取配置
- [ ] 对应固定层加前缀 + 用配置 role
- [ ] delegated 特有层（调用方信息/调用请求）加 `PLAYER_INPUT_TAG` 到 playerInput

### 10. 压缩重建路径适配
- [ ] native 路径 L1611：`buildAgentContextMessages` 传 `historySummaryRole`
- [ ] text 路径 L2012：同上
- [ ] 确认 `replaceHistorySpan` 后新消息无需手动加前缀（history 段无前缀）

### 11. stripInternalMarkers 调用点
- [ ] native 路径：`mergeConsecutiveRoleMessages` 之后（L1653 附近）加 `stripInternalMarkers`
- [ ] text 路径：`mergeConsecutiveRoleMessages` 之后（L2057 附近）加 `stripInternalMarkers`

### 12. 验证（local-assistant-files.ts）
- [ ] `validateAgentConfig` 中验证 `messageLayers` 结构
- [ ] 每个子项的 `role` 是合法值，非法 → 警告

### 13. 类型检查 + 构建验证
- [ ] `npx vue-tsc -b --noEmit`（类型检查通过）
- [ ] `npm run build`（构建通过，如有）

## 验证命令

```bash
cd apps/platform-web && npx vue-tsc -b --noEmit
```

## 回滚点

- contracts 类型变更是纯新增（可选字段），不影响现有代码
- registry 解析默认 `{}`，不影响现有 agent
- locateHistorySpan 重构是核心改动——如果出问题，回滚此函数即可恢复 role+content 双重匹配
- stripInternalMarkers 是新增函数，移除调用即可回滚
