# Tsian Play Frontend SDK Direction

## 1. 文档目的

本文档记录 Tsian 游戏前端与桥 SDK 的当前可信方向。

当前答案是：

`游戏前端的协议对接由官方维护的薄 SDK 封装；表现层由桌面助手 agent 基于 SDK 自由构建，不内置黑盒渲染层。`

旧的"平台内置一整份黑盒默认前端（含协议+流式+渲染）"形态在本方向下被拆解：协议层抽成独立 SDK 包，表现层成为助手可自由 fork 的默认前端。本方向取代之前讨论中残留的"starter 模板与默认前端分两份""SDK 提供 mountChat 多档定制 API""窄 API 少出错"等过渡构想。

桥协议本身（`tsian.play-bridge.v1`）仍是 `packages/contracts/src/bridge.ts` 中的稳定契约，本方向只决定 SDK 的形态与职责切分，不改桥协议。Agent Runtime 与运行时数据语义见 `docs/active/agent-framework-runtime-workspace-direction.md`，平台边界见 `docs/active/airp-workflow-platform-direction.md`。

## 2. 核心定位

Tsian 不是玩家自托管、官方只发 SDK 的中立嵌入模型。玩家通过官方域名访问官方托管的平台进行游玩——平台 host 与默认前端在同一更新域内，一次部署同步更新。这是本方向所有取舍的前提。

基于此前提，SDK 的定位是：

`游戏前端与平台之间的桥协议可用化封装，官方同源维护、CDN 分发。`

SDK 只负责助手无法自实现的那一层——与平台的协议契约。表现层（渲染、流式 UX、布局、主题）交给助手 agent 自由构建，不进 SDK。

## 3. 职责切分

### 3.1 SDK 负责（封死，助手不碰）

- 桥协议握手（hello / ready / sessionId）。
- RPC 传输与 id 匹配（`runtime.getRuntimeSnapshot` / `interaction.sendMessage` / `query.query` / `platform.getPlatformContext` / `platform.runAction`）。
- 事件订阅语法（`turn-delta` / `turn-tool` / `turn-round-end` / `turn-completed` / `turn-debug-ready`）。
- 错误归一与状态暴露（ready / turn-active / error）。
- 初始 snapshot 拉取。
- 全部相关 TS 类型导出（`RuntimeSnapshotShell`、`ConversationMessageRecord`、事件 payload 等）。

SDK 的对外类型签名即公开 API，当正式契约对待，不随手破坏。好在 SDK 类型基本是桥协议契约的直译，维护负担有限。

### 3.2 SDK 不负责（助手地盘，自由构建）

- delta 累加与流式 UX。SDK 只发原始 `turn-delta`，真流式（订阅累加）与假流式（等 `turn-completed.snapshot` 用动画放出）都是前端的选择。
- 消息渲染、markdown、气泡结构。
- 工具节点呈现（timeline / 卡片 / 折叠 / 动画）。
- 布局、主题、样式、状态栏、空状态、错误提示。
- 任何与表现意图相关的语义归一。

核心红线：助手生成的前端里不应出现 `addEventListener("message", ...)`、不应自己管 `postMessage` 握手、不应自己拼 RPC id 匹配。一旦助手开始写这些，说明 SDK 没把协议层藏好。

## 4. 数据真相与流式分层

桥推给前端的数据分两类，归一责任不同：

| 数据 | 形态 | 归一归属 |
|---|---|---|
| 全量快照 | `getRuntimeSnapshot` 返回 `RuntimeSnapshotShell`；`turn-completed` payload 带 `snapshot` | host 已归一，前端直接渲染 |
| 流式增量 | `turn-delta` 单段原始文本 | 前端自处理 |
| 工具节点 | `turn-tool` 单次状态变更 | 前端自处理 |
| 回合边界 | `turn-round-end` 标记 | 前端自处理 |

关键设计：**数据真相来自 host 的 snapshot；SDK 的增量累加只是回合进行中的过渡动画，回合结束被 snapshot 覆盖纠正。** 这让前端的流式实现从"必须正确"降级为"尽力流畅"——即使累加有偏差，`turn-completed.snapshot` 一到就归零重渲染。SDK 不背数据正确性，host 才是。

这同时解释了为什么增量累加不挪到 host：快照层归一与表现意图无关（全量状态谁看都一样），放 host 安全；增量层归一与表现意图强相关（线性累加 vs 图谱 vs 假流式是不同意图），放 host 会焊死表现假设。且动画的"画"无论如何在前端，累加同侧最自然。

落地红线：**`turn-completed.snapshot` 到达时必须用 snapshot 覆盖渲染，不信任自己累加的结果。** 现有 `default-frontend-files.ts` 的 `app.js` 已在遵守这条，抽包后默认前端继续遵守。

## 5. 默认前端：三合一单真相源

不存在独立的"starter 模板"。默认前端 `default-frontend-files.ts` 的 `app.js` 重构为 import SDK 的形式后，同时承担三个角色：

| 角色 | 用法 |
|---|---|
| 官方默认前端 | 打进 packaged 默认卡，玩家开箱即见 |
| 助手起点 | 玩家让助手改前端时，助手读这份学结构并 fork |
| 官方测试基准 | 验收桥协议、回归流式/工具/snapshot 都用它 |

