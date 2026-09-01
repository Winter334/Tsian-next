# 游玩设定步重构

## Goal

在素材库模型下重构开局向导 Step 4「游玩设定」与 Step 5「开局确认」过渡，使其不再延续已移除的 `mode.json` /「玩法启用」/导演 brief 语义。玩家完成角色设定后，world-architect 通过简短访谈收集有真实消费者的开局设定（永久特殊能力写入 `character.traits[]`），整理成小说简介式 `setup-summary`，调用 storyteller 生成开局正文与初始行动选项，通过单一 Skill action 一次落盘。开局正文不在 Step 4 对话界面提前展示，只留给 StoryView。

## Background / Confirmed Facts

### 父任务上下文

- 本任务是父任务 `07-06-agent-roster-progressive-refactor` 的子任务 C，范围限定为 Step 4 游玩设定 + Step 5 开局确认过渡。
- 父任务架构方向是素材库模型：小说是素材库不是剧本；玩家剧情是主体；导演和 brief 已移除；timeline 只作素材检索锚点。
- 依赖 B（导演/brief 移除 + timeline 建立）已完成。
- 父任务原则：AGENT.md 写定位与方法论不写步骤；SOUL.md 写人格底色不绑步骤；Skill 正文写流程；已处理 Agent 不回头大改，只按当前步骤补充需要的职责和能力。

### 前端现状

- Step 4 调用入口 `apps/play-frontend-dev/src/composables/useSetupState.ts:560`：首次进入用 `buildPlaySetupPrompt(...)` 生成 prompt 并 `invokeAgent("world-architect", ..., { purpose: "opening-play-setup", contextSlot: "play-setup", persist: true })`。
- Step 4 prompt 旧残留 `apps/play-frontend-dev/src/lib/source.ts:465,470`：仍要求三态玩法系统选择，仍指向已删除的 Skill《玩法启用》与 `commit_mode`。
- 完成态由 `save/playthrough/setup-summary.json` 决定（`useSetupState.ts:673`），`status === "complete"` 时放行 Step 5。
- `opening-narrative.json` 进入 StoryView 后由 `useTsian.loadOpeningNarrative()` 读取并特殊渲染为第一条正文（`useTsian.ts:331`）。
- 初始行动选项从 `play-setup` context slot 最后一条 agent 回复的 `[[选项]]` 恢复（`useTsian.ts:362 loadPlaySetupOptions`）。
- `PlaySetupDialog.vue` 中 `StoryOptions :disabled="status === 'running' || status === 'complete'"`，但选项内容仍会显示。
- Step 5 `OpeningConfirm.vue` 只展示 `playSetupSummary`，不展示开局正文全文。

### 默认模板现状

- `commit_setup_summary` 写 `{ status, summary, committedAt }`，summary 非空 ≤ 2000 字（`workspace-templates.ts:529`）。
- `commit_opening_narrative` 写 `{ narrative, createdAt }`（`workspace-templates.ts:509`）。
- `PLAY_SETUP_SKILL_MD` 当前引导入口/金手指/世界因子，收尾 agent_call storyteller 拿开局正文（`workspace-templates.ts:550`）。
- world-architect `AGENT.md` 已在前置 Understanding 步重构过，原则含「不写玩家正文」「只在当前游玩确实需要时增加字段」。
- world-architect `agent.json` skills 已启用《开局建模》与《游玩设定》。

### agent_call 机制

- 被调用 Agent 拿自己的 AGENT/SOUL/contextPaths/tools + 调用方提供的 contextSummary/request/expectedOutput。
- 被调用 Agent 不会自动拿到前端正式回合的 runtime/scene/protagonist injection；调用方需在 request/contextSummary 中提供必要上下文。
- storyteller 当前 `contextPaths = ["README.md"]`，不读 setup-summary / opening-narrative。

### storyteller 现状

- `AGENT.md` 已写「玩家正式回合入口，读 runtime/schema/可见实体资料写正文和选项；信息不足 call 资料员；不维护 runtime/entity/schema」。
- 其正式回合重构留给后续子任务 D；本任务不改 storyteller AGENT/SOUL/Skill/Tool。

## Requirements

### 清理旧语义

