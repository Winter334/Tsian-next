# 前端自检工具 Agent 可行动观测优化

## Goal

优化 `inspect_frontend` 的 Agent-facing 返回结构，让它更接近 Playwright 式“可操作页面快照 + Tsian 业务调试摘要”：默认过滤低价值噪声，只呈现助手在线编辑游戏前端、辅助玩家创作或修复问题时可直接用于判断和行动的信息。

核心目标不是把浏览器 DevTools 信息全部塞给模型，而是支撑助手完成闭环：观察当前页面 → 选择可操作目标 → 执行动作 → 判断变化与等待状态 → 定位源码/构建错误 → 修改并验证。

## Background / Confirmed Facts

- `inspect_frontend` 的产品目的已经写明：让桌面助手检查并操作玩家 `/play` 中真实看到的 packaged frontend；工具不打开 Play、不选存档、不跨 launcher（`docs/active/assistant-frontend-inspection-direction.md:5-10`）。
- 当前方向文档说明工具返回 accessibility-oriented DOM summary、selected computed styles、visible text、bridge state、runtime errors、console output、resource failures、source hints、diff（`docs/active/assistant-frontend-inspection-direction.md:63-68`）。
- 当前运行等待语义只有 `wait: "runtime-settled"`，用于等待 UI 触发的真实 bridge/runtime 活动；带 actions 时必须在短时间内观察到新的 `interaction.sendMessage` 请求，否则返回 `INSPECT_RUNTIME_NOT_TRIGGERED`（`docs/active/assistant-frontend-inspection-direction.md:89-102`）。
- 当前合约里 `InspectFrontendInput.wait` 只有 `"runtime-settled"`；`InspectFrontendResult` 的核心字段包括 `structure`、`diagnostics`、`activity`、`runtime`、`actionSnapshots`、`fileLineMap`、`diff`、`truncated`、`error`（`apps/platform-web/src/agent-runtime/workspace-tools-types.ts:186-260`）。
- 当前 `InspectFrontendDiagnostics.resourceFailures` 同时承载真正资源 error 与 Resource Timing 零字节条目，导致 esm.sh / Vue / Reka UI / Floating UI 等 CDN timing anomaly 被当作 failure 展示，噪声很高。
- 当前 `computedStyles` 会返回 `:root` 主题变量（如 `--void`），对定位导入流程问题帮助低。
- 当前 `ok:false + INSPECT_RUNTIME_NOT_TRIGGERED` 会把“DOM action 已成功，但额外 runtime wait 未触发”包装成整体失败，容易误导 Agent。
- 当前 `quietMs` 表示距离上次 bridge RPC activity 的静默时长，不表示本次工具调用等待耗时；返回中缺少 `waitedMs` / `waitMode` / `triggered` 等 wait telemetry。
- 当前 action 结果缺少“命中了哪个元素、selector 匹配数量、目标是否可见/disabled、是否产生 DOM 变化/bridge 活动”等摘要，Agent 只能从最终 diff 反推。
- 当前 DOM 摘要对卡片类 generic 节点、可点击容器、selector 句柄支持偏弱；Agent 缺少一个过滤后的 interactables / selector map。
- 在线编辑前端工作流要求助手编辑 `frontend/src/**`，平台自动 rebuild 并 reload Play iframe；构建状态可通过 `frontend-build-status` query resource 读取，失败时返回 file/line/message（`apps/platform-web/src/storage/local-assistant-files.ts:1237-1255`）。

## Scope Decision

MVP 做核心闭环，并把 `frontendBuild` / `sourceHints` 纳入“高置信、短摘要”版本：

- MVP 包含：resource filtering、wait telemetry、action execution summary、interactables / selector map、`dom-stable` 等纯前端等待路径、最小 build status、来自 runtime/build error 的高置信 source hints。
- MVP 不做：visible text / class / component 到源码的泛化搜索，不返回完整 source snippets，不做业务 appState debug provider。

## Requirements

### R1. Agent-facing 输出必须默认过滤低价值噪声

- 默认不要把 Resource Timing “transferSize / decodedBodySize 为 0”的条目当作 `resourceFailures` 逐条展开。
- 真正的资源 element error、runtime JS error、unhandled rejection、console error、bridge failure、build failure 应继续保留为高权重诊断。
- Timing anomaly、重复 console warning、低价值样式信息应折叠为 summary/count/sample，而不是占用主要返回体。
- 默认输出不得退化成完整 HTML、完整 computed styles、全量 resource timing、完整 bridge payload 或 workspace 内容转储。

