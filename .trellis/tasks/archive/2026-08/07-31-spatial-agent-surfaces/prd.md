# Spatial Agent 工作界面

## Goal

先修正 RetroOS 桌面助手已有的 `ask_user` 默认输入行为与工具过程展示，再基于同一套问答、时间线和持久化契约适配 Spatial Studio 与 Spatial Desktop Assistant，避免把旧界面的交互缺陷复制到新外壳。

## Background

- `ask_user` Tool schema 声明 `allowCustom` 默认值为 `true`，但当前参数标准化只在 Agent 显式传值时才把该字段写入请求；桌面助手又仅在 `activeAsk.allowCustom` 为真时渲染自定义输入，因此 Agent 省略该参数后实际只显示选项。
- 当前桌面助手把相邻 Tool 节点按名称合并为自然语言摘要，并为每组建立独立折叠；组内主要显示 Tool 名称、简单状态符号，以及 `agent_call` 的受控展示内容。
- 游戏前端已经采用更完整的过程展示：连续过程节点进入一个默认折叠的“推演过程”，标题显示 Tool 调用次数，内部按真实时间线顺序逐项展示，Tool 行具有运行中、成功、失败状态文案和状态动效，并支持 `prefers-reduced-motion`。
- Agent/UI 数据边界已经明确：普通 Tool 的 UI timeline 只持久化调用身份、名称和状态；只有显式声明的 `UiToolPresentation` 可以携带玩家可读展示内容。优化展示不得把原始 Tool 参数或结果写入 UI/session。
- Spatial Agent 子任务原计划覆盖 Studio、桌面助手、流式会话、附件、询问交互和配置能力。RetroOS 修正应先形成共享行为基线，再由 Spatial 外观层复用。

## Requirements

### R1. `ask_user` 默认允许自定义回答

- `allowCustom` 省略时必须按 Tool schema 的既有声明解析为 `true`，不能把默认值留给各 UI 猜测。
- Agent 显式传 `allowCustom: false` 时保留“仅选项”行为。
- 有选项且允许自定义时，选项和自定义输入必须同时可用；无选项时必须提供开放输入。
- 默认值应在共享 `ask_user` 请求边界一次性标准化，使桌面助手、游戏运行时和后续 Spatial UI 收到一致的明确布尔值。

### R2. 桌面助手问答交互保持完整

- 自定义输入出现时自动聚焦，空白回答不可提交，提交值按现有行为去除首尾空白。
- 选项、自定义回答和取消都必须解除当前阻塞式 Tool 调用，并在时间线中留下只读问答记录。
- 活跃 `ask_user` 期间继续维持单一输入区域，不同时展示普通消息输入框与提问输入框。

### R3. 优化桌面助手过程与 Tool 展示

- 借鉴游戏前端的过程层级、信息密度、状态反馈、折叠动画和降低运动支持，但保留 RetroOS 自己的视觉令牌。
- Tool 节点必须保持真实时间线顺序和一调用一状态，不得用聚合摘要掩盖失败项或调用先后。
- 展示必须清楚区分运行中、成功和失败，并提供可访问的状态文本；状态更新不应造成布局跳动。
- `agent_call` 现有目标 Agent 标题、受控响应或失败信息必须保留，不能因改用简洁 Tool 行而丢失。
- 普通 Tool 不新增原始参数、原始结果或调试数据展示；继续遵守封闭 `UiToolPresentation` 边界。

### R4. 先形成共享基线，再适配 Spatial

- RetroOS 桌面助手修正与验证完成后，Spatial Desktop Assistant 复用相同的 `ask_user` 默认语义、时间线状态模型、持久化边界和 Tool 展示信息结构。
- Spatial 只替换视觉与空间承载，不复制一套独立的 Tool/ask 状态机。
- Studio 与桌面助手的流式请求、附件 Blob 生命周期、会话切换、滚动恢复、配置和事件订阅仍按现有领域边界复用。

## Acceptance Criteria

- [ ] Agent 调用 `ask_user({ question, options })` 且省略 `allowCustom` 时，桌面助手同时显示选项和自定义输入。
- [ ] Agent 调用 `ask_user({ question, options, allowCustom: false })` 时只显示选项，不显示自定义输入。
- [ ] Agent 调用无选项的开放问题时可直接输入并提交自定义回答。
- [ ] 选项、自定义输入、取消、会话切换和中止路径均不会留下悬空的 interaction request。
- [ ] 桌面助手过程展示按原始 timeline 顺序呈现每次 Tool 调用，运行中、成功、失败均有稳定且可访问的状态反馈。
- [ ] Tool 过程默认可折叠并有清晰摘要；展开后每次调用独立可辨，不再依赖相邻 Tool 的自然语言聚合。
- [ ] `agent_call` 的目标名称和受控结果/错误展示保持可访问；普通 Tool 的原始参数和结果仍不会进入 UI timeline 或会话持久化。
- [ ] 展开/收起、计数和状态动效尊重 `prefers-reduced-motion`。
- [ ] RetroOS 桌面助手手动验收通过后，Spatial Assistant 使用同一行为模型完成适配，聚焦、侧置、遮挡或最小化不打断流式请求与 `ask_user` 等待。
- [ ] 相关 contracts、platform-web 类型检查、单元测试和 Web 构建通过。

## Out of Scope

- 在普通 Tool 卡片中展示原始调用参数、完整 observation、trace 或调试数据。
- 把游戏前端的余烬配色、字体和叙事视觉主题直接复制到 RetroOS 或 Spatial。
- 在本子任务中修改 Tool 的模型侧 observation 交付契约；该工作仍由 `agent-tool-observation-contract` 独立治理。
- 提前启用 Spatial production release gate；发布仍由 `spatial-release-integration` 子任务负责。

## Key Decisions

- **D1 — `ask_user` 默认值归一化**：`allowCustom` 省略时在共享 Tool 请求边界解析为 `true`；显式 `false` 才关闭自定义输入。各 UI 不再各自猜测默认值。
- **D2 — 单一总过程折叠**：每条助手回复使用一个默认折叠的“执行过程”，内部按真实 timeline 顺序逐项展示，不再按相邻 Tool 生成多个自然语言分组。
- **D3 — 参考结构而非复制主题**：复用游戏前端的过程层级、Tool 计数、独立状态行、状态动效和 reduced-motion 行为；RetroOS 与 Spatial 分别使用自己的视觉令牌。
- **D4 — 先基线后适配**：先完成并手动验收 RetroOS 桌面助手修正，再抽取共享状态边界并实现 Spatial Studio/Assistant；Spatial release gate 始终保持关闭。
