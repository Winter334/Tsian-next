# Agent Tool Observation 契约治理 — Technical Design

## 1. Boundary model

本设计区分五种数据，不再用一个“observation 投影”同时承担所有职责：

1. **Raw execution result**：Tool runner 或 workspace operation 的内部结果，可供 trace 和 Tool 自身交付逻辑使用。
2. **Tool delivery result**：Tool producer 按自身语义生成的有界结果；分页、摘要、ID、path 与遗漏标志在这里产生。
3. **Accepted Agent observation**：共享运行时只验证 JSON 可序列化性和最终硬上限；通过后原样交给 native/text 协议。
4. **Agent Tool memory**：从 accepted observation 生成的跨 turn 摘要，可继续使用独立 retention/compaction，不反向改变即时 observation。
5. **UI presentation**：从 raw result 生成的封闭 `UiToolPresentation`；与模型结果独立，普通 Tool 不携带原始 payload。

```text
Tool runner -> producer-owned delivery -> strict acceptance gate -> native/text model message
                                              |                -> Tool memory summary
Raw execution result -------------------------+-> trace
Raw execution result -> closed UI projector ------------------> UI timeline
```

Environment 只决定能力和数据边界：Tool 可见性、workspace trust boundary、diagnostics、inspector、写权限等。桌面助手、游戏主 Agent 与 delegated Agent 复用同一 delivery/acceptance 实现，不在结果处理层判断产品身份。

## 2. Strict acceptance gate

将 `projectToolObservationForAgent` 替换为语义明确的 acceptance helper。生产代码使用固定的最终文本上限，不再从 Desktop/Game Environment 传入可调 `observationCharBudget`。

Gate 行为：

- 保留 `index`、`name`、`ok`、`result/error` 和 `imageParts` 的 call 对齐关系。
- 对文本 observation 做严格 JSON 序列化检查；不递归压缩、不字符串化特殊值、不截断、不生成 preview。
- 合规结果原样返回。
- 序列化文本超过固定上限时，返回 `ok: false`、`code: "TOOL_OBSERVATION_TOO_LARGE"`。`details` 仅含 `toolName`、`actualChars`、`maxChars`、可能的 path/id anchor 和 remediation，不复制违规正文。
- 无法安全序列化时返回独立的 `TOOL_OBSERVATION_INVALID`，同样不携带原始值。
- 解析失败或缺失 call 的 early-return 路径也必须经过 Gate，确保每个已接收 call slot 都遵守同一契约。

32 KiB 可继续作为最终事故隔离上限，而不再是内容裁剪预算。正常 producer 的业务上限应低于它，并为 JSON envelope 预留空间。多个合规 observation 仍受最终 provider request 总 token 预算约束。

## 3. Producer-owned delivery

### 3.1 Workspace read

新增 Agent-facing workspace result adapter，不改变通用 `executeWorkspaceOperation`：

- 文本正文最多 24 KiB。
- 无 range 的完整读取、行 range 和字符 range 都统一生成真实 `charOffset/returnedChars/totalChars`。
- 正文未完成时返回精确 `nextCharOffset`；后续 `read({ path, charOffset: nextCharOffset })` 可无重叠、无丢失续读。
- 图片继续把 base64 移出文本 result 放入 `imageParts`。图片字节/像素上限不在本次文本 observation 治理中改变。
- Resource Manager、SDK/browser-script 直接调用通用 workspace operation 时仍可获得原始完整读取语义。

### 3.2 Workspace search

Search producer 接管现有 10 files、5 matches/file、snippet 限制并返回明确 envelope。实现不得再把底层已限制数组长度误称为 corpus `totalFiles`。

建议字段：`items`、`returnedFiles`、`hasMoreFiles`、每项 `returnedMatches`/`matchesTruncated`/`omittedMatches`、`anchors`、`continuation`。当前底层没有 cursor，因此 continuation 只能诚实描述“缩小 path/query/pattern，或按 path read 权威文件”，不得伪装成精确分页。

### 3.3 List/glob

- Agent-facing `list` 增加 offset/limit，返回 exact `totalEntries/returnedEntries/nextOffset`；底层 list 仍返回完整直接子项。
- `glob` 保留 `limit/truncated`，并在 schema 中明确需要缩小 pattern 继续；若增加 offset，应只在 Agent adapter 层扩展，不破坏底层调用者。

### 3.4 Diff and mutations

- `diff` 不再把完整 `currentContent` 与调用参数中的 `expectedContent` 无条件复制进 observation。小结果可返回明细；大结果返回 changed/size/path 摘要与读取当前文件的 continuation，明确 `contentOmitted`。
- `write/edit` observation 返回文件元数据，不复制完整写后正文或 binary。
- recursive copy/move/delete 返回 affected count、有限 path sample、是否省略以及可检查的目标 root；不得依赖全局 preview。

通用 workspace operation 的 shared result contract保持不变；上述变化只属于 Agent-facing Tool delivery。

### 3.5 Skill activation and scripts