三合一消除了"官方默认前端 + starter 模板"两份表现层漂移的风险。官方更新默认前端一次，三处同步。

fork 是快照不是引用：助手改的是复制到自己卡里的那份，官方默认前端后续更新不冲掉已 fork 的卡。这正是 packaged 形态提供的隔离。

既然这份代码身兼三职，它的可读性即 API——助手要能读懂它学怎么用 SDK。关键桥调用、事件处理、snapshot 覆盖渲染这些位置要有清晰结构与注释，让助手 fork 时一眼懂"这段在干嘛、我能怎么改"。它既是实现又是教学样本。

## 6. 助手 agent 职责

助手 agent 是玩家与前端代码之间的翻译层。玩家不手写前端代码，助手读 SDK 契约 + 玩家诉求，生成表现层。

助手应负责：

1. 读 SDK 类型导出，理解桥的事件 / RPC / snapshot 形状。
2. 按游戏卡调性与玩家诉求设计布局（线性对话、图谱、卡牌式，自由）。
3. 实现消息渲染（markdown / 自定义气泡 / 多 agent 分流）。
4. 实现流式 UX——真流式或假流式或混用，为美观服务。
5. 实现工具节点呈现（timeline / 卡片 / 动画 / 折叠，随意）。
6. 实现状态栏、输入区、空状态、错误提示。
7. 实现主题与样式，自由写 CSS。
8. 写入卡的 packaged frontend 文件。
9. （未来）用爬虫工具看自己写出的效果并迭代。

助手不应负责：桥协议（握手、RPC id 匹配、postMessage 传输、错误归一）。

助手当前短板是反馈回路（盲写、写完看不到效果），不是脑力。补齐自检工具后迭代能力质变。在那之前，默认前端作为可跑起点比从零写更安全。自检工具的方向与能力边界见 `docs/active/assistant-frontend-inspection-direction.md`。

## 7. 真相源单一化

每个环节的真相源唯一、官方维护：

| 真相 | 来源 |
|---|---|
| 桥有什么方法/事件/payload | SDK 的 TS 类型导出（即真相） |
| 怎么用 SDK 写前端 | skill（短、稳，只讲元知识：CDN 路径、`useBridge` 范式、红线） |
| 表现层示例 | 默认前端 `app.js`（可 fork） |

不需要为助手维护一份独立的桥文档——文档会与桥演进漂移，玩家更新不及时会对接出错。助手现读 SDK 现用，官方更新桥加新能力时随 SDK 发版自动到助手，因为玩家访问官方域名即拿最新平台 + 最新 SDK。

skill 只讲"怎么用这个 SDK"的元知识（import 路径、`useBridge` 用法范式、写前端时的红线），不讲桥细节。skill 短、稳、不随桥演进漂移。

## 8. 落地路径

1. **验收当前 packaged 前端**：确认桥协议通、渲染/流式/工具/snapshot 都对。这是地基，这份代码之后成为"三合一表现层"的初版。
2. **抽 SDK**：把 `app.js` 的桥协议部分抠成 `packages/play-bridge` 的 `useBridge`，默认前端改为 import 它。这一步前后默认前端行为不变（纯重构）。
3. **发 CDN**：SDK 上 CDN，默认前端 import CDN 版本，用稳定 semver 范围。
4. **写 skill**：讲怎么用 `useBridge` 写前端，引用默认前端当示例。
5. **（未来）补爬虫工具**：助手能看效果迭代，闭环完整。

第 1 步是当下该做的，不跳。后续步骤均为顺势。

## 9. 被取代的过渡构想

以下在前期讨论中出现过，本方向下不再作为目标：

- **starter 模板与默认前端分两份**：制造双真相源、必然漂移。被三合一取代。
- **SDK 提供 `mountChat` + slots + render 钩子 + 命名预设的多档定制 API**：给表现层设上限，与"最大自由度"冲突。SDK 坍缩成只管桥。
- **窄 API 少出错、对助手限制档位**：低估强 LLM 能力，束缚而非保护。改为契约完整清晰 + 原始能力全开。
- **增量累加挪到 host 桥出口预处理**：焊死线性表现假设，且没省到动画的"画"。增量层留前端。
- **SDK 走 semver 供玩家 pin 版本、官方远程更新独立化**：在官方同源更新模型下是伪约束。玩家访问官方域名即拿最新。

## 10. 检查清单

后续规划前端 / SDK / 助手相关新任务时，先问：

1. 这个能力是否属于桥协议层（应在 SDK），还是表现层（应交给助手）？
2. SDK 是否在替前端做表现意图相关的决定（累加策略、渲染结构、主题）？若是，退出 SDK。
3. 是否在维护一份与桥 / 默认前端重复的副本文档或模板？若是，合并回单一真相源。
4. 默认前端的改动是否同时让玩家默认界面、助手起点、官方测试基准受益？若只其一，检查是否在制造分叉。
5. 助手生成的前端是否触碰到 `postMessage` / RPC id 匹配等协议层？若是，说明 SDK 封装有缺口。
6. 是否把数据正确性押在前端累加上而非 host snapshot 上？若是，回到"`turn-completed.snapshot` 覆盖渲染"红线。

若答案显示实现正在重建被取代的过渡构想，应回到本文档重新切分边界。
