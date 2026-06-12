# Tsian Agent Runtime Platform Direction

## 1. 文档目的

本文档记录 Tsian 当前可信的产品与架构方向。

当前答案是：

`Tsian 是一个面向 AIRP 的 Agent-Orchestrated Runtime 平台。`

AIRP 的核心运行不再以固定 DAG 工作流、可视 workflow editor、SillyTavern prompt preset 或宏变量组装为长期主线。新的主线是：玩家与主控 Agent 进行 AIRP，会话中的主控 Agent 根据玩家输入、上下文和运行时数据，按需调用专业 Agent 和通用工具，组织剧情正文、记忆管理、状态维护和前端可渲染数据。

当前 MVP 已将旧 workflow / prompt-engine 主链从活跃架构中移除；相关历史应通过 Trellis task 和 git history 查询。

Agent Framework、Skill 按需加载和 Runtime Workspace 的细化方向见 `docs/active/agent-framework-runtime-workspace-direction.md`。

## 2. 核心定位

Tsian 不是单纯的 AI 聊天壳，也不是只服务一套事件/档案记忆模型的固定框架。

Tsian 的核心定位是：

`面向 AIRP 的可配置 Agent Runtime 平台。`

平台应让作者和玩家组合自己的 AIRP 系统：

- 主控 Agent 如何理解玩家输入并组织本轮回合。
- 专业 Agent 如何负责正文、记忆、状态表、规则、审校或其它领域。
- 通用工具如何读取历史、检索记忆、调用模型、访问存储、提出状态变更。
- 运行时产出的数据如何被前端包解释和渲染。
- 存档实例如何保存、恢复、导入、导出和回滚。

默认 AIRP 体验可以很强，但它应该是一个默认 runtime/content/frontend 组合，而不是平台本体。

## 3. 系统模型

一个 Tsian 系统由以下部分组合而成：

1. **Platform**：包加载、沙箱、桥 API、模型调用、权限、通用存储、存档实例生命周期、导入导出。
2. **Agent Runtime**：主控 Agent、专业 Agent、通用工具、AIRP 回合组织、运行时数据产出。
3. **Frontend Package**：游戏界面、交互和渲染。它按自身约定解释 runtime 产出的数据。
4. **Content / Mod**：世界观、玩法规则、agent 配置、初始数据、资源、可选的 runtime/frontend 绑定。
5. **Save Instance**：一次 AIRP 会话 / 世界实例的数据容器。

简化表达：

`System = platform boundary + agent runtime + frontend package + content + save instance`

## 4. Agent Runtime

Agent Runtime 是 AIRP 回合的核心。

推荐默认心智模型：

- **主控 Agent**：玩家实际交互对象。负责理解玩家输入、判断本轮目标、选择工具、调用专业 Agent、决定是否需要记忆整理或状态更新。
- **正文 Agent**：负责生成玩家可读剧情正文。它接收主控给出的写作任务和受控上下文，可按权限使用只读工具补查历史、记忆或设定。
- **记忆 Agent**：负责长期记忆治理，例如归档、摘要、合并、压缩、整理索引。它不垄断检索；检索可以是通用工具。
- **状态 / MVU Agent**：负责维护前端包可渲染的状态表，例如位置、任务、关系、资源、风险、时间等。状态语义由 runtime 与前端包约定，不由平台硬编码。

专业 Agent 不必每轮都调用。主控 Agent 可以根据玩家意图、上下文长度、剧情变化程度和状态变化需求决定是否调动它们。

## 5. 工具原则

工具应尽量通用，避免重新陷入底层节点泥潭。

推荐工具类别：

- 读取最近历史。
- 搜索或读取记忆记录。
- 读取或写入运行时数据。
- 读取内容资源或设定。
- 调用模型。
- 调用另一个 Agent。
- 校验结构化输出或状态变更。
- 压缩上下文或生成摘要。

AIRP 特色优先放在 Agent 职责、skill、content 和 runtime 数据结构中，而不是注册大量只服务默认事件/档案系统的窄工具。

## 6. 平台边界

平台负责运行条件和安全边界。

平台应该负责：

