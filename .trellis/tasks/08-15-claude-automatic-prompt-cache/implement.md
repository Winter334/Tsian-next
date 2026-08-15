# Implement — Claude 自动提示词缓存

## Step 1 — Load implementation context

- [x] 阅读 `platform-web/frontend` index、type-safety、quality-guidelines 与玩家可见文案指南。
- [x] 阅读任务 research，确认顶层自动缓存与显式断点边界。
- [x] 先搜索 `BrowserClaudeModelParameters`、Claude 设置面板和 `buildClaudeRequestBody` 的所有消费者。

## Step 2 — Extend Claude model configuration

- [x] 在 `config/ai/types.ts` 给 `BrowserClaudeModelParameters` 增加 `promptCachingEnabled: boolean`。
- [x] 在 `config/ai/defaults.ts` 默认设为 `true`。
- [x] 在 `config/ai/normalize.ts` 将缺失/非 false 的旧值归一化为开启，并保留显式 false。
- [x] 检查 clone、provider helper、保存和读取路径都自然保留该字段，避免另建重复状态。

## Step 3 — Add both settings controls

- [x] 在 `MODEL_PARAMETER_TIPS` 增加面向用户结果的缓存说明。
- [x] 在 `ModelParamsFields.vue` 的 Claude 区增加 Switch，更新模型参数字段。
- [x] 在 `SpatialModelParameters.vue` 的 Claude 区增加对应 checkbox，保持两套设置能力一致。
- [x] 检查新增/编辑模型时默认值、保存后刷新和显式关闭状态。

## Step 4 — Enable Claude automatic caching

- [x] 在 `buildClaudeRequestBody()` 的共同边界读取开关。
- [x] 开启时注入顶层 `cache_control: { type: "ephemeral" }`；关闭时不主动注入。
- [x] 保持 custom params 与平台字段的现有优先级，不改其它 provider adapter。
- [x] 静态核对 text/native/stream 三条公开路径全部经过共同 builder。

## Step 5 — Update executable spec

- [x] 在独立 `platform-web/frontend/ai-provider-caching.md` 中记录完整 Claude 缓存契约，并从 index 与 quality message-cache 总则链接。
- [x] 不把实现历史或旧方案写进玩家界面。

## Step 6 — Verify

- [x] `npm run build:web`
- [x] `npm run test:smoke:web`
- [x] 检查 git diff，确认没有 contracts、其它 provider 或无关文件漂移。
- [x] 检查桌面/Spatial 开关及配置归一化/克隆持久化路径。
- [x] 一次性 Vitest 边界探针检查 Claude 最终 request body 的开启/关闭/stream 形状，运行后删除临时测试文件。
- [x] 条件允许时检查 cache creation/read usage；本会话无 live Claude endpoint，按条件判定 N/A，真实调用继续由统一诊断观测。

## Risk / Rollback Points

- 若兼容接口拒绝 `cache_control`，先确认关闭开关能恢复旧请求体；不增加自动重试。
- 若旧配置显式 false 被归一化成 true，回滚并修正 normalization，不能靠 UI 临时覆盖。
- 若两套设置状态不一致，停止交付并修正共同模型参数流，不引入 UI 私有开关。
