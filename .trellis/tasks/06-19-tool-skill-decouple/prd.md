# PRD — 工具与 skill 解耦重构

> 父任务：`06-19-tool-runtime-performance`。**基础子任务，子2/子3 的 use_skill/run_script schema 依赖本任务完成。** 先做。

## 目标与用户价值

让 Tsian 的 skill 回归"按需触发的脚本能力"纯粹形态（对标 Claude Code / ZCode / OpenClaw 的 skill 机制），消除当前"skill 介于 skill 与 MCP 之间"的混乱态：

- **skill 不再需要手动 load**：模型声明意图（`use_skill`）后，框架下一轮自动注入 skill 全文 + 注册 action，不需模型先读说明书再调。
- **action_call → run_script**：执行 skill 脚本的工具直接执行 browser_script，不再两层间接（先 load 再 action_call）。
- **移除冗余 executor**：builtin（validation/echo toy）、platform_action（与 workspace_operation 重叠）移除，executor 体系精简为 workspace_operation + browser_script。
- **registry 阶段解析 action 声明**：action 不再只藏在 SKILL.md 围栏里等 skill_load 解析，registry 阶段就解析，让 action 描述在 prompt 可见。

用户价值：skill 调用从"load → action_call"两轮缩为"use_skill → run_script"意图清晰的两步，且 use_skill 后框架自动注入内容不耗模型 round 读文档；工具列表更干净（去冗余 executor）。

## 背景（来自勘察）

- `skill_load`（`workspace-tools.ts:1770`）做两件不该捆的事：①把 SKILL.md 全文作 observation 返回给模型；②把 action 声明注册进 session state（`registerLoadedSkill` `:1256`）。
- `action_call`（`:1811`）必须先 skill_load——`findLoadedSkill` 找不到就抛 `SKILL_ACTION_NOT_LOADED`（`:1833`）。两层间接。
- action 声明只藏在 SKILL.md 的 `tsian-actions` 围栏里（`parseActionDeclarations` `:1106`），registry 阶段（`registry.ts`）只解析 frontmatter 摘要，不解析 action——所以 action 对模型完全不可见直到手动 load。
- 4 种 executor：builtin（`BUILTIN_ACTION_EXECUTORS` `:1570`，只有 validation/echo 纯内存 toy）、platform_action（当前只路由到 workspace 操作 `platform-host:1189`，与 workspace_operation 重叠）、workspace_operation（workspace 读写）、browser_script（Web Worker 执行 skill 目录脚本 `browser-skill-script-executor.ts`）。
- skill 描述进 prompt 是两层：`formatSkillIndex`（`index.ts:343`）列 name/description/triggers 摘要；全文要 skill_load 才进 observation。
- agent_call 与 skill 无直接耦合（`index.ts:838` 独立子代理调度），本任务不动它。
- `actionExecutorPolicy` 钩子预留但未接通（恒 enabled）——归子4。

## 需求

### R1 skill_load → use_skill（B 方案：模型声明意图，框架注入）

- **移除 `skill_load` 工具**，新增 `use_skill` 工具。
- `use_skill(name)` 语义：模型声明"我要用 skill X"。框架收到后：
  - ①把 skill X 的 SKILL.md 全文**注入下一轮 prompt**（不是作 observation 返回，而是框架侧注入上下文）——对标 Claude Code 的框架自动展开。
  - ②解析 skill X 的 action 声明，注册进 session state（供 `run_script` 调用）。
  - 返回值：轻量确认（如 `{ skill: "X", activated: true, actions: ["action1","action2"] }`），不返回 SKILL.md 全文（全文由框架注入下一轮，模型在下一轮上下文里看到）。
- **关键区别**：当前 skill_load 把全文作 observation 返回（模型在 tool result 里看到）；新机制是框架把全文注入下一轮 prompt（模型在下一轮的上下文里看到，更自然，框架可控制注入位置与时机）。
- **注入机制实现**：`use_skill` 的 observation 只返回确认 + action 列表；runtime 在下一轮构建 messages 时，检测 session state 里有新 activated 的 skill，把其 SKILL.md 全文作为额外 system/user message 注入。具体注入位置（system prompt 末尾 / user message 前缀）在 design.md 定。

### R2 action_call → run_script（直接执行 browser_script）

- **移除 `action_call` 工具**，新增 `run_script` 工具。
- `run_script(skill, script, input)` 语义：直接执行指定 skill 的 browser_script 脚本。
  - 参数：`skill`（skill 名）、`script`（脚本标识/路径，相对 skill 目录）、`input`（脚本输入对象）。
  - 行为：解析脚本路径（`resolveBrowserScriptPath` 现有逻辑），起 Web Worker 执行（`runBrowserScript` 现有逻辑）。
  - **前置条件**：skill 必须已 `use_skill` 激活（session state 里有）。未激活返回 `SKILL_NOT_ACTIVATED` 错误。
- **不再支持 builtin/platform_action/workspace_operation executor 的 action_call 调用**：
  - builtin（validation/echo）：无实际价值，移除。
  - workspace_operation：模型应直接用 `read`/`write`/`move` 等顶层工具操作 workspace，不需经 action_call 绕一层。skill 若需 workspace 操作，在 SKILL.md 里指导模型用顶层工具。
  - platform_action：当前只路由 workspace 操作（与 workspace_operation 重叠），移除。未来若有真 platform API，另设机制。
