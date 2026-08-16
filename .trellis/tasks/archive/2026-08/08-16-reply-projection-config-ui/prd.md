# 正文后处理配置 UI

## Goal

为游戏卡作者提供独立的正文后处理（Reply Projection）桌面应用，让作者通过专用结构化界面组织有序正则规则并配置 `content` / `displayContent` / `projections` 三条输出。

产品价值：消除 JSON 双重转义和字段互斥带来的机械编辑负担，同时保持现有正则与值管道语义直接、透明。

## Background / Confirmed Facts

- Reply Projection 是游戏卡级能力，配置文件固定为 `config/reply-projection.json`，schema 为 `tsian.reply-projection.v1`；它随游戏卡内容分发，不属于设备级平台设置。
- Reply Projection 不是 Agent 粒度能力：配置没有 `agentId` 作用域，也不接收 agent id 或 purpose 作为匹配条件。
  - 正式玩家回合对入口 Agent 的最终回复自动应用同一份卡级配置，并把 projected assistant item 直接交给前端。
  - `persist: true` 的旁路 `invokeAgent` 在写回 Agent context/transcript 时也应用同一配置，但 `InvokeAgentResult.response` 和实时 delta 仍是原始文本；前端若要立即渲染旁路投影结果，需显式调用通用 `reply-project` action，或读取已持久化的 projected transcript。
  - `persist: false` 的 `invokeAgent` 不走自动持久化投影；内部 `agent_call` 的工具结果不会作为独立顶层回复再次投影。
  - 开局或其他受控脚本可通过 `reply.project` 主动把任意文本送入同一份卡级规则。
- 旁路 projected transcript 有现存消费者：开局访谈请求 `transcript: { mode: "full", audience: "player" }`，页面恢复时读取 transcript assistant 的 `displayContent` 与 `projections` 重建可见对话和选项。旁路持久化 context 还使用 projected clean `content` 作为后续 Agent 上下文。因此旁路投影不是纯粹未使用代码，移除会改变现有会话恢复和上下文契约。
- 当前配置只能通过资源管理器的通用 JSON 编辑器手工维护；通用编辑器只校验 JSON 语法，不校验 Reply Projection 规则语义，也没有输入输出预览。
- 规则按文件顺序执行。每条规则包含 `id?`、必填 `match`，以及两组可组合动作：
  - 文本替换：`text`，或互斥的 `content` / `display`。
  - 结构提取：`project`，支持普通 key 覆盖、`key[]` 追加，以及 `$&` / `$1` / `$<name>` 捕获引用和 `trim` / `lines` / `stripList` 管道。
- 平台已有同一套正式解析、执行和结构化 diagnostics；UI 不应重新发明另一套规则语言或行为模拟器。
- 缺少配置文件时系统执行 identity projection；配置或单条规则失败时系统 fail-soft，并返回 diagnostics。
- “沉浸阅读器”当前有两条真实规则，可作为首个回归和手工验收样例：正式选项与开局选项提取。
- 原系统设计已明确：v1 JSON short format 应保持紧凑，适合未来 UI 编辑，不应演变为密集表单页。
- 平台同时维护 retro 与 spatial 两套壳层视图；配置加载、草稿、序列化和保存逻辑应共享，壳层只负责呈现。
- 本任务冻结现有 `tsian.reply-projection.v1` 字段、卡级全局作用域和正式/旁路运行时接入；不借 UI 建设重写或删减 Reply Projection 契约。
- 首版应用只服务 `config/reply-projection.json`，不预设其他卡级文本处理配置；桌面名称使用“正文处理”。

## Requirements

- R1. 新增名为“正文处理”的独立桌面应用，只服务当前游戏卡的 Reply Projection；不放入围绕单个 Agent 的“工作室”，也不放入设备级“控制面板”。
- R2. 配置不存在时提供清晰的创建入口；存在时可加载、编辑并以原路径保存，继续使用现有 Workspace 并发写入与只读边界。
- R3. 以有序规则列表呈现配置，支持选择、新增、复制、删除和拖拽/按钮排序；折叠态展示规则名称、正则摘要和紧凑能力标签。
- R4. 规则详情以结构化编辑为主：
  - 主界面固定为三个紧凑区段：`匹配`、`文本替换`、`数据投影`；不使用长说明、向导步骤或内部实现流程图。
  - `匹配` 编辑规则名称/id 与完整 JavaScript 正则字面量，例如 `/pattern/g`；正则原样编辑，不再拆成或生成其他配置。
  - `文本替换` 使用“不替换 / 同时替换 / 分别替换”三种模式。需要出现内部字段时使用短解释：`content` 是后续 Agent 上下文文本，`display` 是玩家界面显示文本；保留字段缺失与显式空字符串的差异。
  - `数据投影` 直接编辑 project key 和完整管道表达式，例如 `$1|lines|stripList`；简短说明 key 后缀 `[]` 表示追加，`project` 是交给游戏界面的结构化数据，不增加捕获组选择器或 transform 勾选器。
