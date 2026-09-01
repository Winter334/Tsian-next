# Agent Tool Observation 契约治理

## Goal

让 Agent 获得语义完整、大小可控且可继续获取的 Tool 结果，消除运行时在结果已产生后进行通用裁剪所造成的信息丢失、重复读取和 token 浪费；同时保持 Agent 上下文、UI 展示上下文、桌面助手能力与游戏运行时 Agent 能力之间的既有边界。

## Background

- 当前 Agent Tool 执行完成后会经过统一 observation 投影。该投影具有 32 KiB 上限，并可能把合法结果替换成 preview 或压缩值；模型无法可靠区分“工具真实只返回这些内容”和“运行时丢弃了其余内容”。
- `workspace_read` 和 `workspace_search` 已有部分分页或数量限制，但限制分散在 workspace operation 与 observation 投影两层，导致工具交付契约不清晰。
- 诊断查询已经由专用 Tool 自己提供有界的 list/search/read 与分段读取能力，应保持该模式。
- UI 只消费封闭的 `UiToolPresentation`，不应承担 Tool 结果裁剪、分页或恢复业务。
- 桌面助手与游戏卡运行时 Agent 使用不同 Environment/能力集合，但应复用同一套 Tool 交付基础设施，不复制两套执行逻辑。
- 之前生产环境出现的 native Tool call/result 关联缺失来自未更新的旧前端包；当前源码已保证逐 call 产生结果。本任务不把旧包问题误归因于 observation 契约，部署后另行复测。

## Requirements

### R1. Tool 拥有结果交付责任

每个面向 Agent 的 Tool 必须在自身执行边界产出语义明确、大小可控的结果。大内容必须通过分页、游标、精确范围、摘要加 ID 或 workspace artifact 引用继续获取，不得依赖运行时事后裁剪。

### R2. 运行时只做最终安全校验

共享运行时保留最终序列化安全上限与 JSON 可序列化性校验，但不得压缩、截断或用 preview 替换成功结果。超过上限时必须返回结构化失败 `TOOL_OBSERVATION_TOO_LARGE`，包含实际大小、上限和可操作的修复提示；不得把部分内容标成成功。

### R3. Workspace read 在 Agent Tool 边界分页

Agent 调用 `workspace_read` 时，无论未指定范围、使用行范围，还是使用字符范围，返回给 Agent 的文本都必须满足 Tool 自身上限，并在未完成时提供精确的字符续读位置。Resource Manager 和其他直接消费通用 workspace operation 的路径仍可读取完整文件，不受 Agent Tool 分页策略影响。

### R4. Workspace search 在 Agent Tool 边界限制并声明遗漏

Agent 调用 `workspace_search` 时，文件数、每文件匹配数、上下文与片段大小由 search Tool 自己限制。结果必须明确说明返回量、是否还有结果，以及如何继续或缩小查询；不得由通用 observation 层静默丢弃匹配项。

### R5. 专用 Tool 保持专用交付契约

`query_diagnostics` 等已经具有 ID、section、range 或受控 narrowing 契约的 Tool 继续在各自 runner 内控制大小。共享运行时仅验证最终结果，不再次改写其语义。

### R6. 其他内建 Tool 不得依赖全局兜底裁剪

`list`、`glob`、`diff`、workspace mutation、`use_skill`、inspector 等可能增长的内建结果必须返回有界明细、明确摘要或可重读引用。`use_skill` 的核心交付物就是完整 `SKILL.md`，应在本次 Tool observation 中直接返回一次；不得再通过框架额外伪造 `user` 消息注入，也不得把正文中已有的完整 action schema 复制成第二份结构化列表。Skill producer 必须在激活时保证整个返回 envelope 能通过最终安全上限，过大时以 Skill 专用错误要求作者拆分。

### R7. 扩展 Tool 与 Skill action 使用保守交付契约

自定义 Tool 和 `run_script` Skill action 默认按 inline 结果处理。作者可以在 inline 结果中返回分页 envelope 或 artifact 引用；若交付 envelope 本身仍超过最终安全上限，调用必须显式失败。当前 MVP 不自动把任意脚本输出写入 artifact，也不对旧 Tool/Skill 数据做迁移。

### R8. Agent 与 UI 上下文分离

Agent observation 只服务模型推理和 Tool memory；UI 继续只消费封闭、独立、可有自身展示上限的 `UiToolPresentation`。普通 Tool 的原始参数和结果不得进入 UI timeline/session persistence。

### R9. 只从已接受结果生成 Tool memory

Tool memory 和 native/text Tool 消息必须消费同一个已通过最终校验的 observation。超限失败不得把被拒绝的原始或部分成功内容写入跨 turn memory。

### R10. Desktop 与 runtime Agent 共享机制、隔离能力

