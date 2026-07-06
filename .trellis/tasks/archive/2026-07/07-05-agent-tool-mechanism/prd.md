# Agent 工具机制：类 MCP 工具发现与卡定制层

## Goal

为 Tsian Agent 引入一种“类 MCP 工具”能力发现层，补上现有 Skill 机制缺失的一环：让确定性原子能力（如 `roll_dice`、实体解析、领域查询等）以 Tool 形式直接暴露给 Agent，无需先通过 `use_skill` 激活流程文档再用 `run_script` 间接调用。同时为不同游戏卡提供工具定制层，允许卡作者用领域专用工具替代通用顶层工具，实现更契合、效率更高的 Agent 行为。

本任务是平台层基础设施，不挂在 `07-04-airp-agent-roster-skills` 下，因为工具机制服务所有游戏卡，不专属 novel AIRP。后续 `07-04-action-resolution-system` 会依赖本任务提供的 tool 基础设施实现行动裁定。

## Background

当前 Agent 能力发现主要由 Skill 驱动：

- `use_skill(name)` 激活 Skill，同轮观察会回填 `SKILL.md` 内容（`apps/platform-web/src/agent-runtime/workspace-tools.ts:1789-1836`）；此前“下一轮注入”的说法不准确，`collectActivatedSkillContents` 仅是未观察 Skill 的回填兜底。
- `run_script(skill, script, input)` 三段式调用 Skill 内部声明的 `browser_script` action。
- Skill action 目前只支持 `browser_script` executor（`apps/platform-web/src/agent-runtime/registry.ts:65-68`，`apps/platform-web/src/agent-runtime/workspace-tools.ts:1699-1715`）。
- Native function schemas 当前在每 turn 构建（`apps/platform-web/src/agent-runtime/index.ts:1345-1378`），由 `buildEnabledToolSchemas` 输出；`use_skill` / `run_script` 目前无条件曝光（`apps/platform-web/src/agent-runtime/tool-schemas.ts:485-518`），这是本任务不修复的已知缺口。
- Skill 目录发现与 Agent-local 覆盖逻辑已经存在：路径模式见 `apps/platform-web/src/agent-runtime/registry.ts:41-47`，Agent-local Skill 覆盖 shared Skill 见 `apps/platform-web/src/agent-runtime/registry.ts:843-859`。
- 默认 Agent/Skill/脚本并非物理 checked-in `agents/` 树，而是由 `apps/platform-web/src/storage/workspace-templates.ts:1250-1280` 等模板播种到 workspace。

Skill 与 Tool 的职责区分：

| | Skill | Tool |
|---|---|---|
| 本质 | 流程编排文档 | 原子能力界面 |
| 发现 | Skill Index → `use_skill` → 回填 `SKILL.md` | 工具列表直接进入 native function calling schemas |
| 调用 | `run_script(skill, script, input)` 三段式 | `tool_name(input)` 直接 |
| 校验 | 脚本 `inputSchema` + 运行时错误 | Tool `parameters` schema，模型生成阶段可见 |
| 上下文成本 | 激活后回填完整 `SKILL.md` | 只注入 `name` + `description` + `parameters` |
| 适用 | 需要流程文档教 Agent “何时做、按什么顺序” | 参数明确、跨场景复用、不需要流程文档 |

两者共存，不互相替代：Skill 可以引用 Tool（例如“遇到不确定性时调 `roll_dice` 工具”），Tool 不需要 Skill 包装就能直接调用。

## Requirements

### R1: 目录结构

- 公共工具目录 `tools/`，工具被所有 Agent 共享。
- Agent-local 工具目录 `agents/<agent>/tools/`，只被该 Agent 发现并使用。
- 支持 `.tsian/local/<agent>/tools/` 作为本地覆盖层（若实现成本与现有 Skill local 层对称）。
- 目录组织对称于现有 Skill 组织方式（`skills/` 公共 + `agents/<agent>/skills/` Agent-local）。

### R2: 工具声明契约

每个工具是一个自包含目录，包含：

- `tool.json`：声明 `name` + `title` + `description` + `parameters`（JSON Schema，类 MCP 工具）+ `executor`。
- 实现文件：复用 `browser_script` executor，与 Skill action 数据结构对称。

