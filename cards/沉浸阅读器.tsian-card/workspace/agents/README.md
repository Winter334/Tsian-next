# Agents

`agents/` 存放本卡定义的运行时 Agent 团队。每个子目录是一个 Agent：

- `agent.json` — 机器配置（id、title、contacts、skills、contextPaths、权限）。
- `AGENT.md` — 岗位 SOP：什么时候行动、读哪些文件、如何输出、何时委托。
- `SOUL.md` — 可选的人格风格与长期表达偏好。
- `skills/` — Agent-local Skill（按需加载的能力/知识包）。
- `tools/` — Agent-local 工具脚本与 schema。
- `modules/` — 可被 `enabledModules` 启用的可选内容文件。

具体阵容以各 `agent.json` 为准。