- 加载 runtime 包、前端包和内容包。
- 为前端包提供 iframe 或类似沙箱。
- 提供 Bridge API / Capability API。
- 托管模型提供商配置、API key、模型调用、速率限制和缓存策略。
- 托管通用存储、存档实例、checkpoint、导入导出。
- 管理权限，避免前端包或 runtime 直接接触未授权能力。
- 执行受控工具能力，例如模型调用、存储访问、资源读取。

平台不应该负责：

- 记忆系统具体怎么设计。
- 哪些字段表示事件、档案、任务、地图、关系或 MVU 状态。
- 前端如何渲染运行时数据。
- Agent 之间具体如何分工。
- 默认 AIRP 事件/档案模型。
- 通用 UI 插槽、渲染块 DSL 或 HTML/JS 产出标准。

## 7. 前端包边界

前端包负责游戏界面和玩家体验。

前端包通过 Bridge API 获取授权数据和执行动作，例如：

- 发送玩家输入。
- 读取当前存档实例的运行时数据。
- 订阅或拉取会话消息。
- 执行平台允许的动作，例如保存、回滚、导入导出或设置更新。

运行时产出的数据如何渲染，是 runtime 与前端包之间的私有约定。平台不需要显式理解该约定。

同一 runtime 可以搭配不同前端包，形成不同风格的 AIRP 游戏界面。一个前端包也可以完全自定义本地 UI 逻辑，只在需要平台能力时通过 Bridge API 调用。

当前代码中的直接对象式 `PlayFrontendBridge` 是原型实现。长期可以演进为 iframe / worker / postMessage 风格的 RPC Bridge，但这属于通信和沙箱技术选择，不改变“前端包只通过受控能力访问平台”的边界。

## 8. 存档实例

存档不是固定事件/档案/状态表结构。

在新方向中，存档是：

`一次 AIRP 会话 / 世界实例的数据容器。`

它类似网页 AI 聊天中的会话记录，但可以包含更丰富的 runtime 数据。

平台关心：

- 这个实例属于哪个内容包、runtime 包和前端包。
- 如何创建、选择、保存、恢复、导入、导出和删除。
- 如何保存 checkpoint 或回滚点。
- 如何提供通用存储容器。后续方向是把这个容器表达为 Runtime Workspace，即存档级虚拟文件系统。

平台不关心：

- runtime 内部是否有 events、archives、globals、memory fragments、quests、map nodes、relationships 或 UI state。
- 某个字段应该如何被前端渲染。
- 哪个 Agent 负责维护某类数据。

结构化游戏状态、记忆、前端数据、Agent 定义和 Skill 定义都可以成为 Runtime Workspace 中的文件/目录约定；平台只维护文件 API、checkpoint、索引、执行边界和生命周期，不理解具体玩法语义。

## 9. 旧方向定位

以下内容不再作为长期主线：

- workflow-as-system 作为平台核心定位。
- 可视 DAG workflow editor 作为默认作者体验。
- workflow preset 作为 AIRP 主链配置中心。
- SillyTavern prompt preset / world book / macro pipeline 作为核心 AI 节点抽象。
- 平台级 generic renderer adapter。
- 平台级 schema resource 主线。

这些实现和文档曾帮助项目验证记忆、状态写入、前端渲染和平台边界，但未来新功能不应以适配它们为默认目标。

## 10. 当前实施口径

当前第一版实现是内容为空的 Agent Runtime 纵切：

- `apps/platform-web/src/platform-host/index.ts` 仍是浏览器平台主控。
- `apps/platform-web/src/agent-runtime/index.ts` 承载 MVP Agent Runtime。
- 每轮默认走 `master-agent` → `narrative-agent` 两步模型调用。
- 会话存储只保留 snapshot、history、checkpoint 和 generic stateRecords。
- 官方默认前端只渲染对话、AI debug、checkpoint、snapshot 和 stateRecords。

后续实现不应恢复旧 workflow / prompt-engine 作为默认主链。

后续规划新任务时，先问：

1. 这个能力属于 Platform、Agent Runtime、Frontend Package、Content / Mod，还是 Save Instance？
2. 它是否把默认 AIRP 事件/档案语义硬编码进平台？
3. 它是否要求平台理解前端渲染语义？
4. 它是否把旧 workflow / prompt-engine 作为必须兼容的主线？
5. 它是否保持模型调用、存储、权限和存档生命周期由平台掌控？

若答案显示实现正在重建旧 workflow 主线，应回到本文档重新切分边界。
