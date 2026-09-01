# 固定注入层 role 可配置

## Goal

让 agent.json 能配置平台固定注入层的消息 role，使不同 agent/预设能差异化框架信息的权威层级。原预设（SillyTavern）把历史摘要、元信息、工具记忆、回合号等框架内容放在 system role，降低 user 指令权威性以实现越狱效果。Tsian 虽不伪装用户输入，但允许这些层的 role 可配，让 agent 能按需调整。

## Background

当前 `index.ts` 的消息序列骨架有 5 个固定注入层，role 硬编码：

| 层 | 默认 role | 内容 |
|---|---|---|
| systemPrompt | system | guard + AGENT.md + SOUL.md + 工具说明 |
| historySummary | user | 早期剧情/任务摘要 |
| workspaceContextMeta | user | Agent 上下文元信息（contextPaths 索引、skill 索引等） |
| toolMemory | user | 工具记忆日志（task-mode 助手） |
| turnRuntime | user | 当前回合号 |

`locateHistorySpan`（index.ts:320-375）用 **role + content-prefix 双重匹配** 找历史段边界 `[start, end)`，用于上下文压缩。改 role 会导致边界识别失败 → 压缩静默禁用。

## Requirements

### R1：四个固定层的 role 可配

- `historySummary`、`workspaceContextMeta`、`toolMemory`、`turnRuntime` 四个层的 role 可在 agent.json 中配置
- `systemPrompt` 的 role 固定 system，不可配（API 兼容性 + 语义正确性）
- 不支持禁用任何固定层（所有层始终注入）

### R2：locateHistorySpan 重构为层标记识别

- 给固定层消息加 `<!-- tsian-layer: xxx -->` 前缀（类似现有 `<!-- source: -->` 模式）
- locateHistorySpan 改为按层标记前缀找边界，不依赖 role
- start：跳过 index 0（systemPrompt）和 `<!-- source:` 前缀消息（before-history 注入），第一条无层标记的消息 = history 起点
- end：从 start+1 扫描，第一条以 `<!-- tsian-layer:` 开头的消息 = history 终点
- 兜底/delegated 检测：纯 content 匹配，去掉 role 检查

### R3：发送前剥离内部标记

- 新增 `stripInternalMarkers` 函数，在 `mergeConsecutiveRoleMessages` 之后、API 调用之前执行
- 剥离 `<!-- tsian-layer: xxx -->` 和 `<!-- source: xxx -->` 前缀
- 模型看到的是干净内容，无内部标记噪声
- locateHistorySpan / replaceHistorySpan 在未剥离的原始数组上操作，不受影响

### R4：agent.json 配置结构

新增 `messageLayers` 字段，可选，不写则全部默认行为：

```json
{
  "messageLayers": {
    "historySummary": { "role": "system" },
    "workspaceContextMeta": { "role": "system" },
    "toolMemory": { "role": "system" },
    "turnRuntime": { "role": "system" }
  }
}
```

- 不写 `messageLayers` → 全部默认 role，行为与当前完全一致
- 只写部分层 → 未写的层保持默认 role
- `systemPrompt` 层不在配置范围内（固定 system）

### R5：delegated agent 路径同步改造

- `buildDelegatedAgentMessages` 的对应固定层同样支持 role 配置
- delegated 特有层（调用方信息、最近对话窗口、调用请求）不在配置范围内

### R6：验证

- `validateAgentConfig` 中验证 `messageLayers` 结构：每个子项的 `role` 是合法值（system/user/assistant）
- 非法值 → 警告（非阻断）

## Acceptance Criteria

- [ ] agent.json `messageLayers` 字段可配置 4 个固定层的 role
- [ ] 不写 `messageLayers` 的现有 agent 消息序列与当前完全一致
- [ ] `<!-- tsian-layer: -->` 前缀不出现在发送给模型的消息内容中
- [ ] `<!-- source: -->` 前缀不出现在发送给模型的消息内容中
- [ ] locateHistorySpan 在 role 可配时仍能正确找到历史段边界
- [ ] 上下文压缩（narrative/task）在 role 配置改变后仍正常工作
- [ ] delegated agent 路径正确支持 role 配置
- [ ] mergeConsecutiveRoleMessages 在剥离后仍正确合并连续同 role 消息

## Out of Scope

- 不支持禁用固定层（enabled: false）
- systemPrompt 的 role 不可配
- 不调整固定层顺序
- 不拆分 systemPrompt 内部（guard/AGENT.md/工具说明作为整体）
- 不配置 delegated 特有层（调用方信息/调用请求）
- 不改前端 InjectionMessage 机制
