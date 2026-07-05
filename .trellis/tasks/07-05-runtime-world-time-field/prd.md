# runtime.worldTime 世界层时间固定字段

## Goal

把当前世界/剧情时间从 `extensions["当前时间"]` 这类临时扩展槽提升为 `save/playthrough/runtime.json` 的固定字段 `worldTime`，为左侧状态栏、runtime 摘要 injection 与回合后场记维护提供稳定读取入口。

本任务只定义并落地最小固定字段契约与读取支持；不实现完整时间系统、日历运算或状态栏视觉 UI。

## Background / Confirmed Facts

- 父任务已确认 `runtime.json` 是当前局面/状态栏数据面，可包含“时间、坐标、位置、全局状态、临时机制”等玩家当前需要看到或让 master 知道的变量（`.trellis/tasks/07-03-play-frontend-status-bar/prd.md:28`）。
- 左侧状态栏 MVP 明确希望固定区域能显示“时间/世界变量”（`.trellis/tasks/07-04-left-status-bar-mvp/prd.md:4`, `.trellis/tasks/07-04-left-status-bar-mvp/prd.md:12`）。
- 当前默认 schema 示例把“当前时间”放在 `extensions` 中：`"当前时间": { "render": "text", "value": "赤明纪十二年三月初七，黄昏" }`（`apps/platform-web/src/storage/workspace-templates.ts:1024`）。这说明时间已被视为玩家可见状态，但仍是动态 key，UI/injection/Agent 维护都难以稳定定位。
- 默认 `runtime.json` 模板当前只有 `turn`、`activeSceneIds`、`activeScene`、`player`、`inventory`、`status`、`extensions`、`updatedAtTurn`、`updatedBy`，没有 `worldTime`（`apps/platform-web/src/storage/workspace-templates.ts:1387`）。
- 开局建模脚本 `commit_runtime_and_frontier` 写入 runtime 时也只写上述字段，没有 `worldTime`（`apps/platform-web/src/storage/workspace-templates.ts:449`, `apps/platform-web/src/storage/workspace-templates.ts:489`）。
- 前端 runtime 数据层的 `Runtime` 类型与 `parseRuntime` 当前不包含 `worldTime`，固定字段只原样保留已有字段（`apps/play-frontend-dev/src/lib/runtime-types.ts:102`, `apps/play-frontend-dev/src/lib/parse-runtime.ts:282`）。
- 场记的“状态栏维护” Skill 已把 `runtime.json` 定位为高频摘要和当前指针维护目标（`apps/platform-web/src/storage/workspace-templates.ts:118`, `apps/platform-web/src/storage/workspace-templates.ts:134`）。

## Requirements

- R1: `runtime.worldTime` 表示当前世界/剧情内时间，是 diegetic time；它不是平台墙钟时间，也不等同于 `runtime.turn`。
- R2: `worldTime` 的存档形态为字符串；它主要帮助剧情理解，不承载日历运算、排序、精度或来源说明。
- R3: `worldTime` 是 runtime 固定字段，缺失或类型错误时视作 runtime 损坏，走 `load-failed` 路径；当前项目无旧存档，不做向后兼容降级。
- R4: 默认新存档的 `save/playthrough/runtime.json` 应包含 `worldTime: ""`，使 Agent 和前端能看到该固定字段入口。
- R4: 默认 schema 文档、`docs/novel-airp-schema-guide.md` 模板示例、开局建模脚本说明与场记状态栏维护指导应把“当前时间”改写为 `runtime.worldTime`，不再只依赖 `extensions["当前时间"]`。
- R5: 开局建模脚本 `commit_runtime_and_frontier` 应接受并写入合法的 `runtime.worldTime`，缺省时写入空值；它仍应保持轻量校验，不引入复杂日历计算。
- R6: 前端 runtime 数据层应把 `worldTime` 纳入 `Runtime` 类型与 `parseRuntime` 输出，供后续状态栏和 injection 子任务直接读取。
- R7: `extensions` 仍用于新增/临时的时间相关机制，例如月相、倒计时、诅咒周期、节气规则等；只有“当前世界/剧情时间”固定为 `worldTime`。
- R8: 本任务不增加平台级时间服务、数据库迁移、完整 JSON Schema 校验器、时间排序/换算算法或状态栏视觉 UI。

## Acceptance Criteria

- [ ] 默认 `save/playthrough/runtime.json` 模板包含 `worldTime: ""`，表达“未知/尚未建立当前世界时间”。
- [ ] `commit_runtime_and_frontier` 可在开局时写入字符串 `worldTime`，缺失或无效输入降级为空字符串，不破坏 runtime 文件写入。
- [ ] `docs/novel-airp-schema-guide.md` / `save/schema/current.md` 模板内容明确 `runtime.worldTime` 是当前世界/剧情时间固定字段，并替换“当前时间”仅作为 extension 的示例。
- [ ] 场记状态栏维护指导提示每回合维护 `runtime.worldTime`，但不要求发明完整日历系统。
- [ ] `apps/play-frontend-dev` 的 `Runtime` 类型和 `parseRuntime` 输出包含字符串 `worldTime`；`worldTime` 缺失或类型错误时 runtime 视作 `load-failed`。
- [ ] 仍保留 `extensions` 动态时间机制入口，不把所有时间相关字段都硬塞进固定 schema。
- [ ] 通过涉及包的构建检查：至少 `npm run build --workspace play-frontend-dev`；若修改 platform template，运行 `npm run build:web`。

## Decision

- 2026-07-05: `runtime.worldTime` 使用字符串形态，例如 `"赤明纪十二年三月初七，黄昏"`。原因：该字段主要服务剧情理解和 UI/injection 展示，后续不需要日历运算、精度模型或结构化时间系统。

## Out of Scope

- 不实现状态栏 UI、角色卡、容器/物品详情或 runtime injection。
- 不把现实时间、平台时间戳或模型调用时间混入世界时间。
- 不要求所有小说都有精确日历；模糊时间如“黄昏”“三日后”“翌日清晨”可直接写入字符串。
- 不迁移既有用户存档；当前项目无旧存档，新固定字段直接进入必检。
