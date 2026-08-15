# Design — Claude 自动提示词缓存

## 1. Boundary and Data Flow

本任务只修改 `apps/platform-web` 内的浏览器 AI 配置、两套设置 UI 和 Claude provider adapter：

```text
BrowserClaudeModelParameters.promptCachingEnabled
  -> defaults / stored-value normalization / clone
  -> desktop + Spatial model settings
  -> providerParamsForKind(..., "claude")
  -> buildClaudeRequestBody(...)
  -> top-level cache_control
  -> existing provider usage extraction / diagnostics
```

不修改 contracts 包：模型参数配置是 `platform-web` 本地浏览器配置，不跨 bridge/package contract 边界。

## 2. Configuration Contract

在 `BrowserClaudeModelParameters` 增加：

```ts
promptCachingEnabled: boolean
```

- `createDefaultBrowserClaudeModelParameters()` 返回 `true`。
- `normalizeClaudeModelParameters()` 使用“只有显式 `false` 才关闭”的兼容读取语义。这样已有配置缺字段会启用，保存后的 `false` 不会被默认值覆盖。
- 现有 clone/update helper 通过对象展开自然携带该字段，不新增并行状态。

选择 boolean 而不是策略枚举，因为本期只有 Anthropic 顶层自动缓存和关闭两种产品行为；显式断点、TTL 与能力探测均不在范围内。

## 3. Request Construction

`buildClaudeRequestBody()` 是三条公开构造路径的共同边界：

- `buildRequestBody`：普通文本非流式；
- `buildNativeRequestBody`：原生工具调用非流式；
- `buildStreamRequestBody`：复用 native body 后追加 `stream: true`。

在该共同边界读取 Claude 参数。开启时向最终 body 注入：

```json
"cache_control": { "type": "ephemeral" }
```

关闭时不主动注入。保持现有 custom request params 合并规则：平台显式构造的字段优先；若平台关闭而高级 JSON 主动提供 `cache_control`，仍视为用户的高级手工配置，不在开关自动行为的验收范围内。

不做 4xx 自动回退重试：一次失败后再发第二次请求可能增加费用、延迟和副作用，也会隐藏“该兼容接口不支持当前 Claude 协议字段”的真实配置问题。

## 4. UI

两个现有 Claude 参数面板各增加同一模型参数开关：

- `components/settings/ModelParamsFields.vue` 使用现有 `Switch`；
- `spatial/apps/settings/SpatialModelParameters.vue` 使用现有 checkbox 样式。

建议标签：`提示词缓存`。

建议帮助文案：`复用重复的提示词内容，降低延迟和输入费用；兼容接口不支持时可关闭。`

文案只说明用户收益与恢复动作，不展示 `cache_control`、断点或内部请求构造。

## 5. Diagnostics

现有 `extractUsageFromPayload(payload, "claude")` 已读取：

- `usage.cache_read_input_tokens` -> `cached`
- `usage.cache_creation_input_tokens` -> `cacheCreation`

本任务不修改这一结构，也不根据本地消息估算命中。验证使用统一诊断中的最终 request body 与 provider usage。

## 6. Compatibility and Rollback

- 已有配置：缺字段 -> 开启；显式 false -> 关闭。
- 新建配置：开启。
- 不支持顶层自动缓存的第三方接口：用户关闭该模型开关后恢复旧请求形状。
- 代码回滚：移除 adapter 注入不会损坏已存配置；多出的 boolean 会被旧读取代码忽略。

## 7. Verification Strategy

仓库采用 smoke-only 自动化策略，本任务不创建 provider unit test。验证组合为：

1. `npm run build:web` 覆盖类型、Vue 模板与配置字段贯通；
2. `npm run test:smoke:web` 验证现有助手主事务未回归；
3. 人工通过设置保存/刷新检查 true/false 持久化；
4. 通过统一诊断检查 Claude 最终 body：开启有顶层字段、关闭无平台注入字段；
5. 对满足最小 token 门槛的相同长前缀连续请求，检查首次 cache creation、后续 cache read；不把 provider 未命中误判为本地构造失败。