桌面助手、主运行时 Agent 和 delegated Agent 复用相同的 Tool 交付校验与内建 Tool producer；Environment 仍负责决定可见 Tool、workspace trust boundary、diagnostics 等能力，不通过 observation 逻辑区分产品身份。

### R11. 不承担无数据价值的迁移

项目仍在测试阶段，不为既有会话、旧 preview observation 或旧 registry 数据增加迁移与兼容读取。新代码只保证新请求的契约。

### R12. 同一 turn 的 staged Workspace 必须一致可见

顶层 workspace Tool、`run_script` 和卡级自定义 Tool 必须读写同一个实时 staged Workspace。任一 Tool/脚本成功写入或删除后，后续同 turn 的 `read/list/search/glob/diff`、Skill action 与自定义 Tool 必须立即看到该变化；失败或中止仍整体丢弃 staged mutation。Workspace trust boundary 可以过滤可见文件，但不得通过脱离事务的数组副本破坏写后读一致性。

## Acceptance Criteria

- [x] AC1: 代码中不再存在把超限成功 Tool 结果替换成 `preview`、`truncatedForModel` 或通用压缩值后继续标记成功的路径。
- [x] AC2: 超过最终序列化上限的 Tool 结果返回 `ok: false` 和 `TOOL_OBSERVATION_TOO_LARGE`；错误包含 `actualChars`、`maxChars`、Tool 名称及交付建议，且不包含被裁剪的结果正文。
- [x] AC3: 超大单行文件、未指定范围的超大文件及可能超限的行范围读取都返回不超过 Tool 上限的正文和精确 `nextCharOffset`；按该 offset 续读可无丢失地获取完整内容。
- [x] AC4: `workspace_search` 的限制在 search Tool producer 内完成，返回值显式描述当前页/遗漏/继续方式；最终安全校验不再二次裁剪搜索结果。
- [x] AC5: 通用 workspace operation 的完整读取能力与 Resource Manager 消费路径保持不变。
- [x] AC6: `query_diagnostics` 现有 list/search/read 上限、cursor、section/range 行为和测试保持通过。
- [x] AC7: `list`、`glob`、`diff`、workspace mutation 和 inspector 等内建 Tool 的增长型字段要么有界并报告遗漏，要么返回可重读摘要；不依赖最终安全校验生成伪成功预览。
- [x] AC8: `use_skill` 在对应 Tool observation 中直接返回完整 `SKILL.md` 一次，不额外注入 synthetic `user` 消息，不重复返回完整 action schema；action 仍可正常解析和执行。
- [x] AC9: 自定义 Tool 或 Skill action 产生超限 inline 结果时显式失败；正常大小结果保持原值，不被压缩或重写。
- [x] AC10: native 与 text 两种 Tool 协议都消费同一已接受 observation；text 协议不再二次压缩，每个已执行 Tool call 仍对应一个结果消息。
- [x] AC11: Tool memory 只包含已接受的成功结果或结构化失败，不包含被拒绝原始正文或伪成功 preview；跨 turn memory 自身的摘要保留策略不变。
- [x] AC12: UI 的 `agent_call` 展示投影仍可独立限制响应大小，普通 Tool 仍无原始结果 presentation；UI 无新增分页/裁剪业务。
- [x] AC13: 桌面助手与游戏/委派 Agent 的 Tool 可见性和 diagnostics 隔离测试保持通过。
- [ ] AC14: contracts、platform-web build 与相关 Tool/workspace/diagnostics/runtime 测试全部通过；部署更新后再复测旧生产请求中的 Tool call/result 关联问题。
- [x] AC15: 卡级自定义 Tool 或 Skill action 在 staged save-runtime 中写入/删除后，下一轮顶层 workspace read/list/search 能看到新状态；后续脚本也看到同一状态，turn 失败/中止时仍不落盘。
- [x] AC16: runtime-game 与 trusted-authoring 的 Workspace 可见性隔离保持不变；修复不得让 `frontend-actions/**` 或 `.tsian/local/**` 通过运行时读取边界泄漏。

## Out of Scope

- 自动把任意超大 Tool/Skill 输出持久化为 workspace artifact。
- 为每种第三方 Tool 定义统一业务分页 schema 或自动生成 cursor。
- 图片 `imageParts` 的字节/像素治理与通用 artifact 存储子系统。
- UI 展示原始 Tool 参数/结果，或让 UI 参与结果分页与恢复。
- 迁移既有会话、旧 observation、旧 Tool registry 缓存或旧生产前端包数据。
- 在本任务中重新解决已经由当前源码修复、仅存在于旧生产包的 native Tool 关联问题。
- 重构开局建模、游玩设定访谈、开局向导前端或相关提示词；这些在基础 Tool 契约稳定后另立任务处理。