`tool.json` 示例：

```json
{
  "name": "roll_dice",
  "title": "掷骰",
  "description": "掷骰子并返回结果，支持修正值、难度对比与优势/劣势偏置。",
  "parameters": {
    "type": "object",
    "required": ["sides"],
    "properties": {
      "sides": { "type": "number", "description": "骰子面数，如 20" },
      "count": { "type": "number", "description": "骰子数量，默认 1" },
      "modifier": { "type": "number", "description": "修正值，直接传入最终数字。" },
      "dc": { "type": "number", "description": "难度等级，提供时返回成功/失败" },
      "advantage": { "type": "boolean", "description": "优势：投两个同面骰，取较高结果。" },
      "disadvantage": { "type": "boolean", "description": "劣势：投两个同面骰，取较低结果。" }
    }
  },
  "executor": {
    "type": "browser_script",
    "path": "./run.js",
    "timeoutMs": 5000
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "rolls": { "type": "array", "items": { "type": "number" } },
      "total": { "type": "number" },
      "success": { "type": "boolean" }
    }
  }
}
```

字段职责：

- `name`：英文 snake_case，作为 LLM function call 符号，与现有 `workspace_read` / `agent_call` 等 platform tool 风格保持一致。
- `title`：中文短标签，UI 展示用；省略时 UI 回退到 `name`。
- `description`：中文，同时供 LLM（function calling 描述）与 UI（tool 详情说明）消费。项目面向中文母语用户，不做 i18n 分层。
- `parameters.properties[*].description`：中文，参数级说明。
- `executor`：与 Skill action executor 数据结构对称（`type` / `path` / `timeoutMs` / 可选 `helpers`），本任务仅支持 `type: "browser_script"`。
- `outputSchema`：可选，声明工具返回值结构。运行时不强制校验，不因输出偏差阻断 live turn；偏差可进入 diagnostics / debug 信号供 tool 作者调试。

### R3: 发现机制

- Agent 启动/上下文构建时，收集 `tools/`（公共）+ `agents/<agent>/tools/`（Agent-local）里所有 `tool.json`。
- 工具 schema 列表与现有 `workspace_read` 等顶层工具并列进入 native function calling tools 数组。
- 模型可以直接生成 `roll_dice({ sides: 20 })` 调用，无需 `use_skill` 激活步骤。
- 工具常驻工具列表，不占用 Skill 的“激活 + 回填 SKILL.md”上下文成本。

### R4: 调用拦截与执行

- 复用现有 `browser_script` executor，不新增 executor 类型。
- 平台拦截 custom tool 调用，找到对应 tool 的实现，执行，返回结果。
- 调用路径区别于 `run_script`：不是 `skill + script` 两段式，而是 tool `name` 直接映射。
- 工具执行的 workspace 读写继承现有 Skill 脚本路径：通过 `tsian.workspace.*` SDK 与 `workspaceMutations` / `exposedWorkspaceOperations` 适配器完成。

### R5: `agent.json` 双层配置

```json
{
  "platformTools": { "enabled": ["workspace_read", "agent_call"], "disabled": [] },
  "tools": { "enabled": ["tools/roll_dice", "agents/storyteller/tools/叙事节奏检测"], "disabled": [] }
}
```

- `platformTools` 管通用顶层工具（现有机制，不变）。
- `tools` 管 workspace / 卡级 / Agent-local 定制工具（新增）。
- 缺失 `tools` 的旧 `agent.json` 默认等价于 `{ "enabled": [], "disabled": [] }`。
- 卡作者可以用 `platformTools.disabled` 关通用工具 + `tools.enabled` 开定制工具，让 Agent 使用本卡专用工具集。

### R6: 命名冲突与生效优先级

生效优先级（高 → 低）：

1. Agent-local tool（`agents/<agent>/tools/<id>/`）
2. 卡级公共 tool（`tools/<id>/`）
3. 平台内建 tool（`tool-schemas.ts` 硬编码，如 `workspace_read` / `agent_call` / `use_skill` / `run_script` / `ask_user`）

