# name-based skill.load MVP

## Goal

把 Skill 按需加载的第二层改成专用 `skill.load` 工具，并让 Agent 使用主流 Skill 规范里更自然的 `name` 来加载 Skill。

上一阶段已经实现了只读 `workspace.read/list/search` 工具循环。这个能力应继续保留，但它更适合作为第三层读取 Skill 资源、参考、示例、schema 或脚本的通用文件工具。Skill 详情本身应由专用工具加载，避免 Agent 必须理解和传递 `SKILL.md` 的虚拟文件路径。

## User Value

- 更贴近主流 Agent / Skill 框架：常驻 Skill Index -> `skill.load(name)` -> workspace 读取资源。
- Agent 只需要记住 Skill 的 `name`，不需要处理 path、id、scope 或 ref。
- 常驻上下文更省 token：Skill Index 面向 Agent 默认不暴露虚拟文件 path。
- 平台可以清楚记录和管控“哪些 Skill 被加载”，为后续 action gating、trace 和 debug 打基础。
- 已实现的 workspace 工具不浪费，转为 `SKILL.md` 引导之后的第三层资源读取能力。

## Confirmed Facts

- 当前 runtime 工具协议使用 `<tsian-tool-call>` 文本块，因为模型适配层尚未支持原生 tool calling。
- 当前支持 `workspace.read`、`workspace.list`、`workspace.search`，并有有限工具轮次。
- 当前 Skill Registry 解析支持 frontmatter `id/name` 和 `summary/description` fallback，但 contract 暴露字段仍是 `id/title/summary/path/scope/agentId/triggers/appliesTo/updatedAt`。
- 当前 runtime prompt 的 Skill Index 会暴露 `path`，并提示 Agent 用 `workspace.read` 读取 `SKILL.md`。
- `loadSkillDetail(files, path)` 已经能返回 `SKILL.md` 正文和资源索引；本任务的 live runtime 主路径应只注入 `SKILL.md` 入口正文，不自动注入资源索引。
- `assembleAgentContext(files, { agentId })` 已经只把当前 Agent 可见的 shared + agent-local Skill 放入上下文。
- 用户已确认：
  - 第二层应使用专用 Skill 工具，而不是 workspace read；
  - Agent 调用专用 Skill 工具时使用 `name`；
  - 消歧逻辑应内置在 Skill 工具中；
  - 第三层资源读取继续使用虚拟文件系统工具。

## Requirements

- 新增或扩展 runtime 工具执行能力，支持：
  - `skill.load` arguments `{ "name": "<skill-name>" }`
  - 继续支持 `workspace.read/list/search`
- `skill.load` 只能加载当前 Agent 可见 Skill Index 中的 Skill。
- `skill.load` 使用 `name` 解析 Skill：
  - 优先匹配 `SkillRegistryEntry.name`；
  - 兼容旧字段时可 fallback 到现有 `id`；
  - 当前 Agent 的 local Skill 优先于 shared Skill；
  - 无法解析或仍有歧义时返回工具错误 observation，不让 Agent 处理 path/ref。
- `skill.load` 返回 Skill detail：
  - Skill 的 `SKILL.md` 正文；
  - 最小加载元信息，例如 loaded skill name；
  - 不自动返回 resource index；
  - 不读取 resource 文件正文；
  - 不执行 actions、scripts、remote code 或浏览器代码。
- 面向 Agent 的 Skill Index 格式改为 `name/description/triggers/applicability` 为主，默认不暴露 path。
- 更新工具说明：
  - 加载 Skill 详情用 `skill.load(name)`；
  - `SKILL.md` 入口正文会说明什么时候读取哪些 references/examples/scripts/schema；
  - 只有执行到这些引用步骤时，才用 `workspace.read/list/search` 读取对应资源。
- 保持普通 Agent 输出是软协议；只在工具调用边界做结构化校验。
- 保持当前 master -> narrative 两个 Agent 步骤，不引入 `agent.call`。

## Acceptance Criteria

- [x] Runtime prompt 中的可见 Skill Index 使用 `name` 和 `description` 展示，默认不包含 `path=`。
- [x] Agent 可以通过 `<tsian-tool-call>{"name":"skill.load","arguments":{"name":"..."}}</tsian-tool-call>` 加载共享 Skill detail。
- [x] Agent 可以通过同样的 `skill.load(name)` 加载自己的 Agent-local Skill detail。
- [x] 当 local Skill 与 shared Skill 同名时，当前 Agent local Skill 优先。
- [x] 不存在的 Skill name 返回结构化工具错误 observation，而不是抛出未捕获异常。
- [x] `skill.load` observation 包含 `SKILL.md` 正文和最小加载元信息，不包含 resource index 或 resource 文件正文。
- [x] `workspace.read/list/search` 保留可用，用于第三层资源读取。
- [x] 最终玩家回复不包含 `<tsian-tool-call>`、`skill.load` observation 或工具细节。
- [x] 不执行 Skill action、脚本、远程代码、浏览器代码或 workspace 写入。
- [x] `npm run build:web` 通过。
- [x] 如果 contracts 被改动，`npm run build:contracts` 通过。

## Out Of Scope

- 原生 provider tool calling。
- action executor registry。
- Skill action schema 解析或执行。
- `agent.call` 协作。
- Skill 创建、编辑、提升为 shared。
- UI。
- 持久化 trace / loaded skills 列表。
- 严格迁移旧存档中的 Skill frontmatter。

## Planning Status

- 主产品方向已确认：使用 name-based `skill.load` 作为 Skill 第二层加载。
- 推荐实现策略：contracts 添加 `name/description` 兼容字段，runtime prompt 隐藏 path，工具内部通过当前 Agent 可见 registry 解析并加载 detail。
- 当前没有阻塞实现的开放问题。
