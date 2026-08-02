# Agent 上下文边界与桌面助手检索治理

## Goal

建立清晰且可执行的 Agent 信息边界：桌面助手与游戏卡运行时 Agent 复用同一套运行机制，但不共享上下文、能力视图、工作区视图或 UI 投影；Agent 上下文、UI 上下文和诊断审计上下文各自独立。以此消除普通检索命中完整诊断请求、工具结果递归回灌、输入 token 暴涨和桌面助手无边界探索的问题，同时避免复制两套模型循环与工具执行逻辑。

## Background

- 一次桌面助手请求的最终 messages 约为 1,166,458 字符；最后一次搜索 observation 为 1,122,341 字符，占 96.22%。
- 普通 workspace 搜索会扫描 `.tsian/local/diagnostics/requests/`，而诊断记录包含此前完整模型请求和原始工具结果，形成自引用放大。
- 当前模型侧压缩限制单字段和数组项数，但缺少最终 observation 总量上限；搜索结果仍可聚合到百万字符。
- 连续 native `tool` message 会被同角色消息合并器拼接，破坏每个 `toolCallId` 与 observation 的一一对应。
- 当前代码已有“原始 tool call 供 UI/debug、tool memory 供 Agent 跨轮投影”的设计意图，但当前轮工具消息、普通检索和诊断资源使边界重新串流。
- `runAgentRuntimeTurn` 已由三个 host 入口复用，并通过 `AgentRuntimeCapabilities`、`workspaceTrustBoundary`、workspace mutation adapter 和 UI callbacks 注入差异；本任务应收敛这些现有 seam，而不是复制或重写模型循环。
- 桌面助手当前将完整普通工具 observation 同时写入 `ConversationMessageRecord.toolCalls` 与 timeline output，但 Assistant UI 对普通工具只显示名称/状态，不显示原始 output；只有 `agent_call` 使用结构化可读结果。完整普通 observation 当前是 debug 归档负担，不是 UI 渲染需求。
- 正式 Play UI 同样明确不展示完整工具参数/output；现有 output 传输主要是兼容/其它消费者通道。

## Confirmed Boundaries

- 桌面助手是平台控制面 Agent；游戏卡 Agent 是存档运行面的领域 Agent。桌面助手不是“权限更高的游戏 Agent”。
- 两类 Agent 共享无业务身份的运行内核，包括模型调用、tool-call 协议、流式输出、重试、中止、通用预算调度和 trace 关联。
- 两类 Agent 分别拥有环境提供的上下文策略、WorkspaceView、能力策略、事务策略、UI event sink、audit sink 和预算策略。
- 一次工具执行的内部原始结果必须分别投影为：有界的 `AgentObservation`、供界面渲染的 `UiEvent`，以及由底层审计策略决定保留内容的 `AuditEvent`。三者通过调用身份关联，但不得互相替代；没有真实消费者时不创建通用结果副本或 result store。
- 平台权限、环境隔离、事务、上下文投影、协议正确性和总量预算不能由可编辑 Skill/Tool 脚本负责。
- Skill 与专用 Tool 继续作为可替换扩展层；它们复用 registry/Worker runner，但只获得当前 Environment 提供的 WorkspaceView 和 capability，不能直接获得原始平台控制面 SDK。
- 诊断查询、可见前端检查等需要平台内部状态的能力属于仅向桌面助手环境暴露的受控 Platform Tool；Skill 可以提供使用 SOP，但不能绕过受控 Tool 访问内部状态。

## Requirements

### R1 — 三类上下文隔离

- Agent 上下文只包含模型当前任务所需的有界语义信息、证据引用和续读线索。
- UI 上下文保留渲染对话、流式过程和工具状态所需的结构化信息，但不得被直接重建为模型 messages。
- Audit 上下文保留完整 provider 请求、响应和错误，并保留可关联、可定位的工具执行事实、摘要、尺寸、截断状态和权威来源锚点；它不为每个工具 raw result 创建第二份通用副本，且默认不进入 Agent 上下文或普通业务检索。

### R2 — Desktop/Game Environment 隔离与内核复用

- 桌面助手和游戏卡 Agent 使用同一运行内核及工具执行基础设施。
- 两类运行入口必须从源头构造不同的 WorkspaceView、能力表、上下文生命周期、事务策略与 UI 投影，不得先装载一个扁平全集再在结果端过滤。
- 不允许通过遍布运行内核的 `isAssistant` / mode 条件分支表达环境差异；差异应由聚合的环境策略/端口提供。

### R3 — 工具结果三路投影

- Tool executor 产生一次内部 raw result；Agent、UI、Audit 各自消费专用投影。raw result 在投影完成后即可释放；需要长期存在的结果必须已有权威来源，或由能力显式写成 workspace/diagnostic 产物。
- AgentObservation 必须有最终序列化总量上限，不得只限制单字段；超限结果返回 preview、计数、截断状态、引用和可续读位置。
- UI 是展示投影的消费端，不负责保存、归档、压缩、重建或解释原始工具业务结果。UI context 只持久化渲染所需的调用身份、名称、状态、展示标题，以及 `agent_call` 等明确声明的展示 payload。
- UI 不因 Agent 观察被压缩而丢失必要的过程展示能力；若某种结果未来需要按需查看，必须先出现真实 UI 消费需求，再由底层提供有权威来源的引用，不预先加入无消费者的通用 `resultRef`。
- Audit 保留诊断所需事实和权威来源锚点，但不能通过普通 workspace search 反向进入 Agent 上下文。