同 name 处理规则：

- 卡级 / Agent-local tool 不允许与平台内建同 name。平台内建 name 是保留字段，冲突项注册失败并进 diagnostics。
- 同层同 name 一律注册失败并进 diagnostics，防卡作者复制粘贴事故。
- Agent-local tool 与卡级公共 tool 同 name 时，Agent-local 覆盖公共，记 `info` 级 diagnostics，不算错。
- 平台层“同时只加载一张卡”的约束消除了跨卡 tool name 竞争问题，本任务不引入 namespace / prefix / capability 抽象。

### R7: 参考实现

- 落地 `roll_dice` 作为第一个公共工具（`tools/roll_dice/`），走通 `tool.json` 声明 + `browser_script` 实现 + registry 注册 + native function calling 曝光的完整链路。
- `roll_dice` 参数只接受**数字** `modifier`，不做表达式求值。平台不承担精确算术：衍生数值（属性修正、命中加成等）由前端在状态变化点算好写入 workspace，LLM 只读终值。
- 不做独立 `calculate_expression` tool，运行时不引入表达式求值器（详见 R13 与 Notes 的 AIRP 数值规则原则）。
- 现有 `run_script` 机制保留，不强制迁移；Skill 仍可声明内部 action，适合“只服务这一个 Skill 的脚本”。

### R8: 文档

需要补充或更新文档，说明：

- Tool vs Skill 职责边界，何时做成 Tool，何时留在 Skill action。
- 卡定制模式：`platformTools.disabled` + `tools.enabled` 替代模式。
- 命名冲突规则、Agent-local 覆盖语义、平台内建保留名。
- 中英边界约定：`tool.json.name` 英文 snake_case，其余（`title` / `description` / 参数说明 / diagnostics 消息）中文。
- `tsian.lib.*` 首批能力清单与准入规则。
- 创意工坊 tool 的安全姿态：社区上传 + 社区外部审核，玩家知情承担风险，平台不做域隔离。

### R9: 发现机制沿用 Skill 双层模式

- 默认内容来源：`workspace-templates.ts` bootstrap 首次运行时把 `tools/<id>/tool.json` 与实现文件种入 IndexedDB workspace，与 Skill 默认内容分发路径一致。
- 运行时发现：`registry.ts` 新增 `TOOL_CONFIG_FILE_PATH_PATTERN` 与 `AGENT_LOCAL_TOOL_CONFIG_FILE_PATH_PATTERN`，构建时扫 workspace 里所有 `tool.json`，产出 `toolRegistry`。
- 卡/玩家自定义：任何符合路径规则的 `tool.json` 都会在下一次 registry 构建时被发现。卡包导入 = 合并 workspace 文件，天然生效。
- 不引入 manifest 声明式 registry 或 capability 匹配层；当前“一团队一默认卡 + 同时只加载一张卡”规模下属过度设计。
- Tool 目录必须是最小分发单元：`tools/<id>/` 或 `agents/<agent>/tools/<id>/` 目录整体复制到另一个 workspace 后无需其他依赖即可运行。目录内 JS 文件间允许 `importScripts('./xxx.js')` 相互引用，但不允许跨 tool 目录 import；跨脚本复用走平台 SDK（R13）。

### R10: `tools.enabled` / `tools.disabled` 语义

沿用“声明即曝光”心智：

- 默认行为：符合发现规则的 tool 一被 registry 发现即向 LLM 曝光，卡作者无需为默认卡额外维护 `enabled` 白名单。
- `tools.enabled`：可选排他白名单；一旦非空，未列入名单的 custom tools 全部隐藏。
- `tools.disabled`：黑名单，从发现集里剔除指定 tool。
- 分层可见性：卡级公共 tool 会被所有 Agent 检测到，能在对应 `agent.json.tools` 中启用/禁用；Agent-local tool 只有对应 Agent 能检测到，同样支持启用/禁用。
- `tools.enabled/disabled` 也是玩家管理创意工坊 tool 启停的落地点；前端应提供 UI 让玩家逐个开关。
- 现有 `use_skill` / `run_script` 无条件曝光、不受 `platformTools.enabled/disabled` 控制的缺口不在本任务修复范围。