- `use_skill` 的 Tool observation 直接返回 activation metadata、完整 `SKILL.md` 正文、action count 和 declaration diagnostics；不返回从正文重复展开的完整 action schema 列表。
- 删除 `injectActivatedSkillMessagesNative/Text` synthetic `user` 注入路径及其 session 去重状态。Tool result 本身是唯一正文通道；模型仍在调用后的下一次模型请求看到结果，不增加额外模型轮次。
- producer 在注册 activation 前按完整 result envelope 计算大小并预留 observation 外层空间；过大时返回 `SKILL_DETAIL_TOO_LARGE`，包含实际大小、上限和拆分 Skill/资源的建议，不依赖最终 Gate 改写正文。
- `run_script` 与 custom Tool 默认是保守 inline contract：小结果原样交付；超限结果 fail loud。作者应让脚本返回摘要、cursor 或先写 workspace artifact 再返回 path。
- MVP 不新增通用 artifact storage、统一 cursor schema 或 `tool.json` 迁移字段。未来确有跨 Tool 编排需求时，再引入显式 `inline | paged | artifact` manifest contract。

### 3.7 Same-turn staged Workspace coherence

- Host 创建的 `RuntimeWorkspaceTransaction.workspaceFiles` 是 turn 内唯一实时数据源。写入会替换/新增 staged file，删除会原地移除。
- `runAgentRuntimeTurn` 不得先把该数组 `filter`/`Array.from` 成固定副本再交给 Tool loop。Agent context/registry 组装继续按 trust boundary 生成只读可见投影；workspace operation 继续通过 `workspaceFileFilter` 逐次过滤实时数组。
- delegated Agent 的 registry/context 可以使用临时可见投影，但 delegated Tool loop 必须继续持有根 turn 的实时 staged 数组，以便看到 caller、兄弟步骤和自身此前写入。
- custom Tool/Skill browser-script SDK 与顶层 workspace Tool 均读取同一个实时数组并使用同一个 mutation adapter。修复只改变 turn 内可见性，不改变最终 commit/rollback、权限或 UI presentation。

### 3.6 Existing specialized Tools

- `query_diagnostics` 保持自身 20 records、snippet、16 KiB section page、30 KiB aggregate 契约；read 的 id/section/offset 是精确分页，list/search 仅是 narrowing。
- inspector 保留字段级上限，并补足 aggregate 层的明确有界/窄化行为；不得由最终 Gate 静默裁剪。
- `agent_call`、`test_skill_script`、custom Tool 若仍返回超限 inline 内容，Gate 以契约失败兜底。其 remediation 指示调用方要求简洁结果，或让目标 Agent/脚本写 workspace artifact 并返回 path。

## 4. Protocol and memory flow

- Native 模式继续逐 `toolCallId` 写一个 `role: "tool"` 消息；provider adapter 不改。
- Text 模式直接序列化 accepted observation，删除 `compactLargeValueForModel` 的二次结果压缩。
- `collectToolMemoriesForContext` 只接收 accepted observations。即时 observation 不再复用 memory compactor；memory 自己的 per-tool/turn/total retention 保留。
- Trace 可同时记录 raw 与 accepted 的大小/状态，但不得把 raw Tool result写入 UI timeline/session persistence。

## 5. Compatibility and migration

- 不迁移既有会话、旧 preview observation 或 registry 数据。
- 正常大小的 custom Tool/Skill output 保持值与形状不变；旧 manifest 无需增加字段。
- 旧的大输出从“看似成功但内容被裁剪”改为结构化失败，这是有意的 fail-loud 行为。
- read/search/list 的 Agent-facing envelope 会更明确；通用 workspace operation、Resource Manager 和 browser-script SDK 不变。
- UI presentation 和 8-KiB `agent_call` 展示上限保持独立。
- 旧生产包的 native Tool correlation 问题不在本改动中兼容；部署当前构建后按原始请求重新验证。

## 6. Risks and rollback points

- 删除通用 fallback 后，任何遗漏的增长型 producer 会暴露为 `TOOL_OBSERVATION_TOO_LARGE`。实施时必须覆盖 research 中列出的 built-ins，并为每类加入超限测试。
- Search 没有真实 cursor。MVP 必须使用诚实 narrowing，不制造不可兑现的 `nextCursor`。
- `use_skill` 直接结果必须在 native/text 两路保持同一 accepted observation；删除 synthetic user 注入后要反向断言没有第二份正文。
- 若 trust-boundary 投影在 turn 入口复制实时数组，脚本写入会只对 custom Tool 自身可见、顶层 read 仍读旧快照。修复必须同时覆盖 entry 与 delegated、write 与 delete，并重跑隔离测试。
- mutation path sample 不代表完整列表，必须返回 exact count 和 target root，避免 UI/Agent误解为完整结果。
- 若 producer 改造范围导致不稳定，可先保留固定严格 Gate 与 read/search/use_skill，其他 producer 在合并前逐项补齐；不得恢复伪成功 preview。
- 图片大小治理与通用 artifact 系统明确延期，不应顺手扩张本任务。

## 7. Verification strategy

- 单元测试先验证 producer 的语义边界，再验证 Gate 原样通过或 fail loud。
- native/text 协议测试断言 accepted content 字节不被二次改写，call/result 数量和 id 对齐。
- Tool memory 测试断言只接收 accepted observation，同时保留跨 turn 摘要预算。
- Resource Manager/通用 workspace operation 回归测试断言完整读取不变。
- diagnostics、Environment isolation、UI presentation、session persistence 测试作为边界回归。