### R4 — 检索域和诊断能力

- 普通 Agent workspace search 必须支持真实的路径/域约束，并默认排除诊断审计资源。
- 诊断检索通过桌面助手专属的受控能力显式进入；游戏卡 Agent 的 registry、WorkspaceView 和搜索索引中均不存在该能力和数据。
- 诊断检索默认搜索摘要/索引字段并返回有界结果；取得记录引用后才按需读取具体正文。
- 诊断记录中的完整 request body、messages 和 tool observations 不得作为普通全文检索结果直接返回模型。

### R5 — 原生工具协议正确性

- 每个 native tool call 必须保留独立 `toolCallId` 和独立 observation；同角色消息整理不得合并 `role: "tool"`，也不得合并带 tool calls 的 assistant 消息。
- 并行多工具调用的 Agent、UI、Audit 三路记录必须保持同一调用关联和发生顺序。

### R6 — 预算与停止边界

- 在最终 provider request 序列化完成后、发送网络请求前执行输入预算检查。
- 模型 context window 与产品消费预算分离；大上下文能力不能自动等价为允许发送同等规模输入。
- 桌面助手获得“最小充分证据”检索策略：已知文件直接读取，未知位置先做 scoped search，目录结构未知时才 list，证据足以回答后停止探索。
- 预算或结果上限触发时必须给出可恢复的引用/续读信息，而不是静默丢弃事实。

### R7 — 扩展能力边界

- Desktop-local Skill/Tool 与 card/runtime Skill/Tool 使用独立 registry roots 和能力视图，不能跨环境渗透。
- 稳定且涉及平台内部状态或安全边界的能力留在平台；随卡/玩法变化的 SOP、多步编排与领域转换放 Skill；单次输入输出且无需说明的可变领域能力可放专用 Tool。
- 本任务不通过新增 browser_script 权限解决平台上下文或诊断边界问题。

### R8 — 测试阶段演进与可观测性

- 项目仍处于测试阶段，本任务直接切换到新上下文契约，不实现既有桌面助手会话原始工具结果的扫描、搬运、回写、引用化或版本迁移。
- 旧 JSON 中的多余字段可以被新 reader 宽容忽略，但不得为旧数据新增迁移流程或持久兼容分支。
- 诊断和开发控制台应记录每轮工具名、toolCallId、结果投影字符数、累计模型输入估算及是否截断，避免再次只能从巨型请求反推问题。
- UI 的现有流式文本、工具状态、停止生成和历史时间线行为保持可用。

## Acceptance Criteria

- [ ] 普通 workspace search 即使查询词存在于诊断请求正文，也不会扫描或返回诊断记录。
- [ ] 只有桌面助手可见并可调用显式诊断查询能力；游戏卡 Agent 的工具 schema 和 WorkspaceView 中均不存在该能力或诊断数据。
- [ ] 构造至少 50 条含相同关键词和超长 request body 的诊断记录后，Agent-facing 单次搜索/诊断 observation 仍不超过配置的总量上限，并包含可续读引用。
- [ ] 一个 assistant round 并行调用多个 native tools 时，每个调用在下一轮模型消息、UI timeline 和 audit trace 中保持独立且关联正确。
- [ ] UI 可展示工具调用过程和声明过的展示 payload；普通工具原始结果不写入 UI context，UI 行为不改变后续 Agent messages 的大小或内容。
- [ ] 桌面助手与游戏卡 Agent 对相同 workspace primitive 复用同一执行器，但环境隔离测试证明二者看到的 registry、WorkspaceView、事务和上下文策略不同。
- [ ] provider request 发送前的最终预算测试能阻止超限请求，并返回可恢复的软错误或压缩结果。
- [ ] 针对原始复现场景，最终请求不再包含诊断请求正文或百万字符工具 observation；助手能以有限的、与问题相关的证据完成分析。

## Out of Scope

- 新增 browser_script executor 类型、原生文件系统、终端、DOM 或平台内部 bridge 权限。
- 重做 Frontend Action 协议或把 Frontend Action 纳入 Agent Tool/Skill registry。
- 修改具体游戏卡的玩法 schema、记忆策略或叙事业务规则。
- 以模型提供商更换、扩大 context window 或单纯提示词补丁作为主要解决方案。
- 对 Assistant 或 Play UI 进行无关的视觉重设计。
- 为当前不存在的桌面助手会话数据实现迁移、回填、旧 raw observation 引用化或长期兼容层。
- 在没有真实消费端的前提下新增通用工具结果持久化表或 `resultRef` 基础设施。

## Product Decisions

- D1：UI context 是消费端，不承担原始工具结果的业务职责。新记录不得继续持久化完整普通 observation；底层运行时/host 产出 Agent、UI、Audit 三种独立投影，UI 只保存展示投影。
- D2：项目仍在测试阶段且没有需保留的既有会话数据。本任务不实现复杂迁移；新 reader 可忽略旧字段，新 writer 只写新结构。
