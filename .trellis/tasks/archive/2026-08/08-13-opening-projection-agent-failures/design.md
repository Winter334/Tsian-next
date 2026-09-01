# 开局回复投影契约与 Agent 失败收敛设计

## 1. 设计目标与边界

本任务修复沉浸阅读器卡内 `commit_opening` 对平台 reply projector 的错误消费，并让 world-architect 在真正的 opening reply 输入错误时获得可操作、有限的恢复路径。平台 projector 的通用语义保持不变：`displayContent` 仅在 display lane 与 `content` 不同时存在。

修改边界：

- card opening commit script：兼容 optional `displayContent`、输出结构化失败 details、按可选字段持久化 turn 0，并按 browser-script workspace read 的 not-found 抛错语义处理 legacy 可选文件。
- browser-script `reply.project` SDK：保留现有 assistant projection，并透传 projector 的 metadata-only diagnostics/config/rule 计数；不返回原始 reply 或预览。
- card opening Skill：增加提交前一致性 gate、投影失败和不可由输入修复错误的有界恢复动作。
- task-mode context compression：调整 checkpoint 摘要与未解决原始失败轮的相对顺序，不改变摘要 schema、保留算法或预算。
- 现有 Assistant Runtime smoke：用真实 projector 与 workspace-read 语义覆盖 opening commit seam，并验证 checkpoint 顺序。
- task research：保留失败请求根因矩阵，作为本次审查与后续平台治理依据。

不修改平台 `projectAssistantReply` 规则语义、共享 contracts、通用 `run_script` schema、checkpoint compression prompt/section schema 或全局 tool-loop budget。

## 2. 正确的数据流

```text
openingReply
  → tsian.reply.project(openingReply)
  → projected.content                  必填、未来模型上下文权威
  → projected.displayContent?          可选，仅与 content 不同时存在
  → projected.projections.choices      必填，1..12 项
  → commit validation
  → turn 0 assistant item
  → player context 只写 projected.content
```

玩家可见文本遵循平台已有规则：

```js
const visibleContent = projected.displayContent === undefined
  ? projected.content
  : projected.displayContent;
```

`visibleContent` 只用于验证“存在可见正文”；当 fallback 到 `content` 时，不为了凑字段而持久化重复的 `displayContent`。

turn 0 assistant item 使用条件字段：

```js
const assistantItem = {
  kind: 'assistant',
  content: projected.content,
  ...(projected.displayContent !== undefined
    ? { displayContent: projected.displayContent }
    : {}),
  projections: projected.projections,
};
```

## 3. Projection validation 与诊断

`commit_opening` 继续 fail-closed，且所有正式写入仍发生在完整前置校验之后。验证拆成可定位的 issue codes：

- `projection.missing`：projector 没有返回对象。
- `content.empty`：clean content 缺失或为空。
- `display.invalid`：显式返回了非字符串 displayContent。
- `display.empty`：显式 displayContent 或 fallback 后的可见正文为空。
- `choices.missing`：`projections.choices` 不是数组。
- `choices.count`：数量不在 1..12。
- `choices.item`：存在空白、非字符串或超过 300 字符的项；details 只给非法索引。

失败仍使用稳定 code `OPENING_REPLY_PROJECTION_FAILED`，details 采用有界元数据：

```js
{
  issues: [{ code, path, indices? }],
  projection: {
    displayContent: 'omitted' | 'present' | 'invalid',
    choiceCount: number | null,
    configPresent?: boolean,
    ruleCount?: number,
    appliedRuleCount?: number
  },
  diagnostics: [
    { scope, code, message, ruleId?, ruleIndex? }
  ]
}
```

约束：

- diagnostics 最多保留 20 项，单条 message 截到 500 字符。
- details 不包含 openingReply、content、displayContent、choice 文本或任何预览。
- projector diagnostics 本身不自动导致提交失败；最终产物合法时继续提交，保持平台 fail-soft 配置语义。
- browser-script SDK 返回 `{ kind: 'assistant', content, displayContent?, projections?, diagnostics, configPresent, ruleCount, appliedRuleCount }`；新增字段只含 projector 既有 metadata，正文仅存在于既有 assistant 字段。

## 4. 开局 Skill 流程设计

《开局建模》不再把委派正文和错误收敛写成末尾附加规则，而是用一个从恢复到提交的主流程承载。步骤名称、完成条件和失败去向都面向 Agent 的当前动作，不写平台内部因果。

### 4.1 阶段与转移

| 阶段 | 当前动作 | 完成条件 | 未完成或失败时 |
|---|---|---|---|
| 1. 恢复现场 | 确认前端给出的 session/branch；较早对话已离开上下文时读取 `opening-notes.md` | 已知当前分支、玩家最近确认项和下一个待决定项 | 笔记缺失视为新访谈；笔记与当前回答冲突时以当前回答为准并更新笔记 |
| 2. 获取当前证据 | 只为眼前角色、切入点或必要事实读取 preview/slice | 当前问题已有足够来源事实，或已确定它只能由玩家决定 | 预览不足则定向精读；来源 action 失败且无法获得必要事实时保留 code 并停止本次推进 |
| 3. 收敛访谈 | 每轮确认一个会改变正式模型或首回合的高价值分歧 | 主角、切入点和首回合最小事实已确定，玩家明确开始 | 仍有阻塞分歧则继续提问；选项只表达当前分歧，不把人称/文风等写手表达配置与切入点捆绑 |
| 4. 组装草案 | 在内存中准备最小 entities/scenes/relationships/runtime/frontier/summary 和 storyteller brief | 所有引用可由本次草案满足，brief 明确角色、切入点、已知事实和正文终点约束 | 缺事实回到阶段 2；需要玩家决定的冲突回到阶段 3；不写任何正式文件 |
| 5. 生成正文 | 通过 `agent_call` 把 brief 交给 storyteller，请其返回首回合正文与正式 `[[选项]]` | 得到可供核对的 `openingReply` | 返回缺正文/缺正式选项时带着缺项重新委派；委派不可用或同一缺项再次出现时保留现状并简短报告 |
| 6. 对齐终点 | 核对来源事实，并把模型当前时点对齐到正文末尾等待玩家选择的瞬间 | runtime location、active scene、scene.present 和出场实体状态与正文终点一致 | 正文偏离已确认事实时带修正点重新委派；草案漏项时修正草案；出现新的玩家级分歧时回到阶段 3 |
| 7. 原子提交 | 用草案和 `openingReply` 调用 `commit_opening` | action 成功，正式开局一次落盘 | 按结构化错误映射修正对应阶段；无输入修复动作或同一输入复现相同 code 时保留 code/message/details 并停止 |

