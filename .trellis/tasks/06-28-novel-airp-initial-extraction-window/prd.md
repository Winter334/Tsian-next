# 小说 AIRP 初始理解窗口

Parent: `06-27-default-card-novel-reader-airp`

## Goal

在玩家完成小说导入并确认切分结果后，建立“初始理解”步骤：从 source corpus 的前部章节/片段中提取开局所需的基础世界信息，落盘为后续角色设定、开局组装和正式游玩可消费的 workspace 产物。

本任务要解决的问题不是“理解整本书”，而是让系统拥有足够可靠的开局上下文：主要人物、重要地点/势力、基础设定、开局氛围、玩家可选择的原著角色候选，以及给后续 Agent 使用的简洁 brief。

## Confirmed Context

- 父任务规划要求在整书导入后进行初始 source window 抽取，而不是一次性抽取整本书。
- 已完成的导入流程会写入：
  - `save/source/manifest.json`
  - `save/source/chapters.index.json`
  - `save/source/chapters/*.md`
- 已完成的 opening guide UI 已预留步骤：导入小说、初始理解、角色设定、游玩倾向、开局确认。
- 已有产品方向：开局流程采用“向导式 UI + world-architect 对话”的混合形态；结构化选择交给 UI，开放式创作交给 Agent/Skill。
- 父任务既有 Agent 方向：`master`、`world-architect`、`lorekeeper`、`post-processing`；`director` 暂不作为 v0 常驻 Agent，导演能力优先用 world-architect Skill 承载。
- Agent 定义应保持轻量角色定位，不硬绑定大量具体能力；缺能力时通过 Skill 扩展。Agent 可赋予人类职业化身份来稳定判断风格，SOUL.md 可进一步风格化，但 Agent 不应长期记忆路径、schema、脚本细节。
- 前端开发边界仍然是 `apps/play-frontend-dev`，不修改默认 packaged frontend。
- 本任务采用真实 Agent 抽取：由前端开局向导触发 `world-architect` + 开局初始化 Skill，读取初始 source window，生成结构化结果并通过 Skill 脚本落盘；不做纯前端假数据占位。
- 开局初始化和后续世界维护是两个不同流程，不应强行塞进同一个 Skill。初始化 Skill 只负责从导入 source 到开局可用资料的首次建档；后续维护应另设维护 Skill。
- Skill 名称和简介使用中文，方便中文母语玩家阅读和调整。Skill index 的 `name`/`description` 就是 Agent 选择 Skill 的主要依据，不额外设计冗余内部触发条件。Skill 目录/id/action/script 名保持英文 slug，方便路径、代码和调试。
- Skill 脚本应围绕 Agent 的思考流程设计，而不是暴露一组 CRUD 文件写入 API。推荐工具形态为 `inspect_source_opening`、`read_opening_slice`、`commit_opening_understanding`：先观察开头结构，再逐段阅读判断剧情是否足够，最后一次性提交开局理解包。提交工具内置必要校验，例如必填字段、sourceRefs、路径冲突和 JSON 结构。
- 校验应作为 Skill 写入工具的护栏，而不是前端主流程重心，也不应拆成独立“校验工具”让 Agent 额外记流程。前端只负责触发、展示状态和读取完成产物；写入工具发现不正确时把错误反馈给 Agent 让其调整后重试。
- 开局初始化 Skill 负责选择初始 source window。窗口不是按固定章节数或纯文本量决定，而是按剧情充分性判断：读到一段足够支撑开局的连续剧情即可停止，并顺带抽取其中资料。前端只提供导入 source 的索引/manifest 作为触发上下文。
- 前端调用链路定为：前端只调用 `world-architect`，提示其使用 `小说开局初始化` Skill；Agent 完成后，前端读取 `save/understanding/initial-summary.json` 判断完成态并展示摘要。

## Requirements

