# world-architect Skill 体系完善与 use_skill 优化

## Goal

完善 world-architect 的 Skill 体系：精简 AGENT.md（流程化内容移入 Skill）；补访谈阶段 Skill + 提交脚本（修复卡在访谈阶段的 bug）；补玩法启用脚本；合并部分 commit 脚本减少 AI 调用轮次；优化 use_skill 机制让 SKILL.md 当轮返回省掉一轮。

## Background · 问题来源

实测发现四个问题：
1. **AGENT.md 含流程化内容**——开局建模步骤、agent_call 编排指令等应在 Skill 里，不该常驻 AGENT.md。
2. **缺访谈 Skill + 提交机制**——Step 4 访谈阶段 agent 自由 write `setup-summary.json`，格式不可控，前端校验不过导致卡住。与 understanding-summary 同类 bug。
3. **玩法启用 Skill 残缺**——agent 要手动 read/parse/write mode.json，应有 `commit_mode` 脚本快速开关玩法。行动裁定 Skill 暂允许空缺（等 `action-resolution-system` 任务）。
4. **初始理解阶段变慢 + AI 调用激增**——7 个 commit 脚本拆太细，每个占一轮 model call；use_skill 下一轮才注入 SKILL.md 又多一轮。

## Design · 改动范围

### 1. AGENT.md 精简

world-architect AGENT.md 只保留岗位定位 + 常驻原则。移入 Skill 的内容：
- "不写开局正文；通过 agent_call 说书人..." → Skill《开局建模》
- "开局建模后通过 agent_call 导演写 brief" → Skill《开局建模》
- 保留："从最小可用模型开始"、"需要源文本时 call 资料员"、"不维护每回合 runtime"等岗位级原则

### 2. 新增 Skill《游玩设定》+ `commit_setup_summary` 脚本

- Skill 职责：引导玩家补齐设定（进入故事方式、金手指、世界因子、玩法三态选择）；确认后提交 setup-summary。
- `commit_setup_summary` 脚本：校验 + 写入 `save/playthrough/setup-summary.json`，结构 `{status: "complete", summary: string, committedAt: ISOString}`。
- 前端 `isSetupSummary` 校验 `status === "pending" | "complete"`（现有逻辑不变，脚本保证格式）。
- prompt `buildPlaySetupPrompt` 改为指示 agent 用 Skill《游玩设定》引导对话 + `commit_setup_summary` 提交。

### 3. 玩法启用 Skill 补 `commit_mode` 脚本

- `commit_mode` 脚本：输入 `{mode: {"<玩法名>": "enabled"|"disabled"|"deferred"}}`，校验值是三态之一 + 写入 `save/playthrough/mode.json`（合并已有键，不覆盖未传入的键）。
- Skill《玩法启用》改写：description 去掉实现细节；正文指示用 `commit_mode` 脚本开关玩法，不手动 read/write mode.json。

### 4. 合并 commit 脚本（7→5）+ prompt 并行引导

合并强相关产物到一个脚本：
- `commit_entities`（独立，其它依赖它）— 保留
- `commit_scenes_and_relationships`（合并 scenes + relationships，都是 ref 校验）— 合并
- `commit_runtime_and_frontier`（合并 runtime + frontier，都是开局状态）— 合并
- `commit_understanding_summary`（独立）— 保留
- `commit_opening_narrative`（独立）— 保留

5 个 commit 脚本代替 7 个，减少 2 轮 model call。

prompt 引导 agent 在一轮内并行调用无依赖的 commit 脚本（如 commit_understanding_summary 和 commit_runtime_and_frontier 无互相依赖）。工具执行层 `write` 组是串行的，但 agent 可以在一轮内发出多个工具调用，框架串行执行后一并返回。

### 5. use_skill 当轮返回 SKILL.md 内容

改 `activateSkillByName`（`workspace-tools.ts:1700-1752`）：
- observation 返回值新增 `content` 字段（SKILL.md 全文）+ `actions` 新增 `inputSchema` 字段。
- 省掉下一轮的 `injectActivatedSkillMessages` 注入——agent 在 use_skill 当轮就看到 SKILL.md + inputSchema，下一轮直接调脚本。
- `collectActivatedSkillContents` 仍保留（兼容已激活但未通过新路径注入的场景），但新路径下 `injectedSkillPaths` 在 `activateSkillByName` 时就标记为已注入。

## Requirements

- R1: world-architect AGENT.md 精简为岗位定位 + 常驻原则；流程化内容移入对应 Skill。
- R2: 新增 Skill《游玩设定》+ `commit_setup_summary` 脚本；prompt 指示用此 Skill 引导访谈 + 提交。
- R3: 玩法启用 Skill 新增 `commit_mode` 脚本；Skill 正文指示用脚本开关玩法。
- R4: 合并 commit 脚本：`commit_scenes` + `commit_relationships` → `commit_scenes_and_relationships`；`commit_runtime` + `commit_frontier` → `commit_runtime_and_frontier`。从 7 个减到 5 个。
- R5: Skill《开局建模》tsian-actions 声明 + 执行步骤同步更新（合并后的 5 个 commit + inspect + read + commit_understanding_summary + commit_opening_narrative = 9 个 action）。
- R6: `activateSkillByName` observation 新增 `content`（SKILL.md 全文）+ `actions` 新增 `inputSchema`；标记 `injectedSkillPaths` 跳过下一轮注入。
- R7: prompt 改动遵循 `ai-facing-content-changes.md` 规范：正面引导，无禁令。
- R8: 行动裁定 Skill 暂不补脚本（等 `action-resolution-system` 任务）；description 和正文可微调但不实现数值系统。

## Acceptance Criteria

- [ ] world-architect AGENT.md 不含开局建模步骤、agent_call 编排指令等流程化内容。
- [ ] 新增 Skill《游玩设定》含 `commit_setup_summary` 脚本 + tsian-actions 声明。
- [ ] Step 4 访谈确认后 agent 调 `commit_setup_summary` 写入 → 前端 `isSetupSummary` 校验通过 → 进入 Step 5。
- [ ] 玩法启用 Skill 含 `commit_mode` 脚本；agent 用脚本开关玩法，不手动 read/write mode.json。
- [ ] commit 脚本从 7 个减到 5 个（scenes+relationships 合并、runtime+frontier 合并）。
- [ ] use_skill 当轮返回 SKILL.md 全文 + inputSchema；下一轮不再重复注入。
- [ ] 初始理解阶段 AI 调用轮次相比当前减少（合并脚本 -2 轮 + use_skill 当轮返回 -1 轮 = -3 轮）。
- [ ] `npm run build:web` 通过。
- [ ] prompt 无禁令（grep 零命中）。

## Dependencies

- `understanding-summary-schema-align` 已归档（脚本基础设施就绪）。
- `opening-multi-agent-orchestration` 已归档（agent_call 编排就绪）。

## Notes

- 行动裁定 Skill 的数值系统脚本留给 `action-resolution-system` 任务，本任务只确保 Skill 不报错（空 Skill 正文可接受）。
- design.md 需详细设计：合并脚本的 API 签名 + use_skill observation 改动 + Skill《游玩设定》内容 + AGENT.md 精简后的内容。