- R1: 清理 Step 4 前端 prompt 中已无效的 `mode.json` / 三态玩法系统 / Skill《玩法启用》/ `commit_mode` 语义。
- R2: 重写 world-architect 的 Skill《游玩设定》，使其符合素材库模型与当前 Agent 分层。
- R3: Step 4 仍必须支持多轮对话、`[[选项]]`、自由输入、刷新/返回后的 context slot 恢复，以及 `setup-summary.json` 完成态恢复。

### 访谈设计

- R4: 访谈不强制询问抽象「故事调性」。任何访谈项都必须能说明后续消费者：要么写入稳定数据并进入正式回合上下文，要么直接用于生成开局正文/初始选项，要么只作为 Step 5 展示内容；不会被后续 Agent/前端读取并改变行为的偏好不应收集。
- R5: 访谈不要求玩家决定原著剧情切入点。玩家未必知道原著信息；开局钩子由 Agent 根据玩家设定与已读开局素材安排。原著角色默认沿用原著开局；原创角色由 Agent 合理嵌入世界；金手指或 `traits[]` 可影响开局呈现。
- R6: 访谈问题不得只抛裸问题；每个关键问题都应附带常见选项或回答模板，方便玩家组织语言，也方便 world-architect 写入 summary / traits / opening narrative。
- R7: 收集到足够信息后，不由 Agent 先汇总成小说简介让玩家确认；改为直接询问玩家「还有补充 / 修改 / 直接开始」。`setup-summary` 的小说简介式内容在玩家选择开始后写入，并由 Step 5 展示。

### 永久特质 schema

- R8: 需要结构化数据、裁定逻辑或前端 UI 配合的玩法系统不由 Step 4 直接落成；这类能力应由高级玩家或后续开发以明确 schema + 前端 UI + 消费者链路实现。Step 4 只能把相关偏好记录为自然语言创作约束，或在已有稳定 schema（如 `traits[]`）能表达时写入该 schema。
- R9: 本任务应在访谈阶段确立并写入永久性特殊能力的稳定数据字段（特殊体质、天赋、系统、血脉、命格等），因为 Step 4 已直接收集这类玩家核心设定。该字段必须有明确的 Agent 消费者（setup summary、opening narrative、后续叙事上下文），但不在本任务新增前端 UI，UI 留给后续真正进入游戏界面的渐进重构步骤。
- R10: 字段方案为 `character.traits[]`，每项最小形态为 `{ id, name, description?, effects? }`；`description` 表达特质本身的设定说明，`effects` 为字符串数组，表达具体可用效果、限制或叙事影响（如「能够堪破虚妄」「心神不受外力影响」）。`traits[]` 表示永久性稳定特质，不等同于 `status[]`（当前临时状态）。

### 收尾与落盘

- R11: Step 4 收尾采用 world-architect 的单一专用 Skill action（暂名 `commit_play_setup`）一次校验并写入主角 `traits[]`、`setup-summary.json` 与 `opening-narrative.json`，避免分散脚本造成半写入或正文提前泄露到 Step 4 UI。
- R12: 玩家确认设定后必须生成并写入 `opening-narrative.json`，供进入 StoryView 后作为开局正文展示。开局正文应由 storyteller 生成，world-architect 只负责调用与落盘。
- R13: `opening-narrative.json` 写入后，不应在 Step 4 对话界面把开局正文提前展示给玩家；开局正文只在进入 StoryView 后作为第一条正文展示。
- R14: Step 4 收尾必须让 storyteller 生成开局正文时同时给出 3～5 个初始行动选项；`opening-narrative.json` 只保存干净正文，初始选项通过现有 `play-setup` context slot 中最后一条 world-architect 回复的 `[[选项]]` 继承到 StoryView。
- R15: `setup-summary.json` 的 `summary` 内容应是玩家可读的本次故事简介，类似小说简介 / 开局简介，而不是字段清单、规则配置或后台操作笔记。

### Step 5

- R16: Step 5 保持过渡入口定位，不把开局正文全文提前展示到确认屏；确认屏继续只展示设定摘要与进入故事动作。

### Agent 职责边界

- R17: 本任务不改 world-architect 的 AGENT/SOUL（已在前置 Understanding 步重构过）；只调整其 Skill《游玩设定》及专用 action。
- R18: 本任务不改 storyteller 的 AGENT/SOUL，不新增 storyteller 专用 Skill / Tool。storyteller 在 Step 4 中的参与复用其通用叙事职责；开局正文生成的具体流程指令放在 world-architect Skill《游玩设定》与 `agent_call` request/expectedOutput 中。storyteller 的完整正式回合重构留给后续子任务 D。

