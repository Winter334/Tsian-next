# Agent 工具机制：类 MCP 工具发现与卡定制层

## Goal

为 Tsian Agent 引入一种"类 MCP 工具"能力发现层，补上现有 Skill 机制缺失的一环：让确定性原子能力（如 `roll_dice`、`calculate_expression`、`resolve_entities`）以工具形式直接暴露给 Agent，无需 `use_skill` 激活 + 等待下一轮 + 读 SKILL.md 才能调用。同时为不同游戏卡提供工具定制层，允许卡作者用领域专用工具替代通用顶层工具，实现更契合、效率更高的 Agent 行为。

本任务是平台层基础设施，不挂 `07-04-airp-agent-roster-skills` 下，因为工具机制服务所有游戏卡，不专属 novel AIRP。

## Background

### 现状

当前 Agent 能力发现是**单层 Skill 驱动**：

- `use_skill(name)` 激活 Skill → 下一轮注入 `SKILL.md` → Agent 读文档学会"调哪个 `run_script`、传什么参数"
- `run_script(skill, script, input)` 三段式调用 Skill 内部声明的 `browser_script` action
- 脚本是 Skill 的实现细节，不是 Agent 的直接能力界面

这导致几个问题：

1. **简单原子能力也要 Skill 包装**——`roll_dice` 这种参数明确的脚本，也要先 use_skill 激活、等一轮、读 SKILL.md，调用成本高
2. **跨 Agent 复用靠同名 Skill 各写一份**——说书人/场记/世界架构师都用 `roll_dice`，但要在各自 Skill 里重复声明
3. **参数校验靠文档文字描述**——SKILL.md 写"请传 sides 数字"，模型传错只能运行时报错
4. **卡作者无法用领域工具替代通用工具**——某卡想让说书人用 `query_lore` 而不是 `workspace_semantic_search`，目前只能靠 SKILL.md 文档指导，无法在工具层替换

### Skill 与 Tool 的职责区分

| | Skill | Tool |
|---|---|---|
| 本质 | 流程编排文档 | 原子能力界面 |
| 发现 | Skill Index → use_skill → 等下一轮 → 注入 SKILL.md | 工具列表直接注入 system prompt，原生 function calling |
| 调用 | `run_script(skill, script, input)` 三段式 | `tool_name(input)` 直接 |
| 校验 | 脚本 inputSchema（运行时） | 工具 paramSchema（模型生成时） |
| 上下文成本 | 激活后注入整个 SKILL.md | 只注入 name + description + paramSchema |
| 适用 | 需要流程文档教 Agent "何时做、按什么顺序" | 参数明确、跨场景复用、不需要流程文档 |

**两者共存，不互相替代**：Skill 引用 Tool（"遇到不确定性时调 `roll_dice` 工具"），Tool 不需要 Skill 包装就能直接调。

## Requirements

### R1: 目录结构

- 公共工具目录 `tools/`，工具被所有 Agent 共享。
- Agent-local 工具目录 `agents/<agent>/tools/`，只被该 Agent 发现并使用。
- 对称于现有 Skill 组织方式（`skills/` 公共 + `agents/<agent>/skills/` Agent-local）。

### R2: 工具声明契约

每个工具是一个目录，包含：

- `tool.json`：声明 `name` + `description` + `parameters`（JSON Schema，类 MCP 工具）
- 实现文件（复用 `browser_script` executor，具体形态由 design 阶段定）

`tool.json` 示例：

```json
{
  "name": "roll_dice",
  "description": "掷骰子并返回结果。支持多骰、修正值、难度对比。",
  "parameters": {
    "type": "object",
    "required": ["sides"],
    "properties": {
      "sides": { "type": "number", "description": "骰子面数，如 20" },
      "count": { "type": "number", "description": "骰子数量，默认 1" },
      "modifier": { "type": "number", "description": "修正值，默认 0" },
      "dc": { "type": "number", "description": "难度等级，提供时返回成功/失败" }
    }
  }
}
```

### R3: 发现机制

- Agent 启动时，收集 `tools/`（公共）+ `agents/<agent>/tools/`（Agent-local）里所有 `tool.json`。
- 工具 schema 列表注入 system prompt 的 tools 数组，与现有 `workspace_read` 等顶层工具并列。
- 模型原生 function calling 直接生成 `roll_dice({sides:20})` 调用，无需 use_skill 激活步骤。
- 工具常驻工具列表，不占用 Skill 的"激活 + 下一轮注入"上下文成本。

### R4: 调用拦截与执行

- 复用现有 `browser_script` executor，不新增 executor 类型。
- 平台拦截工具调用，找到对应 tool 的实现，执行，返回结果。
- 调用路径区别于 `run_script`（不是 skill+script 两段式，而是 tool name 直接映射）。
- 工具执行的 workspace 写入走现有 `workspaceMutations` 适配器（与 Skill 脚本同路径）。

### R5: agent.json 双层配置

```json
{
  "platformTools": { "enabled": ["workspace_read", "agent_call"], "disabled": [] },
  "tools": { "enabled": ["tools/roll-dice", "agents/storyteller/tools/叙事节奏检测"], "disabled": [] }
}
```

