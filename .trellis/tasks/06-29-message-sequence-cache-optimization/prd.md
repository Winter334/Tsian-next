# 消息序列缓存命中优化

## Goal

对助手主入口和运行时 Agent 的模型调用消息序列做一次较彻底的缓存友好优化，让稳定前缀尽量长、动态断点尽量靠后，并减少工具循环中无谓重复发送的大块动态内容。

目标不是牺牲 Agent 能力来压 token，而是在保持现有工具、Skill、Agent 协作能力的前提下，让同类调用在后台 prompt/cache 统计中获得更稳定的缓存命中。

## User Context

- 用户观察后台调用记录时发现缓存命中率不稳定。
- 截图显示同一模型 `vercel-zai/glm-5.2` 的请求输入量从约 `1k` 到 `22k` 不等。
- 部分请求缓存命中较高（例如约 `15k`、`17k`、`22k`），但部分大输入请求只命中约 `50` token，说明请求前缀很早发生变化。
- 截图中的“缓存创建”为 `0`，目前只作为现象记录；本任务优先优化消息序列本身，不依赖后台是否单独展示 cache create。

## Confirmed Code Evidence

- 助手/入口 Agent 消息由 `apps/platform-web/src/agent-runtime/index.ts` 的 `buildEntryAgentMessages` 组装。
- 运行时 delegated Agent 消息由 `apps/platform-web/src/agent-runtime/index.ts` 的 `buildDelegatedAgentMessages` 组装。
- Agent 系统提示由 `buildWorkspaceAgentSystemPrompt` 生成，其中包含 `AGENT.md`、可选 `SOUL.md` 和 Runtime 工具说明。
- Runtime 工具说明由 `buildWorkspaceToolInstructions` 生成，会根据权限、联系人、native/text 模式动态变化；其中 `agent_call` 示例当前会嵌入具体联系人 id。
- Agent 工作区上下文由 `formatAgentRuntimeContext` 生成，包含 Agent notes、contextPaths、缺失 contextPaths、可见 Skill Index 等相对稳定内容。
- 原生 function-calling 的工具 schema 由 `apps/platform-web/src/agent-runtime/tool-schemas.ts` 的 `buildEnabledToolSchemas` 生成，并在 `apps/platform-web/src/runtime-host/ai.ts` 的 provider `buildNativeRequestBody` 中随请求发送。
- 工具循环会在每轮后追加 assistant tool calls、tool observations，并通过 `injectActivatedSkillMessagesNative` 注入激活 Skill 的完整 `SKILL.md`，这些内容会增加后续轮次输入。

## Problem Hypothesis

- 当前消息序列中，动态内容可能过早出现，导致后续稳定内容无法被缓存复用。
- `当前问答轮次/当前回合` 与 `Workspace Agent 上下文` 同处一条 message；轮次号每轮变化，会把同条 message 后面的稳定上下文也放到缓存断点之后。
- `system` prompt 中混入了根据权限、联系人、工具模式变化的长工具说明，造成不同 Agent 或不同运行模式下系统前缀变体过多。
- native function-calling 下，API 已有 `tools` schema，prompt 内大量工具示例可能既占前缀又放大动态差异。
- delegated Agent 的调用请求、玩家本轮输入、historyMode 等强动态内容需要明确后置，避免污染目标 Agent 的稳定前缀。
- 小说 AIRP 初始化这类流程会读取 source slice 和 Skill 内容；如果 observation/Skill 注入过大，后续工具轮次会快速膨胀。

## Requirements