### R2. 结果结构要区分 action 成功、wait 状态和整体 inspect 状态

- DOM action 已执行成功但 runtime wait 未触发时，不应只用顶层 `ok:false` 表达，必须能让 Agent 明确知道“动作成功，等待条件未满足”。
- 返回 wait telemetry：mode、status、实际等待时长、触发超时阈值、activity 前后序号、是否 triggered/settled。
- `quietMs` 不应被当作本次等待耗时；返回结构或文案应消除该歧义。
- wait 失败时也应尽量保留 action execution summary 和最终结构/diff，避免丢失关键复现证据。

### R3. 补齐可操作页面快照，而不是展示标签海

- 默认返回过滤后的 interactables / selector map，覆盖 button、input、textarea、select、link、tab/menu/option、dialog/status、带 aria/data 语义的节点、可点击 generic/card 节点。
- 每个可操作目标应尽量包含短 ref/id、kind、name/text、推荐 selector、visible/disabled/readonly/checked/selected/expanded 等关键状态。
- 结构摘要应继续保留页面大意，但避免纯布局 wrapper、装饰节点、无文本无语义不可操作 generic 节点淹没 Agent。
- MVP 中 actions 仍以 selector 为主；interactable ref 作为返回中的短标识与阅读锚点，不要求实现跨调用 ref 操作。

### R4. 补齐 action execution summary

- 每个 action step 应返回精简执行摘要：action 类型、输入 selector、matchedCount、命中元素摘要、执行是否成功、DOM 是否变化、bridge 是否触发。
- 成功路径只给摘要；失败路径给足够定位的原因（selector invalid/not found/not actionable/covered/disabled 等）。
- 不默认展开完整事件序列；只有失败或 debug 需要时才给更细节信息。

### R5. 支持纯前端 UI 操作的等待/验证路径

- 对不触发 bridge 的 Vue 状态切换（如导入方式选择、返回、填表、展开/切换）提供合适的等待语义，例如 `dom-stable`。
- `runtime-settled` 继续服务“真实前端控件触发 bridge-backed runtime/player turn”的场景。
- 工具返回应能明确指出“DOM changed without bridge activity”这类正常状态，避免 Agent 误判。

### R6. 服务在线编辑闭环的最小定位信息

- inspect 结果返回精简 `frontendBuild`：status、lastBuiltAt、error file/line/message（若存在）。
- inspect 结果返回高置信、短摘要 `sourceHints`：runtime error `fileLineMap` 与 frontend build error path。MVP 不做 visible text/class 泛化源码搜索。
- bridge activity 默认只给 metadata：method、phase、relativeMs、error code/message。MVP 不新增完整 params/result 摘要，避免引入长文本泄漏。

## Non-Goals / Out of Scope

- 不把 `inspect_frontend` 做成完整 DevTools dump。
- 不默认返回完整 DOM、完整 CSS、全量 resource timing、完整 bridge params/result、完整 workspace diff 内容。
- 不要求所有第三方/玩家前端强制实现业务 appState debug provider；可作为后续 opt-in 增强。
- 不在本任务中实现 visible text/class 到源码候选的泛化搜索。
- 不在本任务中解决跨域 remote frontend 检查、launcher 操作、存档选择等现有边界外能力。

## Acceptance Criteria

- [ ] `resourceFailures` 不再默认逐条展示 CDN/esm.sh Resource Timing 零字节 anomaly；真正资源加载失败仍可被识别。
- [ ] inspect 返回中有明确 wait telemetry，Agent 能区分本次等待耗时与 bridge quiet time。
- [ ] DOM action 成功但 runtime wait 未触发时，结果能清楚表达 action 成功 + wait not-triggered，而不是只有误导性的整体失败。
- [ ] inspect 默认返回可操作目标摘要，能帮助 Agent 稳定选择按钮、输入框、select、可点击卡片/generic 节点。
- [ ] action 执行后返回每步命中与结果摘要；wait 失败时不丢失动作证据。
- [ ] 低价值 computed styles / timing / console 重复项被过滤或折叠，模型-facing 返回明显瘦身。
- [ ] inspect 返回精简 frontend build status；build failure 可作为高置信 source hint。
- [ ] runtime error fileLineMap 与 build error path 可作为高置信 source hints 返回；不引入泛化源码搜索噪声。
- [ ] 文档和助手工具说明同步更新，明确 inspect 的过滤原则、wait 模式使用场景和 finish 义务。

## Open Questions

无阻塞问题。
