# Platform Action Executor MVP

## Goal

让已加载 Skill 声明的 action 可以通过 `platform_action` executor 调用平台注入的受控能力，使 AIRP Agent 能把角色状态、地图、线索、任务进度等业务动作封装到 Skill 中，而不是长期把底层文件读写细节暴露在 prompt 里。

## User Value

- Skill 可以包装更高层的 AIRP 业务动作，例如 `update_character_state`、`reveal_map_region`、`advance_quest_stage`。
- Agent 只需要判断当前场景是否需要某个业务动作，再通过 `action_call` 调用已加载 Skill 的 action。
- 平台可以继续用 Runtime Workspace 文件作为底层数据载体，数据结构由 Skill、README/schema 和前端包共同约定。
- 玩家和后续 Agent 可以通过编辑或创建 Skill 扩展系统能力，平台不需要硬编码每一种玩法状态。

## Confirmed Facts

- `skill_load` 已支持从已加载 `SKILL.md` 的 `tsian-actions` fenced JSON 中解析 action 声明。
- `action_call` 已支持同一 Agent 工具循环内的 loaded Skill gating、action 存在性校验和 `inputSchema` 校验。
- action executor registry 已有 `builtin/validation` 和 `builtin/echo`，且缺省 executor 是 `builtin/validation`。
- 当前 executor registry 不支持脚本、远程调用、平台 action 或状态写入。
- `agent-runtime` 必须保持纯边界，不直接 import Dexie、storage helper、bridge 对象或 `platform-host`。
- `platform-host` 已有 `platform.runAction` 入口，当前支持 `restore-checkpoint`、`workspace-write` 和 `workspace-delete`。
- `workspace-write` / `workspace-delete` 已在 storage 层做路径、内容和 media type 校验。

## Requirements

- 支持新的 Skill action executor 类型：`platform_action`。
- `platform_action` executor 的 `name` 必须是非空字符串，并映射到平台受控 action 名称。
- `action_call` 仍必须先完成 Skill 已加载、action 已声明和 input schema 校验，然后才允许调用 `platform_action` executor。
- `platform_action` executor 必须通过 `runAgentRuntimeTurn` capability 注入平台 action handler；`agent-runtime` 不得直接 import 平台 host、storage 或 bridge。
- 平台 action 请求使用 `{ action: executor.name, params: actionInput }`。
- 平台 action 成功时，`action_call` observation 返回 `status: "executed"`、executor 元数据、原始 input 和平台返回的 `item` 作为 output。
- 平台 action 返回 `ok: false` 时，`action_call` 必须返回结构化错误 observation，而不是静默成功。
- 未注入平台 action capability 时，`platform_action` executor 必须返回结构化错误 observation。
- 平台侧应限制 Agent Runtime 可调用的平台 action 范围，MVP 推荐只开放 `workspace-write` 和 `workspace-delete`，不开放 `restore-checkpoint`。
- Runtime prompt、方向文档和 platform-web type-safety spec 必须记录 `platform_action` 的声明格式、调用边界和 MVP 限制。
- 继续保持普通 Agent 输出为软协议；只在工具/action 调用边界做结构化校验。

## Action Declaration Format

````md
```json tsian-actions
[
  {
    "name": "update_character_state",
    "description": "Write the current character state file after validating the payload.",
    "inputSchema": {
      "type": "object",
      "required": ["path", "content"],
      "properties": {
        "path": { "type": "string" },
        "content": { "type": "string" },
        "mediaType": { "type": "string" }
      }
    },
    "executor": {
      "type": "platform_action",
      "name": "workspace-write"
    }
  }
]
```
````

## Acceptance Criteria

- [x] `skill_load` can parse and register an action whose executor is `{ "type": "platform_action", "name": "workspace-write" }`.
- [x] `action_call` invokes the injected platform action handler only after loaded Skill gating, action lookup, and input schema validation pass.
- [x] A valid `platform_action` call sends `{ action: executor.name, params: input }` to the injected handler.
- [x] A successful platform action result returns a structured observation with `status: "executed"` and `output` set to the platform result item.
- [x] A platform action result with `ok: false` returns a structured error observation that includes the platform error details.
- [x] Missing platform action capability returns a structured error observation.
- [x] Unsupported platform action names are rejected by the platform-side handler; `restore-checkpoint` is not callable from Agent Runtime in the MVP.
- [x] Existing `builtin/validation` and `builtin/echo` behavior remains unchanged.
- [x] `agent-runtime` still has no direct imports from Dexie, storage helpers, bridge objects, or `platform-host`.
- [x] `npm run build:web` passes.
- [x] `git diff --check` passes.

## Validation Notes

- `npm run build:web`
- `git diff --check`
- In-memory runtime probe passed for:
  - valid `skill_load` -> `action_call` with `platform_action`;
  - input schema failure before platform handler invocation;
  - missing platform action capability;
  - platform handler returning `ok: false`;
  - existing builtin executor behavior.

## Confirmed Scope Decision

Platform action 副作用在 MVP 中直接复用现有 `workspace-write` / `workspace-delete` 平台动作，并在 platform-host 的 Agent Runtime capability 里做 allow-list。这样最短路径打通 AIRP 状态维护能力，符合当前原型阶段节奏。

完整的回合级事务/回滚不是本任务范围。后续如果要保证“模型最终失败时撤销本轮 workspace 写入”，需要单独设计 staged workspace mutations 或 workspace checkpoint rollback。

## Out Of Scope

- Browser JavaScript executor。
- Remote HTTP / remote script executor。
- WASM 或托管执行环境。
- `agent_call` executor。
- 默认官方状态维护 Skill。
- Workspace 写入的回合级事务 staging。
- 持久化 action/tool trace。
- UI。