### R11: Registry Diagnostics 通道

Registry 构建时的 tool 类问题不阻断卡加载，而是产出结构化 diagnostics 让玩家可见并可修复：

- Tool `name` 与平台内建冲突 → `error`，跳过该 tool。
- 同层两个 tool `name` 冲突 → `error`，两个都跳过。
- `tool.json` 语法错误 / 缺必填字段 → `error`，跳过该 tool。
- Agent-local tool 覆盖同名卡级公共 tool → `info`，仅记录，不算错。

Diagnostics 条目形状：`{ severity: "error" | "warn" | "info", code, message, path, hint }`。

前端出口决议：放在 Studio，而不是玩法前台。Studio 已管理 Agent、Skill、platform tools 与 workspace access，是配置/作者反馈的自然位置。UI 至少提供计数徽章、可展开列表，以及跳转到 workspace 文件的入口。通道做成通用数据结构 + 通用前端出口，但本任务只接入 tool 类错误；Skill 层与 `agent.json` 引用类错误后续再接。

### R12: Tool 执行环境

- Tool 复用现有 `browser_script` executor（`apps/platform-web/src/platform-host/browser-skill-script-executor.ts`），不新增 executor 类型。
- 当前 `isScriptUnderSkillDirectory`（`apps/platform-web/src/platform-host/browser-skill-script-executor.ts:459-467`）泛化为“scriptPath 必须在其注册项的根目录 (`resolvedRootDirectory`) 下”：Skill 与 Tool 各自根目录。
- `importScripts('./helper.js')` 和 `executor.helpers` 对 Tool 都只能解析到当前 tool 目录内，保证自包含分发；Skill 保持现有兼容行为。
- Tool 脚本继承 `tsian.workspace.*` SDK（读/写皆可，权限沿用 Agent 的 `exposedWorkspaceOperations`）；不为 tool 引入独立 `readScope` / `writeScope` 权限声明字段。
- Tool 是叶子节点：脚本内无法调用其他 tool / Skill action / `use_skill` / `run_script` / `agent_call`。
- Executor 沙箱不变：Worker + AsyncFunction、shadowed globals、workspace 只走 SDK。

### R13: `tsian.lib.*` SDK（Skill 与 Tool 共用复用出口）

- 与 `tsian.workspace.*` 平级的运行时 SDK 命名空间，注入位置在 `browser-skill-script-executor.ts` 的 worker 侧。
- 提供无 I/O、无状态的纯函数复用能力。Skill action 与 Tool 脚本平等可用。
- 本任务首批交付：
  - `tsian.lib.random`：`nextInt(min, max)`、`dice(...)` 等，供 `roll_dice` 使用。
- 不引入 `tsian.lib.math` / 表达式求值器（AIRP 数值规则原则：运行时不做精确算术，见 Notes）。
- `tsian.lib.*` 首批之外的字符串处理、时间/日期、语言处理等不进本任务。
- 长期准入规则：新增 SDK 能力需至少两个上层单元（Skill 或 Tool）实际用到或明确会用到；纯 workspace 操作或业务规则不进 lib；SDK 版本随平台版本发布。
- Skill 现有 `executor.helpers:[]` 继续有效，但定位从“跨 Skill/Tool 共享代码”降级为“本 Skill 内脚本额外加载的私有 helper 文件”。本任务不强制迁移现有 Skill。

## Acceptance Criteria

