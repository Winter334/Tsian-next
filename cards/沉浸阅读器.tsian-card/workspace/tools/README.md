# Tools

本目录存放自定义 Tool。每个 Tool 是一个独立目录，含 `tool.json` 声明和一份 `browser_script` 实现（默认 `run.js`）。

Tool 与 Skill 的区别：

- Tool 是**能力**（LLM 原生函数调用直接可见），一次调用 = 一次输入 → 一次输出，无需 `use_skill` 激活。
- Skill 是**知识 + 一组 action**；`use_skill` 加载完整说明，`run_script` 可直接执行当前可见 Skill 声明的 action。

作用域：

- `tools/<id>/` 共享 Tool，所有 Agent 可见（除非 `agent.json.tools.disabled` 屏蔽）。
- `agents/<agent>/tools/<id>/` Agent 私有 Tool，只对该 Agent 可见；同名可覆盖共享 Tool。
- `.tsian/local/<agent>/tools/<id>/` 机器私有 Tool，不入 checkpoint，不随卡包分发；可显式上传为独立 Tool 资源包。

`tool.json` 必填字段：`name`（小写下划线，长度 ≤ 64）、`description`、`parameters`（JSON Schema）、`executor.type="browser_script"`、`executor.path`。可选：`timeoutMs`、`helpers`、`outputSchema`。

Tool 脚本内可用 `tsian.workspace.*`（受 Agent 的 workspaceAccess 约束）、`tsian.log`、`tsian.trace`、`tsian.lib.random.nextInt/dice`。**不提供** `tsian.config`（永远是 `{}`）、`tsian.lib.math`。平台不内置表达式求值器；个别 Tool（如 `roll_dice`）可在脚本内自实现受限求值。

衍生数值（伤害、消耗、总分）一般由前端在状态变更点算好写回 workspace，LLM 直接读终值。需要 Tool 内精确算术时（如掷骰 modifier 差值），由 Tool 脚本自行实现受限求值，不依赖平台内置数学库。
