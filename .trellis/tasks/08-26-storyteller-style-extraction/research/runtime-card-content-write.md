# Runtime Agent 卡内容写入证据

## Existing Storyteller Wiring

- `cards/沉浸阅读器.tsian-card/workspace/agents/storyteller/creation-guide.md:68-72` 已通过 `{{file:modules/文风/*.md?enabled}}` 注入启用的文风文件，因此新增模块不需要修改注入链路。
- `cards/沉浸阅读器.tsian-card/workspace/agents/storyteller/agent.json:35-42` 当前只启用 `workspace_read`，访问等级为 `1`。

## Existing Permission Contract

- `apps/platform-web/src/agent-runtime/workspace-operations.ts:97-105` 定义 `card-content.editLevel = 2`、`save-runtime.editLevel = 1`。
- 因此 Storyteller 需要 `workspace_write` 和 level `2`；全局 access table 不需要修改。

## Missing Runtime Persistence Routes

- `apps/platform-web/src/platform-host/runtime-turn.ts:202-225` 的玩家正式回合 mutation adapter 只接受 `platform-meta` 与 `save-runtime` write，其他 scope 会被宿主拒绝。
- `apps/platform-web/src/platform-host/ai-invocation.ts:356-381` 的旁路调用 adapter 有同样限制。
- 两条路径都必须支持 `card-content`，否则同一 Storyteller 配置在不同入口的行为不一致。

## Existing Direct-Write Pattern

- `apps/platform-web/src/platform-host/assistant-chat.ts:593-608` 已实现卡内容直写：调用 `writeCardContentFileForActiveCard`，随后把返回文件同步进 staged workspace，使同一回合后续读取可见。
- `apps/platform-web/src/platform-host/internal.ts:124-139` 导出该 helper，并通过当前激活卡的逐文件内容表持久化。
- Runtime Agent 可复用这条持久化路径；权限仍由 workspace operation 层在进入 adapter 前检查。

## Source Reading Boundary

- `save/playthrough/frontier.json` 的 `sourceWindow` 表示当前已读章节范围。
- `frontier.json` 的 `sourceWindow` 提供已读章节边界；现有源文本读取器负责把章节引用解析为实际正文。
- AI-facing 提示不应要求 Storyteller 依赖 shard 路径、字符偏移或固定源目录布局。文风模块只需要求读取已读范围内的实际正文，不需要新建聚合脚本或 Skill。

## Packaging

- `scripts/package-immersive-reader-card.mjs:157-190` 递归列举权威 `workspace/` 树并把全部 UTF-8 文件加入 `workspaceFiles`。
- 新增 `agents/storyteller/modules/文风/原作文风.md` 会自动进入卡包，无需维护额外 manifest。

## Test Surface

- `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts` 已搭建 fake IndexedDB、活动卡/存档、模型 tool-call stub 和 `invokeAgent` 验证路径，适合增加卡内容持久化回归。
- 玩家正式回合可通过同一夹具调用 `runtime-turn.ts` 的 `sendMessage`，旁路路径继续使用 `invokeAgent`。
- 验证重点是两条入口均能直写 card-content，且写后同回合读取看到新内容；无需为纯语义文风产物增加格式测试。
