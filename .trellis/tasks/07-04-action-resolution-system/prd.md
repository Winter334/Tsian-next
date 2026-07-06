# roll_dice 工具对抗扩展

## Goal

把默认 `roll_dice` Tool 从“单方随机判定”扩展为支持“双方对抗”的最小裁定能力，让 Agent 在需要比较两个主体行动结果时一次调用即可得到双方掷骰、总值、差值与胜负事实，避免 Agent 自行调用两次 `roll_dice` 再手算比较。

本任务只交付平台层 Tool 能力，不重构 Agent / Skill，不引入规则手册，也不处理 `mode.json` 清理。后续会另起父任务，以玩家游玩流程为骨架渐进重构 novel AIRP 的 Agent / Skill / Tool 分层。

## Background / Confirmed Facts

- `07-05-agent-tool-mechanism` 已归档，平台已有类 MCP Tool 机制：`tools/<id>/tool.json` + `browser_script` executor + `agent.json.tools` 曝光控制 + `tsian.lib.random`。
- 默认 `roll_dice` Tool 由 `apps/platform-web/src/storage/workspace-templates.ts` 播种，当前位置包括：
  - `tools/roll_dice/tool.json`：`apps/platform-web/src/storage/workspace-templates.ts:1506`
  - `tools/roll_dice/run.js`：`apps/platform-web/src/storage/workspace-templates.ts:1533`
- 当前 `roll_dice` 已支持：`sides`、`count`、数字 `modifier`、可选 `dc`、`advantage`、`disadvantage`、`reason`。
- 当前实现明确不做表达式求值：`modifier` 只接受数值；衍生数值由 Agent 根据当前实体属性 / 加成自行整理为最终数字。
- 讨论决定：对抗检定不新增独立 `contested_check` Tool，而是扩展 `roll_dice`。理由是投骰是说书人常驻基础能力，扩展现有 Tool 比新增相邻 Tool 更符合 Agent 心智。
- 讨论决定：平局是 AIRP 中合法的叙事事实，Tool 不应强制重投或默认判任一方胜；平局处理留给说书人创作剧情。

## Requirements

- R1: `roll_dice.parameters` 新增可选 `opposed` 对象，用于描述对方 / 对抗方的一次掷骰。
  - `opposed.sides`: integer, minimum 2，默认继承顶层 `sides`。
  - `opposed.count`: integer, minimum 1，默认继承顶层 `count`。
  - `opposed.modifier`: number, 默认 0。
  - `opposed.advantage`: boolean, 默认 false。
  - `opposed.disadvantage`: boolean, 默认 false。
- R2: 顶层 `dc` 与 `opposed` 互斥；同时提供时参数校验失败，不产生随机结果。
- R3: 顶层与 `opposed` 内的 `modifier` 都只接受数字，不支持表达式、变量引用、实体路径或脚本求值。
- R4: 当提供 `opposed` 时，输出结构必须包含：
  - 顶层原有掷骰事实：`sides`、`count`、`modifier`、`rolls`、`kept`、`total`。
  - `opposed`: `{ sides, count, modifier, rolls, kept, total, advantage?, disadvantage? }`。
  - `margin`: `total - opposed.total`。
  - `winner`: `"self" | "opposed" | "tie"`；`margin === 0` 时为 `"tie"`。
- R5: 不新增 `tieBreak` 或 `reroll` 参数；平局不在 Tool 层裁决。
- R6: 现有单方检定行为保持兼容：无 `opposed` 时仍可使用 `dc` 返回 `success`；`reason` 继续作为日志 / 可读说明字段保留，不影响结果。
- R7: `tool.json.description` 与参数级中文说明更新为“支持单方 DC 检定与双方对抗；二者互斥”。
- R8: `run.js` 继续复用 `tsian.lib.random.dice`，不新增 SDK、表达式求值器或规则系统。

## Acceptance Criteria

- [ ] `roll_dice` 可用 `opposed` 参数一次调用完成双方对抗，并返回双方掷骰事实、`margin` 与 `winner`。
- [ ] `winner` 在 `total > opposed.total` 时为 `"self"`，在 `total < opposed.total` 时为 `"opposed"`，在相等时为 `"tie"`。
- [ ] 同时传入 `dc` 与 `opposed` 时，Tool 返回参数错误 / 抛出校验错误，且不调用随机数生成。
- [ ] 顶层或 `opposed` 的 `modifier` 为非数字时返回参数错误。
- [ ] 未传 `opposed` 的现有单方检定路径保持兼容：`dc` 仍返回 `success`，`reason` 仍被截断并回填。
- [ ] `tool.json` 参数 schema 与说明包含 `opposed`，并清楚说明 `dc` 与 `opposed` 互斥。
- [ ] 必要构建 / 测试通过。

## Out of Scope

- 不新增独立 `contested_check` Tool。
- 不新增 `tieBreak` / `reroll` / 平局强制裁决。
- 不新增表达式求值、实体字段解析、规则脚本或 `tsian.lib.math`。
- 不修改说书人、场记、世界架构师、导演等 Agent / Skill。
- 不播种 `save/rules/action-resolution.md`，不把规则手册加入 `contextPaths`。
- 不清理 `mode.json` / `commit_mode`；该清理放入后续渐进重构父任务的前置子任务。
- 不做 UI。

## Follow-up Direction

完成并归档本任务后，另起新父任务承载“跟着玩家游玩流程渐进重构 novel AIRP 的 Agent / Skill / Tool 分层”。新父任务会从开局向导中第二步（涉及世界架构师与导演）开始，逐步重写相关 Agent 的 `AGENT.md` / `SOUL.md`，并按每个流程步骤设计所需 Skill 与 Tool。