- `R1` Source window selection：初始理解只读取导入 source 的前部连续剧情窗口。窗口大小不应写死为固定章节数，也不应主要按文本量决定；核心标准是“是否已经得到足够用于开局的剧情”。文本量/章节数只能作为安全上限和工程护栏。
- `R2` Agent extraction：初始理解应通过真实 Agent/Skill 调用执行，前端负责组装触发输入、展示状态和读取结果，不用前端本地假造理解产物，也不把复杂校验放到前端。
- `R3` Extraction output：初始理解应产出后续流程需要的最小信息集合，包括主要人物候选、重要地点/势力、核心设定、开局氛围/冲突、原著角色可选项和简短世界 brief。
- `R4` Skill-assisted persistence：抽取结果必须通过 Skill 提供的通用写入/维护脚本落盘到 save workspace，供刷新恢复、后续步骤和 Agent 读取；Agent 不需要完全理解全部 schema 或路径细节，也不能只把结果留在前端内存。
- `R5` Source references：关键实体和 brief 应保留 source reference，至少能追溯到章节路径和章节序号，避免后续 Agent 空造设定。
- `R6` Frontend step integration：opening guide 的“初始理解”步骤应能展示处理状态和结果摘要；导入完成后可以进入该步骤，而不是永远停留在导入完成占位。
- `R6a` Frontend invocation：前端不直接执行 Skill 脚本，也不手动拼装理解产物；它只通过 `tsian.invokeAgent("world-architect", input)` 触发 Agent，并通过读取 `initial-summary.json` 判断是否完成。
- `R7` Idempotency / resume：如果初始理解产物已存在，刷新后应显示已完成状态；允许在开局未完成前重新执行初始理解以覆盖旧产物。
- `R8` Scope control：本任务不要求抽完整本书、不要求构建完整 schema、不要求生成开局正文、不要求完成玩家角色创建。
- `R9` Opening initialization skill：本任务应设计或创建一个开局初始化 Skill，专门负责首次从 source window 创建开局所需世界资料骨架。
- `R9a` Chinese skill index：Skill index 使用中文名称与简介，简介应简练说明“刚导入小说、开头剧情、初始资料、写入 brief/实体/进度”等关键词；目录/id/action/script 使用英文 slug。
- `R10` Agent-centered script layer：初始化 Skill 内部脚本应贴合 Agent 工作心智，而不是让 Agent 记一串文件写入顺序。最小工具集为查看 source 开头、读取连续剧情切片、提交完整开局理解包；后续维护 Skill 可以复用底层写入逻辑，但不复用初始化流程本身。
- `R11` Write-time validation：开局初始化 Skill 的写入工具应在写入时执行轻量校验；校验失败时不写入或不标记完成，并返回明确错误，让 Agent 修正后重试，而不是让前端尝试修复或补写内容。
- `R12` Agent minimalism：若本任务新增/调整 `world-architect`，只写职业化角色定位、判断边界和 Skill 使用原则，不在 Agent prompt 中硬编码具体路径、schema 或脚本步骤；SOUL.md 可负责更进一步的风格化。

## Candidate Workspace Outputs

初始建议路径，后续 design 可细化；具体路径和骨架创建应由初始化 Skill 使用的脚本封装，避免每个 Agent 都重复记忆路径细节：

```text
save/understanding/initial-window.json
save/understanding/initial-brief.md
save/entities/characters/*.json
save/entities/locations/*.json
save/entities/factions/*.json
save/playthrough/frontier.json
```

其中 `initial-window.json` 记录本次读取了哪些章节；`initial-brief.md` 给后续 Agent 使用；entity 文件使用父任务约定的 frontend-readable ordinary fields：`name`、`brief`、`tags`、`status`、`fields`、`sections`。

## Acceptance Criteria

- [ ] 已导入小说后，opening guide 可以进入“初始理解”步骤。
- [ ] 初始理解会按剧情充分性选择 source 前部连续窗口，并记录窗口覆盖的章节路径/序号。
- [ ] 初始理解由真实 Agent/Skill 调用完成，不使用前端假数据作为最终结果。
- [ ] 初始理解完成后，workspace 中存在可读取的 initial brief 和结构化实体/候选信息。
- [ ] 初始理解产物通过 Skill 写入工具的内置校验；失败时能给出可供 Agent 重试修正的错误信息。
- [ ] 开局初始化 Skill 提供清晰流程说明，专注于首次建档和初始理解产物创建。
- [ ] 初始化 Skill 使用的脚本以 Agent 心智流组织，至少提供查看 source 开头、读取连续剧情切片、提交完整开局理解包三个能力。
- [ ] `world-architect` 如需新增/调整，应保持轻量职业化角色定位；具体初始化流程、路径和校验由 Skill/脚本承载，风格化放在 SOUL.md。
- [ ] 产物包含 sourceRefs，至少指向章节文件和章节序号。
- [ ] 前端能显示初始理解的处理中、完成、失败/可重试状态。
- [ ] 前端通过 `world-architect` 触发初始化，并在 Agent 返回后读取 `save/understanding/initial-summary.json` 判定完成态。
- [ ] 刷新页面后能识别已有初始理解结果并恢复完成态。
- [ ] 开局未完成前允许重新执行初始理解并覆盖旧结果。
- [ ] `npm run build --workspace play-frontend-dev` 通过。

## Out of Scope

- 全书级抽取与增量 frontier refresh。
- 完整 schema 生成和 schema patch 机制。
- 原创角色访谈、原著角色最终选择、游玩倾向完整流程。
- Opening assembly / 第一段剧情生成。
- 默认 packaged frontend 替换或维护。

## Open Questions

None.
