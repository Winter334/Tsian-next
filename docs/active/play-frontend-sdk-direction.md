# Tsian Play Frontend SDK Direction

## 1. 文档目的

本文档记录 Tsian 游戏前端与桥 SDK 的当前可信方向。

当前答案是：

`游戏前端的协议对接由官方维护的领域 API（domain API）封装；表现层由桌面助手 agent 基于 SDK 自由构建，不内置黑盒渲染层。`

SDK 不只是协议封装，而是面向游戏前端开发者的**领域语言**——把裸 RPC（`bridge.call("interaction.sendMessage", ...)`、事件名、params 结构）吸收成前端心智里的动词（`tsian.send()`、`tsian.onMessage()`、`tsian.history.get()`）。协议层（postMessage 握手、RPC id 匹配、消息路由）留在包内部，不公开导出。旧的"平台内置一整份黑盒默认前端"形态被拆解：协议层抽成独立 SDK 包，表现层成为助手可自由 fork 的默认前端。本方向取代之前讨论中残留的"starter 模板与默认前端分两份""SDK 提供 mountChat 多档定制 API""窄 API 少出错""薄 SDK 只做协议直译"等过渡构想。

桥协议本身（`tsian.play-bridge.v1`）仍是 `packages/contracts/src/bridge.ts` 中的稳定契约。本方向决定 SDK 的形态与职责切分。Agent Runtime 与运行时数据语义见 `docs/active/agent-framework-runtime-workspace-direction.md`，平台边界见 `docs/active/airp-workflow-platform-direction.md`。API 参考（方法签名 / 回调形状 / 示例）见 `docs/sdk/play-frontend-api.md`。

## 2. 核心定位

Tsian 不是玩家自托管、官方只发 SDK 的中立嵌入模型。玩家通过官方域名访问官方托管的平台进行游玩——平台 host 与默认前端在同一更新域内，一次部署同步更新。这是本方向所有取舍的前提。

基于此前提，SDK 的定位是：

`游戏前端与平台之间的领域 API，官方同源维护、CDN 分发。SDK 是翻译层不是决策层——把桥协议的所有能力用前端能懂的语言暴露，不丢能力，不做表现意图相关的决定。`

SDK 负责把助手无法自实现的那一层——与平台的协议契约——翻译成前端开发者心智里的动词。表现层（渲染、流式 UX、布局、主题）交给助手 agent 自由构建，不进 SDK。

## 3. 职责切分

### 3.1 SDK 负责（封死，助手不碰）

- 桥协议握手（hello / ready / sessionId）。
- RPC 传输与 id 匹配——但**不暴露 method 字符串**，封装成领域方法（`tsian.send` / `tsian.history.get` / `tsian.workspace.read` / `tsian.query` / `tsian.runAction`）。
- 事件订阅——但**不暴露原始事件名**，路由 + 聚合成 5 个语义回调（`onMessage` / `onRoundEnd` / `onTurnEnd` / `onTool` / `onAsk`）。`onTurnEnd` 聚合 `turn-options` + `turn-stats` + `turn-completed` 三个底层事件。
- injection 透传（`send`/`invokeAgent` 的 `injection` 参数），校验结构但不解释语义。
- workspace 读写（`tsian.workspace.read/list/search/write`）——独立 RPC method，不再塞进 `query.query`。
- 错误归一与状态暴露（`ready` / `waitForReady()` / `sessionId`）。
- 全部相关 TS 类型导出（`TsianApi`、事件回调类型、`InjectionMessage`、workspace 类型等）。

SDK 的对外类型签名即公开 API，当正式契约对待，不随手破坏。API 形态是第一版，允许根据实际前端开发反馈调整。详见 `docs/sdk/play-frontend-api.md`。

**SDK 不暴露**：裸 `bridge.call`、`createBridge`/`Bridge`、RPC method 字符串（`"interaction.sendMessage"` 等）、原始事件名（`turn-delta` 等）。这些是包内部实现，前端开发者不需要接触。高频能力走语义化方法，冷门/未来新增走 `tsian.query`/`tsian.runAction` 通用入口（领域语言里的"查资源/执行动作"）。

### 3.2 SDK 不负责（助手地盘，自由构建）

- delta 累加与流式 UX。SDK 通过 `onMessage` 发结构化增量（`kind` 区分 reasoning/content），真流式（订阅累加）与假流式（等 `onTurnEnd` 用动画放出）都是前端的选择。
- 消息渲染、markdown、气泡结构。
- 工具节点呈现（timeline / 卡片 / 折叠 / 动画）。
- 布局、主题、样式、状态栏、空状态、错误提示。
- injection 的语义——注入什么由前端决定，平台只按 role + position 放进消息序列。
- 任何与表现意图相关的语义归一。

核心红线：助手生成的前端里不应出现 `addEventListener("message", ...)`、不应自己管 `postMessage` 握手、不应自己拼 RPC id 匹配、不应 import `createBridge` 或写 method 字符串。一旦助手开始写这些，说明 SDK 没把协议层藏好。

## 4. 数据真相与流式分层