- [ ] 存在 `tools/` + `agents/<agent>/tools/` 目录结构，平台能发现并加载 `tool.json`。
- [ ] Agent 启动/turn 构建时 custom tool 列表进入 native function calling tools 数组，模型能直接 function call 调用。
- [ ] `agent.json` 支持 `tools.enabled` / `tools.disabled` 配置，语义符合 R10。
- [ ] Agent-local 工具覆盖同名卡级公共工具并记 info diagnostic；卡级或 Agent-local 工具与平台内建同名注册失败并记 error diagnostic；同层同名注册失败。
- [ ] `roll_dice` 作为公共工具存在并可从任意曝光它的 Agent 直接 function call；`modifier` 参数只接受数字，运行时不做表达式求值。
- [ ] 现有 `run_script` / `use_skill` 机制不被破坏，Skill 仍可声明内部 action。
- [ ] Registry Diagnostics 通道存在：结构化条目、Studio 可见入口（徽章 + 展开列表 + 跳转 workspace 文件）、至少接入 R11 列出的 tool 类错误。
- [ ] `tsian.lib.random` 存在于 `browser-skill-script-executor.ts` 注入的 SDK 中，Skill action 与 Tool 脚本均可无差别调用；`tsian.lib.math` / 表达式求值器不进 v1。
- [ ] Tool 目录满足自包含约束：`tools/<id>/` 单独复制到另一个 workspace 后无外部依赖即可运行。
- [ ] 给出工具 vs Skill 职责边界文档、卡定制模式说明、命名冲突规则文档、`tsian.lib.*` 首批能力清单与准入规则说明。
- [ ] 必要构建/测试通过。

## Out of Scope

- 写入权限模型 / 创意工坊沙箱域隔离：不设计 `readScope` / `writeScope`，不接入 `actionExecutorPolicy` 强制拦截。创意工坊 tool 由社区上传 + 社区（平台外）审核，默认信任，安全成本由平台声明后转嫁到玩家侧知情选择。
- 脚本运行时升级：当前 `browser_script` 只能跑 JS，本任务复用现有 executor，不改动脚本运行时。
- 外部 MCP 集成：本任务是 Tsian 内部 mini-MCP，不涉及接外部 MCP server。
- 强制迁移所有 Skill action：现有 Skill 的 `browser_script` action 保留，只新增 `roll_dice` 作为参考 tool。
- 修复 `use_skill` / `run_script` 无条件曝光缺口：作为独立后续小任务。
- 独立 `calculate_expression` tool / 运行时表达式求值：不进本任务，也不进 v1。衍生数值由前端在状态变化点算好写入 workspace，LLM 只读终值（见 Notes 的 AIRP 数值规则原则）。
- `tsian.lib.*` 首批之外的能力：字符串处理、时间/日期、语言处理等按需扩展，不进本任务。`tsian.lib.math` 命名空间同样按需扩展，不进 v1。
- 默认 novel 卡真实替换演示：本任务不做 `platformTools.disabled` + 定制 tool 的业务卡演示；后续 AIRP / 行动裁定任务自然验证。

## Open Questions

None. 原 OQ-1（文件形态）、OQ-2（workspace 读取）、OQ-3（tool 互调）、OQ-4（国际化）、OQ-5（卡定制验证）、OQ-6（Diagnostics UI 位置）均已在 Requirements / Design 中关闭。

## Notes

- **AIRP 数值规则原则（2026-07-06 讨论确认）**：平台不承担精确算术，运行时不引入表达式求值器。规则中的衍生数值（如属性修正、攻击加成、伤害系数）应在前端状态变化点计算完毕并写入 workspace，LLM 只读终值。若某条规则复杂到 LLM 直接读取多个字段仍会出错，先质疑规则设计本身而非给平台加求值层。本原则源于「AIRP ≠ TTRPG 数值模拟，叙事仲裁由 LLM 承担，骰子只提供不确定性」的定位。
- 本任务源于 2026-07-05 关于“render type 校验在哪层做”的讨论：用户提出“我们有脚本，让 agent 通过脚本写入实现写入时校验”，进而引出“脚本绑定 skill 是否正确”的反思，最终形成类 MCP 工具层设计。
- 与 `07-04-airp-agent-roster-skills` 的关系：工具机制是平台层，airp-roster 是 novel AIRP 阵容层。airp-roster 的脚本 vs 工具问题由本任务独立沉淀。
- 创意工坊已支持卡包、Skill、Agent 分发，配套账号系统与社区绑定。本任务的 tool 分发复用此通道：`tools/<id>/` 目录被约束为最小分发单元后，可与现有创意工坊分发方式对齐。
- 未来若出现多方卡包生态、卡间依赖、跨卡替换实现等需求，可引入 capability 抽象层；现有 `tool.json` 可以自然扩展 `provides: [<capability>]` 字段，不必重写机制。