- `platformTools` 管通用顶层工具（现有机制，不变）。
- `tools` 管定制工具（新增）。
- 卡作者可以 `platformTools.disabled` 关通用工具 + `tools.enabled` 开定制工具，让 Agent 只用本卡专用工具集——这是 AIRP 多卡生态的定制入口。

### R6: 命名冲突规则

- Agent-local 工具与公共同名时，Agent-local 覆盖公共（与 Skill 同名覆盖逻辑一致）。
- 注册时检测冲突，不允许两个公共工具同名。

### R7: 迁移示范

- 把 `roll_dice` / `calculate_expression` 从 Skill 内部 `browser_script` action 提取成公共工具。
- 现有 Skill 里声明这两个 action 的 SKILL.md 更新为"调用 `roll_dice` / `calculate_expression` 工具"。
- 现有 `run_script` 机制保留，不强制迁移——Skill 仍可声明内部 action，适合"只服务这一个 Skill 的脚本"。

### R8: 文档

- 工具 vs Skill 职责边界、何时做成工具、何时留在 Skill。
- 卡定制模式说明：`platformTools.disabled` + `tools.enabled` 替代模式。
- 命名冲突规则、Agent-local 覆盖语义。

## Acceptance Criteria

- [ ] 存在 `tools/` + `agents/<agent>/tools/` 目录结构，平台能发现并加载 `tool.json`。
- [ ] Agent 启动时工具列表出现在 system prompt tools 数组，模型能直接 function call 调用。
- [ ] `agent.json` 支持 `tools.enabled` / `tools.disabled` 配置。
- [ ] Agent-local 工具覆盖同名公共工具，注册时检测公共工具同名冲突。
- [ ] 至少 `roll_dice` 和 `calculate_expression` 被提取成公共工具，现有 Skill 引用更新。
- [ ] 现有 `run_script` 机制不被破坏，Skill 仍可声明内部 action。
- [ ] 给出工具 vs Skill 职责边界文档。
- [ ] 必要构建/测试通过。

## Out of Scope

- **写入权限模型**：不设计 `writeScope` 声明、不接入 `actionExecutorPolicy` 强制拦截。脚本/工具的 workspace 写入走现状（`workspaceMutations`，不加 gate）。理由：脚本是提前设计好的确定性代码，基本不会出错；`platformTools` 对顶层工具的 gate 保留即可，不扩展到脚本/工具层。如果未来需要更细的写入权限治理，单独立项。
- **脚本运行时升级**：当前 `browser_script` 只能跑 JS，限制较大。本任务复用现有 executor，不改动脚本运行时。脚本升级作为独立后续讨论。
- **外部 MCP 集成**：本任务是 Tsian 内部 mini-MCP，不涉及接外部 MCP server。
- **强制迁移所有 Skill action**：现有 Skill 的 `browser_script` action 保留，只提取跨 Agent 复用的原子能力作为示范。

## Open Questions (design 阶段讨论)

### OQ-1: 工具实现的文件形态

`tool.json` 之外，工具的实现是单文件 `index.js`/`index.ts`，还是一个目录下多文件？打包方式（直接 source vs 编译）？design 阶段定。

### OQ-2: 工具的 workspace 读取能力

工具执行时除了写（走 `workspaceMutations`），能不能直接读 workspace？还是工具要读 workspace 必须通过注入的 `workspace_read` 能力？这影响工具能做什么、实现复杂度。

### OQ-3: 工具能否调用其他工具

`roll_dice` 调用时能否内部再调 `calculate_expression`？还是工具是叶子节点，不能互相调用？design 阶段定。

### OQ-4: 工具描述的国际化

`tool.json` 的 `description` 用中文还是英文？通用工具（`roll_dice`）和 Agent-local 定制工具（`叙事节奏检测`）是否有不同约定？参照现有 schema 中英混用边界（结构字段英文、玩家可见内容中文）。

### OQ-5: 卡定制模式的实际验证

`platformTools.disabled` + `tools.enabled` 替代模式需要一张实际游戏卡验证。是默认 novel 卡自己做这个替换，还是等第二张卡出现时再验证？默认 novel 卡可能更适合保留通用工具 + 加少量定制工具，而不是完全替换。

## Notes

- 本任务源于 2026-07-05 关于"render type 校验在哪层做"的讨论——用户提出"我们有脚本，让 agent 通过脚本写入实现写入时校验"，进而引出"脚本绑定 skill 是否正确"的反思，最终形成"类 MCP 工具层"设计。
- 与 `07-04-airp-agent-roster-skills` 的关系：工具机制是平台层，airp-roster 是 novel AIRP 阵容层。airp-roster 的 OQ-5 记录了"脚本 vs 工具形态"问题，本任务是其独立化沉淀。
- 用户明确判断：脚本权限机制作用不大（脚本是提前设计好的，基本不会出错），`platformTools` 对顶层工具的 gate 保留即可，不扩展到脚本/工具层——避免过度设计。
- 用户明确判断：`tools.enabled` 必须保留，因为它是 AIRP 多卡生态的定制入口——允许卡作者关闭通用工具、启用专用工具集，实现更契合的 Agent 行为。
