# Agent Call MVP

## Goal

实现通用 `agent_call` runtime tool，让 Runtime Workspace 中的 Agent 可以按 `AGENT.md contacts` 自然协作，形成可配置、可替换、可扩展的 AIRP Agent 团队。

MVP 重点不是做显式 `team.json`、复杂 team mode，或复刻代码助手里的“子代理写代码”。Tsian 的 `agent_call` 更像 AIRP 回合内的角色会诊 / 委托：master、narrative、memory、state、rules、critic 等运行时角色按业务关系短暂参与当前回合，并把建议、判断、草案或状态维护结果作为 observation 返回给调用方。

## User Value

- 作者可以通过编辑 `AGENT.md contacts` 和 Agent 定义组装自己的 Agent 团队。
- master 可以按需调用 state、memory、rules、critic、narrative 等专业 Agent，而不是把所有能力塞进一个提示词。
- Agent 协作过程可被 trace 回溯，便于定位哪个 Agent 给出了建议、修改状态或影响剧情。
- 借鉴主流 Agent 框架中“specialist agent”的优点，但按 AIRP 需求改造为叙事/状态/记忆/规则协作，而不是代码任务拆分。
- 默认工作区提供 `memory` Agent，作为 `agent_call` 的低风险示例专业 Agent，让默认体验能体现 AIRP 团队协作价值。

## Confirmed Facts

- 方向文档明确：Agent 协作通过联系人声明和 `agent_call` 自然形成，不使用显式团队配置作为主模型。
- `AGENT.md` frontmatter 已支持 `contacts`，`buildAgentRegistry` 会解析为 `AgentRegistryEntry.contacts`。
- `assembleAgentContext` 已能按 agent id 组装目标 Agent 的 `AGENT.md`、notes/session、context files 和轻量 Skill Index。
- 当前 live Agent Runtime 固定运行 `master-agent` 和 `narrative-agent` 两个步骤。
- 默认 Runtime Workspace 当前只包含 `master` 和 `narrative` Agent；MVP 需要新增 `memory` Agent 来验证非固定步骤的 Agent 协作。
- 当前 runtime 工具支持 `skill_load`、`action_call`、`workspace_read`、`workspace_list`、`workspace_search`。
- `action_call` 已有 loaded Skill gating、输入 schema 校验和 executor routing。
- 当前 executor 类型包括 `builtin` 和 `platform_action`；`agent_call` 可以接入 action executor，也可以作为核心 runtime tool。
- Runtime trace 已能记录 turn、agent step、model call、skill load、workspace tool、action call 和 workspace mutation。
- `AgentRuntimeModelCallOptions.debugLabel` 当前只允许 `"master-agent" | "narrative-agent"`，要支持任意被调用 Agent 需要放宽或新增 debug label 生成逻辑。
- `agent-runtime` 不能导入 Dexie、platform-host 或 bridge；模型调用和平台能力必须通过 capability 注入。

## AIRP-Specific Design Direction

- `agent_call` 是回合内的受控协作动作，不是长期任务队列，也不是并行团队常驻模式。
- 被调用 Agent 是 Runtime Workspace 里的可配置角色，可能负责剧情节奏、连续性、世界状态、规则判定、记忆摘要、NPC 反应或审校。
- 调用方不应手工复制大量上下文；平台根据目标 Agent 的 `AGENT.md`、`contextPaths`、notes/session、Skill Index 和当前回合摘要自动组装目标上下文。
- 被调用 Agent 不直接面向玩家提交最终回复；它返回建议、判断、草案、状态维护结果或下一步建议，由调用方决定如何使用。
- AIRP Agent 需要读取和维护工作区数据，因此目标 Agent 应能使用自己的 workspace tools / Skill / action 能力；但 MVP 先禁止嵌套 `agent_call`，避免循环与成本失控。
- contacts 表示业务可承接关系，不是安全边界模型；平台仍用 contacts、深度、次数和 trace 保证运行时稳定性。

## Runtime Tool Decision

- 推荐将 `agent_call` 实现为一等 runtime tool，而不是 `agent-call` Skill 内的 action executor。
- 原因：Agent 协作是 AIRP runtime 维护虚构故事世界的基础能力，类似 `skill_load` 和 workspace tools，是协作基建而不是可选业务 Skill。
- `agent_call` 仍不应无边界常驻滥用：
  - 只有当前 Agent 声明了 contacts 时才在工具说明中曝光；
  - 只能调用 contacts 中的目标 Agent；
  - 只暴露目标 Agent 的 id/title/summary/contact reason，不暴露全部团队细节；
  - 由平台限制每回合调用次数、嵌套深度和目标 Agent 工具轮数；
  - 所有调用写入 trace。
- 可选的协作指导仍可以通过 `AGENT.md` 或未来的 Skill 表达，但调用机制本身应是 runtime primitive。

## Tool Boundary Standard

