# Skill 详情按需读取 MVP

## Goal

让 Workspace Agent 在运行时可以通过只读虚拟文件系统工具按需读取 Skill 详情。

当前 runtime 已经把可见 Skill Index 注入给 Agent，但 Agent 还没有办法在一次回合中根据 index 自主读取对应 `SKILL.md`。本任务补上这条最小闭环：Agent 先看到 summary/triggers/path，需要详情时调用 workspace 只读工具读取 `SKILL.md` 或相关资源，然后基于 observation 继续产出本轮结果。

## User Value

- Skill 继续保持渐进披露，不把所有 `SKILL.md` 常驻进 prompt。
- Agent 使用统一的 Runtime Workspace 文件工具读取 Skill、README、世界资料和记忆，不引入专用 `skill.load` 协议。
- 后续 Skill 编辑、资源读取、Agent-local Skill 和共享 Skill 都能自然复用同一套文件抽象。

## Confirmed Facts

- Runtime Workspace 是当前存档级数据抽象，Agent、Skill、状态、记忆和前端数据都可以是工作区文件。
- 默认 workspace 已包含 `agents/`、`skills/`、`world/`、`memory/` 等目录。
- `workspace-list`、`workspace-read`、`workspace-search` bridge query 已存在。
- `skill-registry` 已返回轻量 index，包含 `id`、`title`、`summary`、`triggers`、`appliesTo` 和 `path`。
- `skill-detail` bridge query 已存在，但它是外部查询能力；当前默认 `interaction.sendMessage` 还没有让 Agent 在模型回合内使用工具读取文件。
- 当前 runtime 仍是 `master-agent -> narrative-agent` 两次模型调用。
- 当前模型适配层只支持 OpenAI-compatible `chat/completions` 的 `messages`，没有原生 tool calling 参数，也没有 `tool` message role。
- 用户已确认：Skill 详情不需要专用工具，优先让 Agent 通过虚拟文件系统读取。

## Requirements

- 在 Agent Runtime 内提供只读 workspace 工具：
  - `workspace.list`：列出目录下的文件和子目录；
  - `workspace.read`：读取单个 workspace 文件；
  - `workspace.search`：按关键词检索文件路径和内容预览。
- 工具数据源使用本轮传入的 `workspaceFiles`，保持 `agent-runtime` 纯运行时边界，不直接 import Dexie、platform-host 或 bridge。
- 在 Agent prompt 中说明可用工具、参数格式、返回 observation 的方式，以及 Skill 详情应通过读取 `SkillRegistryEntry.path` 对应文件获得。
- 由于当前模型适配层没有原生 tool calling，本任务采用结构化文本工具块作为内部协议，例如：

```md
<tsian-tool-call>
{"name":"workspace.read","arguments":{"path":"skills/example/SKILL.md"}}
</tsian-tool-call>
```

- Runtime 应解析工具块、校验工具名和参数、执行只读工具，并把结果作为 observation 注入下一次同 Agent 模型调用。
- 每个 Agent 调用应有有限工具轮次，避免无限循环。
- 当 Agent 不发起工具调用时，应保持现有 master/narrative 输出行为。
- 工具调用及 observation 不应泄露给玩家可见回复。
- 继续保持普通 Agent 输出为软协议；只在工具调用边界做结构化校验。

## Acceptance Criteria

- [x] master Agent 可以根据可见 Skill Index 通过 `workspace.read` 读取共享 Skill 的 `SKILL.md`。
- [x] narrative Agent 可以根据可见 Skill Index 通过 `workspace.read` 读取 Agent-local Skill 的 `SKILL.md`。
- [x] Agent 可以使用 `workspace.list` 查看目录入口，返回目录项而不是文件全文。
- [x] Agent 可以使用 `workspace.search` 搜索 workspace 文件并获得路径、分数和预览。
- [x] 非法工具名、非法路径、缺失文件或无效参数不会崩溃 runtime，而是作为工具错误 observation 返回给 Agent。
- [x] 工具循环有最大轮次限制，模型持续请求工具时不会无限调用。
- [x] 没有工具调用的普通回合仍保持当前 master -> narrative 行为。
- [x] 最终玩家回复不包含 `<tsian-tool-call>` 工具块或 observation 细节。
- [x] 不引入写 workspace、删除 workspace、执行 action、脚本或远程代码能力。
- [x] `npm run build:web` 通过。
- [x] 如果 contracts 被改动，`npm run build:contracts` 通过。（未改动 contracts，无需执行）

## Out Of Scope

- 原生模型 tool calling 适配。
- 通用 action executor registry。
- 执行 Skill actions、浏览器脚本、远程脚本、HTTP 远程执行或 WASM。
- Agent 创建、编辑、删除 Skill。
- workspace 写入工具。
- `agent.call` 协作。
- UI。
- 自动根据 trigger 预加载 Skill 详情。
- 把 `skill-detail` bridge query 替换成 runtime 主路径。

## Planning Status

- 已确认主方向：Skill 是 workspace 文件，Agent 通过虚拟文件系统只读工具按需读取。
- 推荐 MVP：先做结构化文本工具块和只读工具循环，后续再抽象到原生 tool calling / executor registry。