数据真相来自 workspace 的 turn 文件（持久化的 timeline），不是前端内存累加。两条数据路径，归一责任不同：

| 数据 | 来源 | 归一归属 |
|---|---|---|
| 历史对话（持久化） | `tsian.history.get()` 从 workspace turn 文件读回 `SessionHistoryEntry.timeline` | host 已归一，前端直接渲染 |
| 流式增量（回合进行中） | `tsian.onMessage` 发结构化 delta（`kind` 区分 reasoning/content） | 前端自处理 |
| 工具过程（回合进行中） | `tsian.onTool` 单次状态变更 | 前端自处理 |
| 轮边界（回合进行中） | `tsian.onRoundEnd` 区分 interim vs final | 前端自处理 |
| 回合定稿 | `tsian.onTurnEnd` 聚合 options + stats + 完成信号 | 前端收尾 |

关键设计：**回合进行中，前端用流式增量就地渲染（过程节点穿插、流式正文），`onTurnEnd` 到达时就地修正流式 DOM 为正式态（折叠过程节点、剥离选项标记、渲染选项按钮）。不在此 reloadHistory 重建**——重建会 `$story.innerHTML=""` 全清，破坏流式时已正确的穿插顺序，且冲掉就地渲染的选项按钮。**重载/回溯后**（无流式 DOM）才用 `history.get()` 从 turn 文件单源重建。

这让前端的流式实现从"必须正确"降级为"尽力流畅"——即使增量累加有偏差，回溯/重载后 `history.get()` 从文件重建即归零纠正。数据正确性押在 workspace turn 文件，不押在前端累加。

增量层归一与表现意图强相关（线性累加 vs 图谱 vs 假流式是不同意图），留在前端；历史层归一与表现意图无关（timeline 谁看都一样），host 已归一。

## 5. injection：前端加工状态注入

平台只有一个 `contextPaths` 机制给 agent 注入常驻上下文（文件全文、路径写死、平台组装时机固定）。injection 填的空白：前端加工后的状态、非 user 角色的信息、注入位置控制。

`send`/`invokeAgent` 带 `injection: InjectionMessage[]`，每条有 `role`（system/user/assistant）+ `content` + `position`（before-input/after-input，单条级别）。平台按 role + position 插进 agent 上下文消息序列，**不落盘、不进 turn 历史、不进 context.json 快照、不解释语义**。注入什么由前端决定——前端若需跨轮保持状态，落盘到 workspace（`tsian.workspace.write`），每轮 `send` 时读出再注入。

详见 API 文档 §3.3。

## 6. 默认前端：三合一单真相源

不存在独立的"starter 模板"。默认前端 `apps/play-frontend-dev/src/main.ts` import 领域 API（`createTsian`），同时承担三个角色：

| 角色 | 用法 |
|---|---|
| 官方默认前端 | 打进 packaged 默认卡，玩家开箱即见 |
| 助手起点 | 玩家让助手改前端时，助手读这份学结构并 fork |
| 官方测试基准 | 验收桥协议、回归流式/工具/history 重建都用它 |

三合一消除了"官方默认前端 + starter 模板"两份表现层漂移的风险。官方更新默认前端一次，三处同步。

fork 是快照不是引用：助手改的是复制到自己卡里的那份，官方默认前端后续更新不冲掉已 fork 的卡。这正是 packaged 形态提供的隔离。

既然这份代码身兼三职，它的可读性即 API——助手要能读懂它学怎么用 SDK。`tsian.send` 调用、5 个 `on*` 回调注册、`history.get()` 重建这些位置要有清晰结构与注释，让助手 fork 时一眼懂"这段在干嘛、我能怎么改"。它既是实现又是教学样本。

## 7. 助手 agent 职责

助手 agent 是玩家与前端代码之间的翻译层。玩家不手写前端代码，助手读 SDK 契约 + 玩家诉求，生成表现层。

助手应负责：

1. 读 API 文档（`docs/sdk/play-frontend-api.md`）+ SDK 类型导出，理解 `tsian.*` 方法的形状。
2. 按游戏卡调性与玩家诉求设计布局（线性对话、图谱、卡牌式，自由）。
3. 实现消息渲染（markdown / 自定义气泡 / 多 agent 分流）。
4. 实现流式 UX——真流式或假流式或混用，为美观服务。
5. 实现工具节点呈现（timeline / 卡片 / 动画 / 折叠，随意）。
6. 实现状态栏、输入区、空状态、错误提示。
7. 实现主题与样式，自由写 CSS。
8. 用 injection 注入前端加工的状态（角色卡、当前场景摘要等）。
9. 写入卡的 packaged frontend 文件。
10. （未来）用爬虫工具看自己写出的效果并迭代。

助手不应负责：桥协议（握手、RPC id 匹配、postMessage 传输、错误归一）。

助手当前短板是反馈回路（盲写、写完看不到效果），不是脑力。补齐自检工具后迭代能力质变。在那之前，默认前端作为可跑起点比从零写更安全。自检工具的方向与能力边界见 `docs/active/assistant-frontend-inspection-direction.md`。