Tsian 不应因为 Web 端没有 Bash 就把所有可能能力都做成平台内置工具。工具体系应分层：

1. Platform runtime primitives
   - 平台基础能力，数量少、稳定、跨玩法通用。
   - 标准：需要 runtime 内部状态 / 模型调用 / 上下文组装 / trace / checkpoint / workspace 索引 / Agent registry 才能正确执行；或 Skill 无法自行实现。
   - 例子：`skill_load`、`agent_call`、`workspace_read`、`workspace_list`、`workspace_search`、基础 `action_call`。
2. Platform controlled actions / executors
   - 平台受控执行层，不一定常驻暴露给 Agent。
   - 标准：涉及副作用、浏览器限制、远程调用、脚本执行、workspace 写入、前端约定数据变更、abort/timeout/结果归一化。
   - 例子：`workspace-write`、`workspace-delete`、未来 browser script、remote HTTP、WASM、托管执行。
3. Skill actions
   - 可替换、可扩展、可分发的业务能力。
   - 标准：能力逻辑依赖具体玩法、世界设定、数据结构、规则系统、记忆策略、叙事风格或作者偏好；可以用平台 primitives / controlled actions 组合出来。
   - 例子：世界状态维护、关系更新、记忆压缩、规则裁判、战斗结算、剧情审校、风格改写。
4. Workspace data and README / schemas
   - 数据结构与玩法约定放在 workspace 文件里，让 Agent、Skill 和前端解耦。

判断一个能力是否应做成 runtime tool：

- 如果没有它，Agent 无法可靠发现、加载或联系其它能力，它倾向 runtime primitive。
- 如果它跨所有玩法都成立，且需要平台内部信息才能安全执行，它倾向 runtime primitive。
- 如果它只是把多个基础动作包装成更高层业务流程，它倾向 Skill action。
- 如果它会改变世界状态但语义由玩法决定，它倾向 Skill action 调用平台 controlled action，而不是平台直接理解玩法。
- 如果它是可替换策略，例如“怎么总结记忆”“怎么判定关系变化”，它倾向 Skill。

## History Context And Cache Direction

- AIRP 原始剧情正文可能很长，不应默认完整注入每个 Agent 或每次 `agent_call`。
- 原始对话 / 剧情正文仍应作为存档数据保留，用于回放、导出、debug 和未来重建摘要。
- Runtime prompt 应使用分层上下文包：
  - 稳定前缀：平台 guard、工具说明、目标 `AGENT.md`、目标 Skill Index、稳定 workspace README / schema。
  - 冷上下文：已沉淀的剧情 timeline、长期记忆摘要、世界事实、角色/地点/关系文件。
  - 热上下文：当前场景摘要、最近少量原文回合、本轮玩家输入、调用方 request / reason。
  - 按需上下文：通过 workspace search/read 读取的相关原文片段或具体文件。
- 为提高 prompt cache 命中率，稳定和较少变动的内容应排在 prompt 前部；本轮输入、最近原文、tool observation 和 `agent_call` request 应排在末尾。
- 避免在稳定前缀中加入 timestamp、随机 id、动态计数、每轮改写的长摘要或重新编号的完整历史。
- 历史沉淀应倾向拆分为 append-only 或分段文件，例如 `history/timeline.md`、`memory/summaries/current.md`、`memory/summaries/long-term.md`、未来的 `history/scenes/*.md`，而不是每回合改写一个超大历史块。
- 不同 Agent 应使用不同历史策略：narrative 需要当前场景摘要和最近原文；memory 需要更长历史和摘要维护；state/rules 通常只需要世界事实、规则和本轮相关片段。
- `agent_call` 的历史窗口不应是不可变全局常量，也不应让模型精确控制消息数量。MVP 只暴露语义化 `historyMode`：
  - `minimal`：尽量不带原文，只给当前请求、摘要和目标 Agent context。
  - `recent`：默认模式，带少量最近原文。
  - `scene`：带当前场景所需的较多近期原文。
  - 具体消息数量、上限和目标 Agent 差异由平台内部策略决定，避免参数膨胀、成本失控和缓存破坏。

## Mainstream Agent Patterns To Borrow Carefully

- 子代理上下文隔离：被调用 Agent 使用自己的 `AGENT.md` 和 context，不继承调用方全部消息。
- 明确委托任务：父 Agent 提供 task/context summary，子 Agent 返回一次性结果。
- 父 Agent 汇总：被调用 Agent 不直接面向玩家提交最终回复，调用方决定如何使用结果。
- 按需调用：不把团队全部常驻注入，只在需要时通过 action 调用。
- 可观测性：记录 delegation 的 target、输入摘要、输出摘要、错误和耗时/轮次。
- 熔断边界：限制每回合调用次数、递归深度和单次子 Agent 工具轮数，避免循环和成本失控。

## Mainstream Patterns Not To Copy Directly