### 禁止项

- R19: 本任务不得重新引入 director/brief，不新增 `mode.json` 或等价软开关字段，不新增尚未明确消费者的结构化玩法字段。
- R20: 本任务不得扩展到正式玩家回合 storyteller/researcher 重构，也不实现回合后 worldTime 维护或 frontier 推进触发。

## Acceptance Criteria

- [ ] `buildPlaySetupPrompt` 不再包含 `mode.json`、三态玩法系统、Skill《玩法启用》或 `commit_mode` 指令。
- [ ] 默认模板的 Skill《游玩设定》描述、triggers 和正文只描述 Step 4 设定访谈、确认、摘要提交、storyteller 生成开局正文与 `opening-narrative` 落盘，不包含旧模型的导演/brief/mode 语义。
- [ ] Skill《游玩设定》中的访谈问题使用通俗问题 + 选项/回答模板，不要求玩家知道原著剧情节点，也不强制询问抽象调性。
- [ ] 信息收集齐后，Step 4 只询问玩家是否还有补充、要修改，或直接开始；不在对话中先展示小说简介式 summary 供确认。
- [ ] 默认模板 schema 文档与 play-frontend-dev 类型/解析支持 `character.traits[]`，字段形态为 `{ id, name, description?, effects? }`，并明确它表示永久性特殊能力/体质/天赋/系统等稳定特质，不等同于 `status[]`。
- [ ] 后续叙事上下文注入（`formatProtagonistBlock`）能把主角 `traits[]` 注入给 storyteller 消费；本任务不新增 traits 前端 UI。
- [ ] `commit_play_setup` Skill action 一次校验并写入主角 `traits[]`、`setup-summary.json` 与 `opening-narrative.json`；脚本返回值不包含 `opening-narrative` 正文，避免 Step 4 UI 提前展示。
- [ ] `commit_setup_summary` 的写入契约仍能让 `useSetupState` 将 Step 4 标记为 complete，并让 Step 5 展示设定摘要；摘要文风是类似小说简介的玩家可读开局简介。
- [ ] `opening-narrative.json` 在 Step 4 收尾后包含非空 narrative，进入 StoryView 后可由现有 `loadOpeningNarrative()` 读取并特殊渲染；Step 4 对话界面不提前展示开局正文。
- [ ] Step 4 最后一条 world-architect 回复保留 storyteller 提供的 3～5 个 `[[选项]]` 初始行动选项，进入 StoryView 后这些选项可由现有 `loadPlaySetupOptions()` 恢复。
- [ ] Step 5 的「返回设定 / 进入故事」过渡行为保持不倒退。
- [ ] 父任务的流程地图与 Agent / Skill / Tool Ledger 在本子任务完成后更新为 C 已完成，并记录 Step 4 后的职责边界。
- [ ] 必要检查通过，至少覆盖 play-frontend-dev 与 platform-web 默认模板相关类型/构建检查。

## Out of Scope

- 正式玩家回合中 storyteller/researcher 如何使用素材、检索 timeline 或推进 frontier（子任务 D）。
- 回合后 stage-manager 维护 `runtime.worldTime` 与前端触发 frontier 推进（子任务 E）。
- `character.traits[]` 的前端 UI 展示（留给后续真正进入游戏界面的渐进重构步骤）。
- storyteller AGENT/SOUL/Skill/Tool 的正式回合重构（子任务 D）。
- world-architect AGENT/SOUL 改写（已在前置 Understanding 步完成）。
- 新增后台 agent_call 平台能力或异步 agent 调用机制。
- 重新引入 director、brief、`mode.json`、玩法软开关或无消费者字段。
- 玩家偏好的长期上下文注入机制（如将「不想要的内容」持续注入 storyteller）；若需要，另立任务。

## Notes

- `commit_setup_summary` 和 `commit_opening_narrative` 旧脚本在本次由 `commit_play_setup` 替代后，可保留在默认模板中供兼容/开局建模引用，但 Skill《游玩设定》正文只引导用新 action。
- 访谈问题中「不想要的内容」只影响开局正文一次性消费，不作为必问项；若玩家主动表达，world-architect 吸收进 storyteller 的 `agent_call` request 中，但不承诺持续影响后续正式回合。
