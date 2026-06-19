# PRD — 工具体系重构与性能优化（父任务）

## 目标与用户价值

让 Tsian 的 Agent 工具体系对标主流 agent 框架（ZCode / Claude Code / Codex / OpenClaw），消除当前"工具循环 3 轮硬掐 + skill 机制混乱 + 工具命名冗长 + 类别缺失"的结构性体验问题，关乎项目的体验上限。

用户价值：
- **不再被 round limit 卡死**：模型探索路径时不会被 3 轮硬掐，体感对标主流框架（几乎无轮次限制感）。
- **skill 回归纯粹形态**：skill 是"按需触发的脚本能力"，不是"必须手动 load 才能用的中间态"。模型声明意图后框架自动注入 skill 内容，对标 Claude Code。
- **工具命名简短清晰**：`read`/`write`/`glob` 等单词原语，对标主流框架，去掉 `workspace.` 冗余前缀。
- **工具类别补全**：新增 `glob`（按文件名模式递归匹配），解决模型找文件需逐层 list 空转的低效。

## 背景（来自 06-19-ai-streaming-response 实测 + 勘察）

- `maxToolRoundsPerAgent: 3` 在"模型探索空卡片查 Agent"场景耗尽，抛 `reached the workspace tool round limit`，4 轮思考流全丢。主流框架不用硬轮次限制，靠 token/context 预算约束。
- skill 机制做成介于 skill 与 MCP 之间的混乱态：`skill_load` 做"读 SKILL.md 全文 + 注册 action"两件不该捆的事；`action_call` 必须先 load 才能调（两层间接）；action 声明只藏 SKILL.md 围栏里，registry 阶段不解析。
- 4 种 executor 里 2 种冗余/未通：`builtin`（validation/echo，纯内存 toy）、`platform_action`（当前只路由到 workspace 操作，与 `workspace_operation` 重叠）。
- 工具命名 `workspace.read` 这类带前缀+点，非主流且冗长；`workspace.list` 只列单层，缺 glob 类快速定位工具；`workspace.patch` 与 `workspace.write` 行为重叠；`workspace.validate` 功能太弱（只测 JSON/frontmatter 可解析，autoFix 未实现）。
- `contextWindow` 字段已存在于 `BrowserAiModelConfig`，但当前仅作 metadata 不强制（spec 明确"until token-counting prompt-truncation task implements enforcement"）。
- `actionExecutorPolicy` 钩子已预留但 platform-host 未接通（恒 enabled），权限粒度缺失。

## 子任务映射

- **子1：工具与 skill 解耦重构**（`tool-skill-decouple`，先做）— skill 回归"按需触发脚本"形态：`skill_load` → `use_skill`（B 方案：模型声明意图，框架下轮注入 skill 全文 + 注册 action）；`action_call` → `run_script`（直接执行 browser_script，不需预 load）；移除 builtin/platform_action executor；registry 阶段解析 action 声明。**基础，其它子任务依赖它。**
- **子2：限制机制改造**（`tool-token-budget`，依赖子1）— 去 maxToolRoundsPerAgent，改单次请求上下文 token 预算（默认 256k，超限触发压缩）；温和兜底报错，不裸抛"助手不可用"。
- **子3：工具补全 + 命名统一**（`tool-rename-and-glob`，可与子2并行）— 新增 `glob` 工具；工具命名简短化（`workspace.read`→`read` 等，去前缀）；移除 patch/validate；schema 补返回值描述 + 复杂工具示例；agent_call schema 澄清定位。
- **子4：权限策略接通**（`tool-executor-policy`，依赖子1的 executor 精简）— 接通 actionExecutorPolicy，给 browser_script 执行权限粒度（哪些 skill 的脚本可执行）。

子任务各自 prd/design/implement 独立，依赖顺序写在各子任务文档里（Trellis 父子结构不是依赖系统，靠子任务文档显式声明）。

## 跨子任务验收标准（父任务集成层）

- [ ] 子1 完成后：模型调 `use_skill` 声明意图后，框架下一轮自动注入 skill 全文 + 注册 action；`run_script` 直接执行 browser_script 不需预 load；builtin/platform_action executor 移除。
- [ ] 子2 完成后：工具循环可超过 4 轮不报 round limit 错；上下文超 token 预算触发压缩而非抛错；不再出现 `reached the workspace tool round limit`。
- [ ] 子3 完成后：`glob` 工具支持 glob 模式递归匹配；工具命名统一为简短原语（read/write/list/search/glob/diff/move/delete + use_skill/run_script/agent_call）；patch/validate 移除；schema 补返回值描述 + 示例。
- [ ] 子4 完成后：browser_script 执行受 actionExecutorPolicy 约束（非恒 enabled）。
- [ ] `npm run build`（含 contracts）通过。
- [ ] 真实 API 实测：模型在多步探索场景下不被卡死，工具调用体感对标主流框架。

## 明确不做（父任务层面）

- 父任务本身不做实现，只持有需求集 + 子任务映射 + 集成验收。
- 不做 MCP（外部工具注册机制）——本任务只重构内部工具体系，MCP 是未来演进。
- 不做软提示（接近 token 临界值时提醒模型）——后续演进。
- 不做精确 token 计数（MVP 用字符数估算，不引入 tokenizer 依赖）。
- 不做工具返回引导性信息（observation 附"下一步建议"）——用户明确不要复杂引导。
- 不做 action 机制的更深改造（如 action 自动注册成顶层工具）——B 方案保留 skill 组织 action，框架注入。

## 开放问题

- 无（skill 注入机制 B 方案、命名方案、validate/patch 移除、权限纳入子4 均已收敛）。
