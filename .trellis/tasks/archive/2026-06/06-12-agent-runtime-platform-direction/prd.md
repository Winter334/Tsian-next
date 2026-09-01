# 记录 Agent Runtime 平台方向

## Goal

把本轮关于 Tsian 从 workflow-as-system 转向 Agent-Orchestrated AIRP Runtime 的讨论沉淀为当前项目方向文档，并清理会与新方向冲突或已经失去维护价值的旧文档，避免后续检索、规划和实现继续把旧 workflow / SillyTavern prompt-engine 方向误认为长期主线。

## Why This Matters

当前 active 文档仍把 `airp-workflow-platform-direction.md` 作为长期方向，内容强调可视 workflow、节点定义、stateModel、workflow preset 和 prompt preset 资源。用户已明确认为这套方向上层抽象不够、维护成本高、UI 不好用，且 SillyTavern 风格宏提示词引擎不适合作为未来核心。

新的方向应改为：

- 平台提供运行条件、包加载、沙箱、桥 API、存档实例、模型调用、权限和通用存储。
- AIRP 运行时由主控 Agent、专业 Agent 和通用工具组织，不再以固定 DAG / 可视 workflow 作为默认核心。
- 前端包负责解释运行时产出的数据并渲染游戏 UI；平台不定义通用 renderer、UI DSL 或玩法语义。
- 存档是一次 AIRP 会话 / 世界实例的数据容器，类似网页 AI 聊天会话记录；内容语义由 runtime 决定，平台只托管生命周期。

## Confirmed Facts

- 当前代码已经有两层前端结构：平台 WebUI 挂载 play frontend package，并通过 `PlayFrontendBridge` 通信。
- 当前 `interaction.sendMessage` 的核心链路仍在 `platform-host` 内跑 workflow，使用 `executeWorkflow()` 和 `result.reply` 产出正文。
- 当前 active 文档明确写着项目方向是 workflow-as-system。
- 当前 prompt-engine 仍围绕 SillyTavern preset、world book、regex、macro 和扁平字符串宏组装 prompt。
- 用户希望本次大方向变更建立 Trellis 任务，因为它会解释后续为什么旧文档被清理或降权。
- 用户已决定直接覆盖旧 `docs/active/airp-workflow-platform-direction.md`，不保留旧文件名对应的 workflow 权威方向。
- 用户倾向清理更多旧文档；以前的开发内容已经由 Trellis task 记录承载，过时文档继续存在会污染检索。

## Requirements

- 直接改写 `docs/active/airp-workflow-platform-direction.md`，明确 Agent-Orchestrated AIRP Runtime 是当前开发方向。
- 文档必须说明旧 workflow-as-system、可视 DAG workflow editor、workflow preset 和 SillyTavern prompt-engine 不再作为长期主线。
- 文档必须保留从旧原型中继承下来的有效边界：平台负责安全、权限、存档生命周期、模型调用、包加载、桥 API 和通用存储；runtime/agent 负责玩法系统；前端包负责渲染。
- 文档必须明确两层前端仍是合理边界，但当前 Bridge API 形态属于原型实现，未来可演进为沙箱 RPC + 更高层 game/runtime API。
- 文档必须明确平台不理解玩法语义，不硬编码事件/档案/MVU 字段，不定义通用 UI 插槽/渲染块 DSL。
- 文档必须明确运行时产出的数据与前端包之间可以有私有约定，平台无需显式理解该约定。
- 文档必须明确存档的新定义：AIRP 会话 / 世界实例容器，而不是固定 `events / archives / globals / stateRecords` 数据模型。
- 清理 active 文档入口，避免同时存在两个互相冲突的当前方向文档。
- 清理 `docs/reference/` 和 `docs/archive/` 中已经只会影响检索的旧骨架/旧方向文档；历史开发内容以 Trellis task 记录和 git history 为准。
- 删除旧文档时，保留必要的顶层 README 说明，解释旧设计文档已被清理以及为什么应优先相信 active 文档和 task 记录。

## Acceptance Criteria

- [x] `docs/active/` 的阅读顺序指向新的 Agent Runtime 方向。
- [x] `docs/active/airp-workflow-platform-direction.md` 被直接改写为 Agent Runtime 当前方向，不再保留 workflow-as-system 当前权威文本。
- [x] 项目根目录 `README.md` 的项目方向同步改为 Agent-Orchestrated AIRP Runtime。
- [x] `docs/README.md` 的当前稳定主干改为 Agent-Orchestrated AIRP Runtime。
- [x] `docs/active/current-state-handoff.md` 的下一步建议和方向说明不再要求继续打磨 workflow editor 作为默认主线。
- [x] `docs/active/deferred-work.md` 记录 workflow editor、SillyTavern prompt-engine、可视 DAG workflow 相关能力退场或降级的原因和回看条件。
- [x] `docs/reference/` 和 `docs/archive/` 中过时且会污染检索的历史骨架文档被删除或瘦身为不会误导当前方向的索引说明。
- [x] 新方向文档覆盖平台、runtime、frontend package、content/mod/save instance 的边界。
- [x] 文档能解释为什么未来检索到旧 workflow/prompt-engine 内容时应视为历史实现或原型遗留。
- [x] 不修改应用代码。
- [x] 不创建新 frontend/backend/runtime 实现。

## Out of Scope

- 不实现 Agent Runtime。
- 不修改 `interaction.sendMessage` 代码路径。
- 不删除 workflow-engine、prompt-engine 或 workflow editor 代码。
- 不为了保留历史叙述而维护旧方向文档；历史以 task 记录和 git history 为准。
- 不设计完整 agent prompt、工具 schema、模型调用 API 或沙箱 RPC 协议。
- 不设计动态 HTML/JS、RenderBlocks、UI DSL 或通用 renderer。
- 不做前后端物理拆分或服务端化。

## Planning Notes

- 这是方向文档和文档清理任务，不是代码迁移任务。
- 由于它改变当前项目规划权威来源，PRD-only 可能不足；应补 `design.md` 与 `implement.md`，明确哪些文档被新方向取代、哪些删除或瘦身。
- 文档清理应优先减少检索噪音，而不是保留完整历史副本。

## Open Questions

- None. 删除/保留清单已在 `design.md` 和 `implement.md` 中落地。

## Spec Update Decision

No `.trellis/spec/` update is needed for this task. The work changed project/product direction documents and cleaned stale documentation; it did not introduce executable contracts, API signatures, storage schemas, command behavior, or coding conventions. The new direction's authoritative home is `docs/active/airp-workflow-platform-direction.md`.