## 8. 真相源单一化

每个环节的真相源唯一、官方维护：

| 真相 | 来源 |
|---|---|
| `tsian.*` 有什么方法/回调/类型 | API 文档 `docs/sdk/play-frontend-api.md` + SDK 的 TS 类型导出（即真相） |
| 怎么用 SDK 写前端 | API 文档 + 默认前端 `apps/play-frontend-dev/src/main.ts`（可 fork） |
| 表现层示例 | 默认前端（可 fork） |

官方更新桥加新能力时，语义化的高频能力加 `tsian.*` 方法，冷门能力走 `tsian.query`/`tsian.runAction` 通用入口——不暴露 method 字符串，助手现读 SDK 现用，随 SDK 发版自动到助手，因为玩家访问官方域名即拿最新平台 + 最新 SDK。

## 9. 桥协议扩展（本次）

本次 SDK 重设计伴随桥协议的**扩展**（加 method，非破坏性改动）：

- `MessageInteractionRequest` / `InvokeAgentRequest` 加可选 `injection?: InjectionMessage[]` 字段（params 扩展，不改 method 名）。
- 新增 4 个独立 RPC method：`workspace.read` / `workspace.list` / `workspace.search` / `workspace.write`——从 `query.query` 的 resource 分支拆出。`workspace.read` 返回 `WorkspaceReadResult | null`（null = 文件不存在，错误走 error 不吞）。

桥协议本身（`tsian.play-bridge.v1`）的已有 method 名不变。agent 的 `workspace_read`/`workspace_write` 工具走 agent runtime，不经过桥的 `workspace.*`——两条路径独立，拆分只影响前端通道。

## 10. 落地路径

1. **抽协议层 SDK**：把前端内联的桥协议部分抠成 `packages/play-bridge` 的 `createBridge`（包内）+ `createTsian`（对外领域 API）。已完成。
2. **重设计为领域 API**：`tsian.*` 方法 + 5 个语义回调 + injection + workspace 独立 RPC。已完成（`06-27-play-sdk-domain-api` 任务）。
3. **迁移默认前端**：`apps/play-frontend-dev/src/main.ts` 从裸 `bridge.*` 迁到 `tsian.*`，验证 API 可用性。已完成。
4. **写 API 文档**：`docs/sdk/play-frontend-api.md`。已完成。
5. **发 CDN**：SDK 上 CDN，默认前端 import CDN 版本，用稳定 semver 范围。待做。
6. **（未来）补爬虫工具**：助手能看效果迭代，闭环完整。

## 11. 被取代的过渡构想

以下在前期讨论中出现过，本方向下不再作为目标：

- **starter 模板与默认前端分两份**：制造双真相源、必然漂移。被三合一取代。
- **SDK 提供 `mountChat` + slots + render 钩子 + 命名预设的多档定制 API**：给表现层设上限，与"最大自由度"冲突。SDK 坍缩成只管桥。
- **窄 API 少出错、对助手限制档位**：低估强 LLM 能力，束缚而非保护。改为契约完整清晰 + 原始能力全开。
- **薄 SDK 只做协议直译（裸 `bridge.call` + 原始事件名）**：暴露 RPC 细节给前端开发者，门槛高。被领域 API 取代——协议层留包内，对外只暴露 `tsian.*` 动词。
- **增量累加挪到 host 桥出口预处理**：焊死线性表现假设，且没省到动画的"画"。增量层留前端。
- **SDK 走 semver 供玩家 pin 版本、官方远程更新独立化**：在官方同源更新模型下是伪约束。玩家访问官方域名即拿最新。
- **snapshot 覆盖渲染（`turn-completed.snapshot` 到达时全量重渲染）**：被 `history.get()` 单源重建 + `onTurnEnd` 就地修正取代。回合进行中就地修正流式 DOM，不重建；重载/回溯后从 turn 文件单源重建。

## 12. 检查清单

后续规划前端 / SDK / 助手相关新任务时，先问：

1. 这个能力是否属于桥协议层（应在 SDK），还是表现层（应交给助手）？
2. SDK 是否在替前端做表现意图相关的决定（累加策略、渲染结构、主题）？若是，退出 SDK。
3. 新增桥能力是否暴露了 method 字符串给前端？若是，封装成 `tsian.*` 方法或走 `query`/`runAction` 通用入口。
4. 是否在维护一份与 SDK / 默认前端重复的副本文档或模板？若是，合并回单一真相源。
5. 默认前端的改动是否同时让玩家默认界面、助手起点、官方测试基准受益？若只其一，检查是否在制造分叉。
6. 助手生成的前端是否触碰到 `postMessage` / RPC id 匹配 / `createBridge` / method 字符串？若是，说明 SDK 封装有缺口。
7. 是否把数据正确性押在前端累加上而非 workspace turn 文件上？若是，回到"`history.get()` 单源重建"红线。
8. injection 是否被平台解释语义或落盘？若是，违反"injection 只本轮有效、平台不解释"约定。

若答案显示实现正在重建被取代的过渡构想，应回到本文档重新切分边界。
