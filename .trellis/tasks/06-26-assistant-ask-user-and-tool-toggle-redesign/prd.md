# ask_user 助手开关与工具开关体系重设计

## Goal

让桌面助手具备 ask_user 能力（向玩家提问并接收回答），同时把 Agent 工具开关体系从扁平列表升级为可扩展的分组形态，支撑未来工具数量增长。

## Background（调研确认的事实）

工具开关现状矩阵（合同 / 权限常量 / schema 门控 / 运行时门控 / Studio 面板 / 助手面板）：

| 工具 | 合同 AgentPlatformToolName | permissions 常量 | schema 门控 | 运行时门控 | Studio 面板 | 助手面板 |
|---|---|---|---|---|---|---|
| ask_user | ✓ runtime.ts:259 | ✗ 缺 | ✗ 永远暴露 (tool-schemas.ts:463) | 仅 onAskUser 是否存在 | ✗ | ✗ |
| workspace_semantic_search | ✓ | ✓ | ✓ 权限 | ✓ | ✓ | ✗ 缺 |
| agent_call | ✓ | ✓ | ✓ 权限+联系人 | ✓ | ✓ | ✓ |
| workspace_read (read/list/search/glob) | ✓ | ✓ | ✓ 权限 | ✓ | ✓ | ✓ |
| workspace_write (diff/write/edit/move/delete) | ✓ | ✓ | ✓ 权限 | ✓ | ✓ | ✓ |
| inspect_frontend | ✓ | ✓ | ✓ 权限 | ✓ | ✓ | ✓ |
| use_skill / run_script | 非平台工具 | — | ✗ 永远开 | — | ✗ | ✗ |

关键问题：
1. **ask_user 是幽灵工具**：合同层声明了，但 permissions 常量/schema 门控/UI 开关/host 绑定四层都只接了一半。schema 无条件暴露给所有 agent，助手路径没绑 onAskUser，调用即抛 ASK_USER_UNAVAILABLE。
2. **两面板不一致**：助手面板漏了 workspace_semantic_search 开关（Studio 有）。
3. **UI 不可扩展**：扁平 checkbox 列表，工具一多就堆叠难管。

相关代码位置：
- 权限常量：`apps/platform-web/src/agent-runtime/permissions.ts`
- schema 组装：`apps/platform-web/src/agent-runtime/tool-schemas.ts:443 buildEnabledToolSchemas`
- ask_user schema：`tool-schemas.ts:78`，无条件 push 于 `:463`
- ask_user 运行时门控：`workspace-tools.ts:2243`
- 助手 onAskUser 绑定：缺失（仅 `platform-host/index.ts:783` 游戏路径绑了 emitInteractionRequest）
- Studio 面板控件：`StudioView.vue:350 platformToolControls`
- 助手面板控件：`AssistantConfigPanel.vue:224 platformToolControls`

## Requirements

### R1 ask_user 助手能力补全
- 助手聊天路径绑定 onAskUser（承接玩家回答的回调）。
- 助手配置面板增加 ask_user 开关。
- ask_user 纳入 per-agent 平台工具权限体系（permissions 常量 + schema 门控），不再无条件暴露。
- 玩家回答的渲染 UI（提问气泡 + 选项/自定义输入 + 提交）。

### R2 开关体系整体重设计
- 评估细粒度拆分：是否把 workspace_read / workspace_write 拆成单 op 开关。
- UI 改成可扩展的分组/折叠形态，扛住工具数量增长。
- 统一两个面板的开关集合（补齐助手面板缺失项）。

## Acceptance Criteria

- [ ] 助手配置面板可见 ask_user 开关，切换后 schema 暴露/隐藏随之生效。
- [ ] 助手调用 ask_user 时，玩家侧出现提问 UI，回答后 turn 继续。
- [ ] ask_user 在未启用时不出现在任何 agent 的工具 schema 中。
- [ ] 游戏内 master/delegated agent 的 ask_user 行为不被破坏（现有 onAskUser 路径保持）。
- [ ] 助手面板与 Studio 面板的平台工具开关集合一致（含 semantic_search、ask_user）。
- [ ] 工具开关 UI 在 ≥10 个工具项时仍可读、可操作（分组或折叠形态）。
- [ ] lint / type-check / 既有测试通过。

## Decisions（brainstorm 已定）

- **D1 开关粒度**：保持组粒度（workspace_read / workspace_write 不拆单 op），重设计集中在顶层开关补全 + UI 重新分组。理由：组内是语义耦合原语，单 op 拆分只增负担不增价值；exposedWorkspaceOperations 派生层不必动。
- **D2 ask_user 归属与范围**：ask_user 进通用 per-agent 平台工具体系，所有 agent（master/delegated/assistant）都能切，不做区别对待。游戏内与玩家交互走 `[[选项]]` 格式块（非阻塞），ask_user 是并存的阻塞式机制。调研确认 ask_user 当前是 native 模式下与 `[[选项]]` 并存的另一条阻塞式机制（interaction-request → 前端 ask-panel），非取代关系。
- **D3 游戏路径 ask_user**：保留游戏 host 全套 ask_user 链路（onAskUser 绑定 + emitInteractionRequest + 前端 ask-panel），仅做"默认关 + schema 门控接入权限"。游戏 agent 手动开 ask_user 时仍走 interaction-request → 前端 ask-panel。
- **D4 ask_user 默认态**：助手默认开、游戏 agent 默认关。靠 agent.json 显式声明（`defaultAssistantConfig` 的 enabled 数组含 ask_user，游戏 agent 不含），不靠运行时派生。开关 = 显式数组，所见即所得。实现期纠正：初版尝试运行时派生引入"派生与显式脱节"bug，已回到项目既有模式。
- **D5 UI 分组**：按职能分 3 组（协作与交互 / Workspace / 前端自检），默认全展开不折叠。use_skill/run_script 不展示开关（Skill 体系内置入口，永远开）。

## Background 补充（调研确认的 ask_user 现状）

- 游戏内 master：text 模式提示词只教 `[[选项]]`（index.ts:276），看不到 ask_user；native 模式 ask_user 无条件可见（tool-schemas.ts:463）且 host 绑了 onAskUser（index.ts:783），能阻塞式问答。
- delegated agent：game 入口下透传 input.onAskUser（index.ts:1288），native 模式能调 ask_user 冒到 game 前端。
- 助手（assistant-chat.ts）：native 模式 ask_user 可见但**未绑 onAskUser**，调用即抛 ASK_USER_UNAVAILABLE；AssistantView 无 ask-panel 渲染；助手是进程内 Vue 组件，不走 iframe bridge，不能直接复用 game 的 interaction-request 桥协议。
- 游戏路径 ask_user 链：emitInteractionRequest（interaction-events.ts:48）→ remote-iframe-bridge 订阅（:518）转 interaction-request 事件 → 前端 ask-panel → bridge.respondInteraction RPC 回填 → resolveInteractionRequest resolve 等待 Promise。

## Out of Scope

- 单 op 级细粒度开关（D1 已排除）。

## Open Questions（阻塞规划）

- 无。全部决策已定，可进入 design + implement。