- R5. 规则列表只显示名称、正则摘要和紧凑能力标签，例如“同时替换 · 投影 choices”；不生成长用途说明。
- R6. 编辑器通过结构化控件避免生成互斥字段组合或无效 JSON；不提供样本文本输入、命中测试、输出预览或额外的“效果校验”流程，实际效果由作者在真实卡片中测试。
- R7. 专用应用不内嵌原始 JSON 编辑器；需要直接编辑文件时，提供“在资源管理器中编辑配置文件”入口，复用现有 Workspace 编辑器。
- R8. 支持未保存变更提示、关闭保护、Ctrl/Cmd+S、保存成功反馈和外部并发修改冲突提示。
- R9. retro 与 spatial 两套桌面壳都能完成同等功能；窄窗口下规则列表与详情可纵向切换，不依赖固定宽屏。
- R10. 不把 choices、openingChoices 或其他玩法语义写死进平台 UI；编辑器保持通用。
- R11. 保持现有卡级全局作用域，不新增按 Agent 或 purpose 过滤的规则作用域。
- R12. 保持 `id`、`match`、`text`、`content`、`display`、`project` 以及 projector 结果字段的现有语义与兼容性；UI 必须无损读写当前配置，而不是推动 schema 迁移。

## Acceptance Criteria

- [ ] 作者能在独立桌面应用中创建、打开并保存当前卡的 Reply Projection 配置，无需进入资源管理器手写 JSON。
- [ ] 作者能新增、复制、删除、排序规则，并完整表达 v1 已支持的 match、替换和 project 语义。
- [ ] 界面在暴露 `content`、`display`、`project` 时提供简短用途解释；作者不需要从无说明的内部字段名反推行为。
- [ ] 完整正则字面量、空字符串替换、content/display 分流、普通 key 与 `key[]` 追加均能无损往返到现有 JSON 格式。
- [ ] 编辑器不要求作者提供或构造样本文本，不包含即时命中测试、投影预览或与运行时重复的效果校验器。
- [ ] 结构化编辑不会生成 `text` 与 `content` / `display` 并存等互斥配置，也不会破坏作者直接输入的正则和值管道语义。
- [ ] project 管道表达式按原格式直接编辑并无损往返，不增加另一套向导式表达方式。
- [ ] 专用应用不重复实现原始 JSON 编辑器；无法无损结构化的配置会阻止结构化保存，并提供资源管理器编辑入口，不能静默删除未知字段。
- [ ] 缺少配置、只读内置卡、外部并发修改和未保存关闭四种边界都有明确、安全的 UI 行为。
- [ ] retro 与 spatial 两套桌面壳均可使用，窄窗口布局仍可完成完整编辑。
- [ ] `npm run build:web` 与现有 Reply Projection smoke 通过；UI、键盘、只读、冲突和窄窗口行为按项目策略完成人工验证，不新增独立 UI/controller 测试文件。

## Out of Scope

- 修改 Reply Projection 在正式回合、开局回合、历史和前端桥接中的既有运行时语义。
- 引入任意 JavaScript 后处理脚本、条件、循环、深层对象模板或新的玩法专用 projection key。
- 对旧历史正文重新投影。
- 把 `<think>` / `<thought>` / `<thinking>` 剥离等其他硬编码解析逻辑纳入本界面。
- 在第一版中实现可视化正则 AST/流程图或逐字符匹配高亮。
- 样本文本试验台、正则命中测试、投影结果预览或额外的行为校验器。
- 在专用应用内重复实现原始 JSON/代码编辑器。
- 新增按 Agent / purpose 的规则作用域。
- 删除或重构 v1 规则字段、projector 结果字段、正式回合投影、旁路 projected context/transcript 或显式 `reply.project` 接入。
- 把首版应用抽象为承载其他卡级文本处理配置的通用外壳。

## Notes

- 本任务属于复杂任务；规划需包含 `design.md`、`implement.md` 与 sub-agent context manifests，并经过最终评审后才能进入实现。