- **影响**：SKILL.md 的 `tsian-actions` 围栏里声明的 action，只有 `browser_script` executor 的会被 `run_script` 执行；其它 executor 类型的 action 声明在 registry 阶段解析后只作"skill 能力描述"展示给模型（"这个 skill 提供这些能力"），但不通过 run_script 执行（builtin/workspace_operation 类的 action 由 skill 指导模型用顶层工具完成）。

### R3 registry 阶段解析 action 声明

- `buildSkillRegistry`（`registry.ts`）或 `assembleAgentContext`（`context.ts`）阶段，不只解析 frontmatter，**还解析 `tsian-actions` 围栏的 action 声明**（`parseActionDeclarations` 提前到 registry 阶段）。
- 解析出的 action 描述（name + description + executor type）挂到 `SkillRegistryEntry` 或 `AgentContextEntry`，在 `formatSkillIndex` 时让模型可见"每个 skill 提供哪些 action"。
- **目的**：模型在 prompt 里就能看到 skill X 提供 action Y（browser_script），决定 use_skill 后就知道能 run_script 什么，不需先 load 才发现。
- **注意**：registry 阶段解析 action 声明需要读 SKILL.md 文件内容（围栏在 body 里），而 registry 当前只读 frontmatter。需在 registry 构建时读 SKILL.md 全文解析围栏——性能影响需评估（design.md 定：是否缓存、是否只对 visible skill 解析）。

### R4 移除 builtin / platform_action executor

- **移除 builtin executor**：`BUILTIN_ACTION_EXECUTORS`（validation/echo）移除，相关执行分支（`workspace-tools.ts:1616-1630`）移除。SKILL.md 若声明 builtin action，registry 阶段标记为"不执行，仅描述"或忽略。
- **移除 platform_action executor**：执行分支（`:1653-1697`）移除，`runPlatformAction` 相关 action 路由移除（workspace 操作改由顶层工具直接做）。`context.runPlatformAction` 是否还需保留供其它路径用，design.md 评估。
- **保留 workspace_operation executor**：虽然 action_call 不再调用它，但底层 workspace operation 仍由顶层工具（read/write 等）使用。executor 类型保留作 skill 能力描述，但不经 run_script 执行。
- **保留 browser_script executor**：run_script 的核心执行路径。

## 验收标准

- [ ] `skill_load` 工具移除，新增 `use_skill`：模型调 `use_skill(name)` 后，框架下一轮自动注入 skill 全文 + 注册 action；observation 只返回确认 + action 列表，不返回全文。
- [ ] `action_call` 工具移除，新增 `run_script`：直接执行 browser_script 脚本，不需预 load；未 use_skill 激活时返回 `SKILL_NOT_ACTIVATED` 错误。
- [ ] builtin executor 移除（validation/echo 不再可执行）。
- [ ] platform_action executor 移除（workspace 操作由顶层工具做）。
- [ ] registry 阶段解析 action 声明，`formatSkillIndex` 让模型可见每个 skill 的 action 列表。
- [ ] workspace_operation + browser_script executor 保留（workspace_operation 作描述不执行，browser_script 经 run_script 执行）。
- [ ] `npm run build`（含 contracts）通过。
- [ ] 真实 API 实测：模型 use_skill 后下一轮能看到 skill 全文，run_script 执行 browser_script 成功。

## 明确不做

- 不改 agent_call 机制（保留子代理调度，schema 澄清归子3）。
- 不做 action 自动注册成顶层工具（MCP 路线）——B 方案保留 skill 组织 action，框架注入。
- 不做 skill 内容全自动注入（A 方案）——采用 B 方案模型声明意图。
- 不改 SKILL.md 的 frontmatter / tsian-actions 围栏格式（声明格式不变，只是解析时机提前 + 执行路径改）。
- 不做 actionExecutorPolicy 接通（归子4）。
- 不改 browser_script 的 Web Worker 执行机制（`browser-skill-script-executor.ts` 不动，run_script 复用现有 runBrowserScript）。

## 依赖

- 无上游依赖（本任务是基础子任务）。
- 下游：子3 的 use_skill/run_script schema 依赖本任务定稿新机制；子4 的权限策略依赖本任务精简 executor 后的范围。

## 开放问题

- use_skill 后 skill 全文注入下一轮 prompt 的**具体位置**：system prompt 末尾 / user message 前缀 / 独立 message？design.md 定。
- registry 阶段解析 action 声明的**性能影响**：需读所有 visible skill 的 SKILL.md 全文（不只 frontmatter）。是否缓存、是否只解析 enabled skill？design.md 评估。
- `run_script` 的 `script` 参数：是 action name（从声明的 action 里找 executor.path）还是直接传脚本路径？倾向 action name（模型用 use_skill 后看到的 action 列表里的 name），run_script 内部映射到 executor.path。design.md 定。
- workspace_operation executor 的 action 声明在 registry 解析后如何展示给模型：作为"skill 建议用顶层工具做 X"的提示，还是完全不展示？design.md 定。