- 不采用代码助手式“把文件系统任务派给 worker 并期待其提交 patch”的主模型。
- 不做所有 Agent 常驻同一 prompt 的 team mode；AIRP 回合上下文会随游玩变长，常驻团队容易膨胀。
- 不把每次协作都写成 handoff 文件；即时协作走 observation，长期价值内容才写入 workspace。
- 不要求目标 Agent 输出严格 schema；普通 Agent 输出仍由 `AGENT.md` 和 Skill 指导，硬校验只在工具/action 边界。

## Requirements

- 新增核心 Runtime Workspace tool：`agent_call`。
- 新存档默认包含 `agents/memory/AGENT.md`、`agents/memory/notes.md` 和 `agents/memory/session.jsonl`。
- 默认 `master` Agent 的 contacts 包含 `memory`，并在 `AGENT.md` 中说明何时联系 memory Agent。
- 默认 `memory` Agent 聚焦连续性、当前场景摘要、长期记忆建议和需要沉淀的事实提示；MVP 不要求它自动写回长期记忆文件。
- `agent_call` tool arguments 包含：
  - `agentId: string`
  - `request: string`
  - `reason?: string`
  - `contextSummary?: string`
  - `expectedOutput?: string`
  - `historyMode?: "minimal" | "recent" | "scene"`
- `agent_call` 只能调用当前 Agent `contacts` 中声明的目标 Agent。
- 目标 Agent 必须存在于当前 Runtime Workspace 的 Agent registry 中。
- 目标 Agent 使用自己的 Agent context 和轻量 Skill Index，并获得当前回合的必要共享上下文摘要。
- `agent_call` 不应把完整历史剧情正文作为默认输入；目标 Agent 默认获得分层上下文包和较短 recent window，必要时通过 workspace tools 按需读取历史片段。
- `historyMode` 缺省为 `recent`；具体 recent window 大小是平台策略，不作为 `agent_call` 入参暴露。
- 被调用 Agent 的输出作为 structured observation 返回给调用方，不直接成为玩家回复。
- MVP 中被调用 Agent 可以使用 workspace tools、`skill_load` 和非 `agent_call` 的 `action_call`，以便 memory/state/rules 等 AIRP Agent 能读取和维护数据。
- MVP 中禁止被调用 Agent 再发起嵌套 `agent_call`；后续可以在 trace 和成本控制成熟后开放有限递归。
- MVP 必须设置防循环边界，例如最大调用深度、每回合最大 agent_call 次数、每次被调用 Agent 最大工具轮数。
- trace 必须记录 `agent_call` 的 target、caller、ok、输入摘要、输出摘要和错误。
- 不做 UI。

## Acceptance Criteria

- [x] 当前 Agent 有 contacts 时，runtime tool instructions 暴露 `agent_call`。
- [x] 当前 Agent 没有 contacts 时，`agent_call` 不应鼓励可用；直接调用返回结构化错误。
- [x] 新存档默认包含 `memory` Agent，且 master contacts 包含 `memory`。
- [x] 当前 Agent 可以通过 `agent_call` 调用 contact Agent。
- [x] 调用非 contact Agent 返回结构化错误 observation，不发起模型调用。
- [x] 调用不存在的 Agent 返回结构化错误 observation。
- [x] 被调用 Agent 使用自己的 `AGENT.md` / context / Skill Index。
- [x] 被调用 Agent 可以使用 workspace tools / Skill / 非 `agent_call` action。
- [x] 被调用 Agent 尝试嵌套 `agent_call` 时返回结构化错误。
- [x] 被调用 Agent 的结果作为 observation 回到调用方，不直接写入玩家历史。
- [x] `agent_call` 受最大深度 / 次数限制保护，超过限制返回结构化错误。
- [x] trace 包含 `agent_call` 成功和失败摘要。
- [x] `npm run build:web` passes。
- [x] `git diff --check` passes。

## Out Of Scope

- 显式 `team.json` 或 Team UI。
- 并行多 Agent 调用。
- 长期 Agent session/notes 自动写回。
- memory Agent 自动维护长期记忆文件。
- 跨回合任务队列。
- 远程 executor / 浏览器脚本 executor。
- 强制 schema 化普通 Agent 输出。

## Open Questions

- None. Planning is ready for user review before `task.py start`.

## Resolved Scope Decisions

- MVP 不新增“协作规范 Skill”。先把何时使用 `agent_call` 写入默认 `master` / `memory` 的 `AGENT.md`，避免过早把协作策略抽象成可分发 Skill。
- `agent_call` 是一等 runtime tool，而不是 Skill action。
- MVP 默认新增 `memory` Agent，用来验证非固定 master -> narrative 的 AIRP 协作。
- MVP 暴露 `historyMode`，不暴露精确 recent message 数量。
- MVP 允许目标 Agent 使用 workspace tools / `skill_load` / 非 `agent_call` 的 `action_call`，但禁止嵌套 `agent_call`。
