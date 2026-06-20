# PRD — 工具补全、命名统一与 schema 优化

> 父任务：`06-19-tool-runtime-performance`。可与子2（token 预算）并行，但 `use_skill`/`run_script` 的 schema 优化依赖子1（解耦重构）完成——子3 先做独立部分，use_skill/run_script 部分等子1 后补。

## 目标与用户价值

让 Tsian 的工具命名与 schema 质量对标主流 agent 框架（ZCode / Claude Code / Codex）：
- **命名简短清晰**：`workspace.read` → `read` 等单词原语，去掉冗余前缀，减少模型决策噪音与 token。
- **补全 glob 工具**：新增按文件名模式递归匹配工具，解决模型找文件需逐层 list 空转的低效。
- **移除冗余工具**：patch（与 write 重叠）、validate（功能太弱）移除，工具列表更精简。
- **schema 质量提升**：补返回值描述 + 复杂工具示例 + 依赖失败后果，让模型预知工具输出，减少"调了才发现不够"的浪费轮次。

## 需求

### R1 工具命名简短化（去 `workspace.` 前缀）

| 当前 | 新名 |
|---|---|
| `workspace.read` | `read` |
| `workspace.list` | `list` |
| `workspace.search` | `search` |
| `workspace.glob`（R2 新增） | `glob` |
| `workspace.diff` | `diff` |
| `workspace.write` | `write` |
| `workspace.move` | `move` |
| `workspace.delete` | `delete` |

- `skill_load` → `use_skill`（子1 改机制时一起改名）
- `action_call` → `run_script`（子1 改机制时一起改名）
- `agent_call` 保留（已是简短 snake_case）
- 涉及：`RUNTIME_WORKSPACE_TOOL_NAMES` 枚举更新、`call.name.startsWith("workspace.")` 类判断改 `workspace_`/新名、tool-schemas.ts 全部 schema name 更新、workspace-operations.ts operation 名映射、buildWorkspaceToolInstructions prompt 示例更新、2b 的 PARALLEL_TOOL_NAMES 更新。
- 破坏性变更（工具名变了，旧对话历史失配）——原型期可接受。

### R2 新增 glob 工具

- 新增 `glob`：按文件名模式递归匹配工作区文件路径，返回匹配路径列表（不含文件内容）。
- 参数：`scope`（同现有）、`pattern`（glob 模式，如 `**/agent.json`、`skills/**/*.md`）、可选 `limit`。
- 行为：递归扫描 scope 内文件路径，按 glob 模式匹配，返回路径列表。
- 只读，纳入并行组（2b 的 PARALLEL_TOOL_NAMES）。
- glob 模式实现自写（避免新依赖），支持 `**`/`*`/`?` 基本通配。
- **与 list 分工**：list 列目录直接子条目（含类型，了解结构），glob 按名模式递归匹配（定位文件）。两者保留，不合并。

### R3 移除冗余工具

- **移除 `workspace.patch`**：与 `workspace.write` 行为相同（description 都说"write or replace"），重叠工具让模型困惑。保留 write，移除 patch。涉及：枚举移除、schema 移除、workspace-operations.ts 的 patch operation 移除（或保留底层 operation 但不暴露为工具）。
- **移除 `workspace.validate`**：功能太弱（只测 JSON/frontmatter 可解析，autoFix 未实现），模型 read 后自判更强。涉及：枚举移除、schema 移除、workspace-operations.ts validate operation 保留底层但不再作工具暴露（或一并移除，视耦合）。

### R4 schema 优化（所有保留工具）

- **补返回值描述**：每个工具 description 补"返回什么"。示例：
  - `read`："Returns the file content as a string. Returns an error if the path does not exist in the given scope."
  - `list`："Returns an array of direct child entries (files and subdirectories) with their names and types."
  - `glob`："Returns an array of matching file paths. Empty array if no matches."
  - `search`/`diff`/`write`/`move`/`delete` 同理补返回值。
- **复杂工具加调用示例**：
  - `agent_call`：补示例（agentId + request + 可选 historyMode 的调用样例）
  - `use_skill`：补示例（name 参数）——**依赖子1 定稿新机制后写**
  - `run_script`：补示例（skill + script + input 参数）——**依赖子1 定稿新机制后写**
- **工具间依赖的失败后果显式化**：
  - `run_script` description 补"Calling before use_skill returns a SKILL_NOT_ACTIVATED error."——**依赖子1 定稿错误码后写**
  - 其它工具的依赖关系若有，同理显式化。
- **命名同步**：重命名后 description 里的工具名引用一起更新（如 read 的 description 不再说 workspace.read）。

## 验收标准

- [ ] 工具命名统一为简短原语：read/list/search/glob/diff/write/move/delete + use_skill/run_script/agent_call。
- [ ] 新增 `glob` 工具，支持 `**`/`*`/`?` 通配递归匹配；实测一次 `**/agent.json` 定位成功。
- [ ] `glob` 纳入并行组，与其它只读工具并行执行。
- [ ] `workspace.patch` 移除（不再作为工具暴露）。
- [ ] `workspace.validate` 移除（不再作为工具暴露）。
- [ ] 所有保留工具 description 补返回值描述。
- [ ] agent_call description 补调用示例 + 定位澄清（子代理，独立运行，结果回传不直接给玩家）。
- [ ] use_skill/run_script description 补示例 + 依赖失败后果（依赖子1 完成后补）。
- [ ] `npm run build`（含 contracts）通过。
- [ ] 真实 API 实测：模型用 glob 一次定位文件成功，命名简短后工具调用顺畅。

## 明确不做

- 不合并 list 和 glob（两者分工保留）。
- 不改 use_skill/run_script 的机制（归子1），本任务只做它们的 schema 文案（且等子1 后补）。
- 不改 agent_call 机制（保留子代理调度），只 schema 澄清。
- 不做工具返回引导性信息（observation 附"下一步建议"）——用户明确不要。
- 不引入 glob 第三方库（自写匹配）。

## 依赖

- 独立部分（命名 + glob + 移除 patch/validate + read/write/list/search/diff/move/delete 的 schema + agent_call schema）：本任务内完成，可与子2 并行。
- use_skill/run_script 的 schema：**依赖子1（tool-skill-decouple）完成**——新机制定稿后才能写准 description 与示例。
