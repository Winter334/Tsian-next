# Claude 自动提示词缓存

## Goal

让使用 Claude 协议的模型默认启用 Anthropic 顶层自动提示词缓存，以复用多轮对话中的稳定前缀、降低重复输入成本与延迟；当第三方 Claude 兼容接口不支持该字段时，用户可以按模型关闭。

## Background

- 任务开始时 Claude adapter 会发送 Anthropic Messages API 请求，但不会发送任何 `cache_control`。因此既有稳定消息排序只对会自动做前缀缓存的 provider 生效，Claude 默认不会创建提示词缓存。
- 当前运行时已提取 Claude 返回的 `usage.cache_read_input_tokens` 与 `usage.cache_creation_input_tokens`，诊断界面具备展示真实缓存数据的能力，但请求侧尚未启用缓存。
- 归档任务 `06-30-workspace-context-cache-split` 曾明确把 Claude `cache_control` 留作后续 provider-specific 适配。
- 当前 Anthropic API 支持在请求顶层添加 `cache_control: { "type": "ephemeral" }` 来启用自动缓存，适合随历史增长的多轮对话；显式 content-block 断点只在需要精确控制不同内容段时才有必要。

## Requirements

### R1 — 模型级开关与默认行为

- `BrowserClaudeModelParameters` 增加模型级提示词缓存开关。
- 新建 Claude 模型默认开启。
- 已有存储配置缺少该字段时按开启归一化；显式关闭必须跨保存、读取和克隆保持关闭。
- 该字段只影响 `kind === "claude"`，不得改变其它 provider 请求。

### R2 — 请求行为

- 开启时，Claude 请求顶层发送 `cache_control: { "type": "ephemeral" }`。
- 关闭时，平台不主动添加顶层 `cache_control`。
- 普通文本、原生工具调用、非流式和流式 Claude 请求必须共享同一开关语义。
- 不因 provider 拒绝该字段而自动重试无缓存请求，避免隐藏配置错误和产生额外调用；用户通过模型设置关闭。

### R3 — 设置界面

- 桌面设置与 Spatial 设置中的 Claude 模型参数都提供同一开关。
- 文案描述用户可观察的结果：复用重复输入、降低延迟和输入费用；兼容接口不支持时可关闭。
- 开关默认状态与持久化配置一致。

### R4 — 诊断与兼容

- 保留现有 Claude cache read/cache creation usage 提取与诊断展示，不新增本地命中率估算。
- 对不返回缓存 usage 字段的兼容接口继续按“无缓存数据”降级。
- 高级自定义请求参数维持现有合并能力；验收“关闭”以未另外手工提供 `cache_control` 的配置为准。

## Acceptance Criteria

- [x] AC1：新建 Claude 模型的提示词缓存开关为开启；读取缺少该字段的已有 Claude 配置也归一化为开启；显式 `false` 保持关闭。
- [x] AC2：桌面设置和 Spatial 设置都能查看、切换并保存 Claude 提示词缓存开关。
- [x] AC3：开关开启时，Claude 文本/原生以及流式/非流式请求最终请求体顶层均包含 `cache_control: { "type": "ephemeral" }`。
- [x] AC4：开关关闭且高级参数未手工提供该字段时，Claude 最终请求体不包含 `cache_control`。
- [x] AC5：OpenAI-compatible、OpenAI Responses、DeepSeek 和 Gemini 请求行为不变。
- [x] AC6：Claude 返回的缓存创建/读取 token 继续进入统一诊断数据；不支持缓存统计的兼容接口不报错。
- [x] AC7：`npm run build:web` 与 `npm run test:smoke:web` 通过；按 smoke-only 规范不新增独立 unit/component/provider test 文件。
- [x] AC8：一次性 provider-boundary 验证确认默认开启、显式关闭、旧配置归一化和流式请求体；本会话没有可用的 live Claude endpoint，实际 cache creation/read 按条件判定 N/A，由统一诊断在真实长前缀调用中继续观测。

## Out of Scope

- system、tools、messages content block 的显式缓存断点。
- 1 小时 TTL 或其它缓存策略配置。
- 根据模型名称维护缓存能力名单。
- 自动探测第三方 Claude 兼容接口能力。
- 收到 4xx 后自动移除缓存字段并重试。
- 修改其它 provider 的缓存策略或重新设计诊断仪表盘。

## Risks and Deferred Items

- 部分第三方 Claude 兼容接口可能拒绝顶层 `cache_control`；模型级关闭开关是本期恢复路径。
- 缓存是否实际创建仍受 provider、模型、提示词最小 token 门槛和 TTL 约束；平台只启用并展示 provider 的真实报告，不承诺每次请求都命中。
- 若上线后自动缓存的命中率仍不理想，再以真实诊断数据决定是否增加显式断点；本期不提前承担该复杂度。
