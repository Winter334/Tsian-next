# Production retest foundations (2026-08-07)

## Scope

本记录只覆盖两项基础 Tool 契约：`use_skill` 的正文交付通道，以及卡级自定义 Tool 与顶层 workspace Tool 的同 turn staged 状态一致性。开局向导、访谈顺序、Skill 业务提示词和前端流程不在本轮实现范围。

## Request evidence

- 复测请求使用 `deepseek/deepseek-v4-flash-0731`，最终请求包含 109 条消息、68 条 Tool observations 和约 30 个 Tool 轮次。
- observation 最大约 25,203 chars；请求中没有 `TOOL_OBSERVATION_TOO_LARGE` 或 `TOOL_OBSERVATION_INVALID`，因此 strict acceptance Gate 不是本次循环的直接失败点。
- `use_skill` observation 只返回约 218 chars activation metadata；框架随后插入一条约 3,515 chars 的 synthetic `user` 消息承载《游玩设定》全文。正文只注入一次，但其因果通道与 Tool call 分离。
- 卡级 `json_edit` 来自 `tools/json_edit/tool.json` + `tools/json_edit/run.js`。它返回主角 `brief/identity/background` 与场景 `present` 的 `changed:true`，紧接着的顶层 `read` 仍返回修改前正文；后续 `json_edit` 对同一值返回 `changed:false`。这说明脚本侧 mutation state 与顶层 read state 在同一 turn 内脱节。

## Confirmed code path

1. Host 用 `createRuntimeWorkspaceTransaction()` 创建可变 `workspaceFiles`；`write()` 替换/新增 staged file，`delete()` 原地移除。
2. Browser Skill/custom Tool runner 的 SDK workspace operations直接读取并修改 `options.workspaceTransaction.workspaceFiles`。
3. `runAgentRuntimeTurn()` 当前通过 `workspaceFilesForAgentBoundary()` 构造 `input.workspaceFiles`。该 helper 对 runtime boundary 使用 `filter()`，对 trusted authoring 使用 `Array.from()`；两者都创建固定数组副本。
4. 顶层 `read/list/search/...` 从 `context.workspaceFiles`（上述副本）读取；custom Tool 后续调用则从 host transaction 的实时数组读取。
5. transaction 写入替换了实时数组中的 file object，但固定副本仍持有旧 object；新增/删除也不会同步。因此日志中的 `changed:true -> read old -> custom Tool changed:false` 与代码行为一致。
6. delegated Agent runner 又对 `input.workspaceFiles` 做了一次 boundary copy，存在同类风险。

## Intended correction boundary

- 实时 transaction 数组应贯穿 entry/delegated Tool loop。
- Agent context、registry 和 workspace operation 可见性仍由现有 trust-boundary assembly/filter 控制；不能用固定数组副本承担持续可见性。
- 修复不改变 mutation commit/rollback、actor level、Tool visibility、UI presentation 或 Resource Manager contract。

## Direct Skill delivery decision

- `use_skill` 的核心产物是完整 `SKILL.md`；对应 accepted Tool observation 应直接携带正文一次。
- 不恢复旧实现中重复展开的完整 `actions[].inputSchema`；action 声明已经存在于正文。
- 删除 synthetic `user` injection 和 `injectedSkillPaths` 去重状态。Native/Text 都消费同一 accepted Tool result；UI 仍只消费 closed presentation，Tool memory 仍可独立摘要。
- producer 在 activation 注册前验证完整 result envelope；过大返回 Skill 专用 `SKILL_DETAIL_TOO_LARGE`，提示拆分 Skill/资源，不截断正文。

## Required regression matrix

- `use_skill` native/text：Tool result 含完整正文；没有额外 user injection；重复调用不产生隐藏正文通道；`run_script` 激活状态正常。
- oversized Skill：Skill 专用失败、未注册 activation、无部分正文泄漏。
- custom Tool/Skill script write -> next-round top-level read/list/search sees staged state。
- script delete -> next-round top-level read/list sees deletion。
- entry + delegated Agent 共享 staged state；runtime-game hidden paths仍不可见。
- failed/aborted turn仍丢弃 staged changes。