- `R1` 稳定前缀最大化：将跨轮稳定的 Agent 定义、固定平台规则、固定工具协议尽量保持在消息序列最前部，并确保字节级顺序稳定。
- `R2` 动态断点后移：将轮次号、本轮输入、调用请求、临时 injection、tool observation、动态 skill 内容等放在尽量靠后的 message 中。
- `R3` 助手主入口优化：优化 `buildEntryAgentMessages` 的消息分层，尤其避免轮次号污染 `formatAgentRuntimeContext` 等稳定上下文。
- `R4` delegated Agent 优化：优化 `buildDelegatedAgentMessages`，让目标 Agent 的稳定定义和上下文优先，调用方请求/玩家输入等动态信息靠后。
- `R5` 工具说明去动态化：减少 prompt 内可变工具示例，native 模式优先依赖 API `tools` schema；如仍需示例，使用占位符而非具体联系人 id。
- `R5a` Function-calling schema 轻量适配：精简冗长 description，保持工具名和参数稳定，仅使用 OpenAI-compatible provider 普遍支持的 JSON Schema 子集；不按 provider 生成不同 schema。
- `R6` 工具循环膨胀控制：识别并优化大块 `SKILL.md`、工具 observation、source slice 在同一 turn 后续轮次中的重复发送方式，避免破坏 Agent 可用性。
- `R6a` Codex 式可续读 observation：小结果可以 inline；大结果应返回 preview + path/ref/range/offset/limit/truncated/total 等续读线索，必要时让 Agent 再读局部，而不是让全文常驻后续轮次。
- `R7` 可观测性：保留或增强 debug 记录，使开发者能看到最终消息顺序、角色、主要段落和输入规模，方便对照后台缓存统计。
- `R7a` 轻量 debug 优先：本任务只增强 AI debug record/console trace 中的消息段落、长度和稳定性标记；后续可升级为专门缓存分析仪表盘。
- `R8` 行为兼容：不删除现有工具能力、Skill 激活流程、Agent 协作能力，不改变 workspace 权限边界。
- `R9` 供应商无关优先：本任务不引入 `cache_control` 等 provider-specific cache hint；后续如需支持 Claude 或其它供应商缓存语义，应按 provider 能力开关区分行为。
- `R10` Text fallback 保留：必须保留 `toolCallMode: "text"`，保证玩家 API 不支持原生工具时仍能正常游玩；未上线阶段无需兼容旧历史数据，但当前 text 协议运行稳定性必须保留。

## Non-Goals

- 不以关闭工具、关闭 Skill、减少上下文到不可用为主要手段。
- 不强依赖某个供应商专有 cache-control 字段；Claude `cache_control` 等供应商专属优化留到后续按 provider 适配。
- 不在本任务中重做完整上下文生命周期或长期记忆系统。
- 不把 AIRP 小说理解流程本身改成假数据或纯前端逻辑。
- 不删除 text 工具调用模式。

## Acceptance Criteria

- [ ] 助手主入口消息序列中，稳定 Agent/Workspace 上下文与动态轮次号、本轮输入分离。
- [ ] delegated Agent 消息序列中，目标 Agent 稳定前缀与调用请求等动态内容分离。
- [ ] native 模式工具说明减少动态示例或使用占位符，避免联系人 id 等可变值进入早期 system 前缀。
- [ ] function-calling schema 经过兼容性/精简型优化，保留必要工具语义，不引入 provider-specific schema 变体。
- [ ] text 模式仍可作为不支持 native tools 的 API fallback，并共享消息分层、工具说明瘦身和可续读 observation 策略。
- [ ] 工具循环中的大块动态内容有明确策略，至少避免不必要重复注入同一 Skill 或无边界地重复发送长 observation。
- [ ] 大型工具结果采用可续读 observation 策略：模型上下文只包含 preview/引用/分页线索，debug/trace 可保留更完整信息用于开发排查。
- [ ] Debug/trace 能辅助比较优化前后的消息顺序和 token/cache 相关现象。
- [ ] 不需要实现完整缓存仪表盘，但保留足够结构化数据供后续 UI 升级。
- [ ] 现有 TypeScript 检查通过，相关 Agent Runtime 行为不回退。

## Open Decisions

- 暂无。

## Decisions

- `D1` Provider-specific cache hints 暂不纳入本任务。当前主要玩家群体使用 OpenAI-compatible provider；Claude `cache_control` 使用人数较少，后续按 provider 区分行为再做适配。
- `D2` 工具 observation 采用 Codex 式可续读策略：小结果 inline，大结果引用化/分页化，保留 path/ref/range/offset/limit/truncated/total 等线索；本任务不做自动语义摘要作为主策略。
- `D3` Native function-calling prompt 大幅压缩，具体参数依赖 API `tools` schema；schema 只做轻量精简与 OpenAI-compatible 兼容性修正，不改变工具名和主要参数语义。
- `D4` 保留 text 模式作为不支持原生工具 API 的 fallback。项目未上线，旧历史数据不作为兼容约束；text prompt/协议可同步瘦身和规范化，但不能删除或破坏当前回合内的工具调用能力。
- `D5` 可观测性先做轻量 debug 数据：记录 message 段落、长度、稳定/动态属性等，供 DebugView/console 查看；完整缓存分析仪表盘留作后续升级。
- `D6` 测试策略：优先为消息序列构造增加少量 focused 单元/fixture 测试，守住稳定段前置、动态段后置、text fallback 协议保留；如果现有测试体系不足，不为本任务单独引入大型测试框架，退化为 debug helper + build + 手动验证。