工作笔记只记录耐久事实，不记录“当前阶段”或审计状态。流程从可观察的输入与产物判断下一步，避免再引入一份状态机权威。

### 4.2 Storyteller 职责边界

world-architect 的 brief 只携带本次正文所需的已确认事实、最小模型草案、切入点和终点约束。storyteller 使用自身已启用的 context 与模块决定叙事人称、文风和输出格式。

AI-facing Skill 不追加“禁止读取 storyteller 模块”的孤立禁令；流程在阶段 5 直接委派，且阶段 3 不把写手表达配置塑造成玩家必须回答的建模问题。这样既移除诱因，也不会把互斥模块名称植入 world-architect 上下文。

### 4.3 Projection failure 恢复

`OPENING_REPLY_PROJECTION_FAILED` 从阶段 7 映射回对应输入：

- `content.empty` / `display.empty`：回到阶段 5，要求 storyteller 补全正文。
- `choices.*`：回到阶段 5，要求 storyteller 修正正式选项块。
- `projection.missing` / `display.invalid`、配置或规则 diagnostics：当前流程没有可修改的开局输入，保留 code/message/details 并停止。
- 同一份草案与 openingReply 再次返回相同 code：停止，不继续扩展调查面。

提示词不解释 lane、optional field、browser-script executor、workspace scope 或 checkpoint；这些由代码契约处理。

## 5. 可选读取与 checkpoint 顺序

### 5.1 Browser-script workspace read

`tsian.workspace.read` 走 `executeWorkspaceOperation`，缺文件会抛带 `code = WORKSPACE_FILE_NOT_FOUND` 的 Error。`commit_opening` 的 legacy clean-save 探针是可选读取，采用：

```js
async function optionalFile(path) {
  try {
    return await tsian.workspace.read({ scope: 'effective', path });
  } catch (error) {
    if (error && error.code === 'WORKSPACE_FILE_NOT_FOUND') return null;
    throw error;
  }
}
```

只处理精确 code；权限拒绝、非法路径、执行失败等继续 fail closed。必需文件读取保持原行为。

### 5.2 Task checkpoint supersession

压缩继续把未解决的语义操作轮排除在有损摘要之外并原样 pin。新消息顺序改为：

```text
framework → checkpoint summary → pinned unresolved rounds → recent rounds
```

这样摘要即使沿用了旧错误，后置的原始 Tool 结果仍是更新的权威事实。不得把 commit 完整输入复制进摘要，也不新增全局重复调用拦截器。

## 6. 测试设计

扩展现有 `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts`，不新增测试文件。

成功路径：

1. 在 fixture workspace 中加入正式 choices reply-projection 配置。
2. `tsian.reply.project` seam 内部调用真实 `projectAssistantReply`，再按 production browser-script SDK 形状返回 assistant projection + metadata；不得直接返回内部对象形成测试专用形状。
3. 断言真实结果省略 `displayContent`、clean `content` 不含 choices block、`projections.choices` 正确。
4. 执行真实 opening script，断言提交成功；turn 0 不持久化冗余 displayContent，player context 使用 clean content。

关键失败/rollback 路径：

1. opening reply 不含可投影 choices，使用同一真实 projector。
2. 断言返回 `OPENING_REPLY_PROJECTION_FAILED`，details 含 `choices.missing` 或对应 issue。
3. 断言没有任何正式写入。

现有 ref/path/重复提交断言继续保留，但不再用不符合真实契约的固定 displayContent mock 证明主成功路径。

补充回归：

1. opening runtime fixture 的 `workspace.read` 对缺文件抛出与 `executeWorkspaceOperation` 一致的 `WORKSPACE_FILE_NOT_FOUND`；默认缺失 legacy contexts 的成功路径必须通过。
2. 非 not-found 读取错误继续拒绝且零正式写入。
3. task compression smoke 断言 checkpoint 摘要位于 pinned unresolved native round 之前，失败 payload 不进入 compressor；同 key 后续成功仍解除 pin。

## 7. 兼容、风险与回滚

- 无 save migration；失败提交此前没有正式写入。
- 保持 error code、choices 限制、clean-save、原子写入与 player context 语义。
- 主要风险是诊断 details 过大或泄露正文；通过字段白名单、数量/长度上限和无预览约束控制。
- Skill 文案风险是加入过多内部概念；只写可执行 gate 和停止条件，并按提示词自包含指南审查。
- 可独立回滚 Skill 文案与 card script/test；平台 projector 无变化。
- checkpoint 只调整已保留消息的顺序，不改变 token 预算、保留轮数、摘要格式或 Tool 协议；可独立回滚。

## 8. 延后项

- 六维属性规则和阶段归属。
- 全局重复 Tool error/stall 的更早中止机制。
- 本次具体小说存档的内容修复或重放。
