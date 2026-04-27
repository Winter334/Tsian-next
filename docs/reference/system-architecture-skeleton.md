# AIRP Framework System Architecture Skeleton

## 1. 文档目的

本文档只用于确定项目的`底层系统程序架构骨架`，作为后续持续讨论和补充的基础稿。

当前阶段只回答两类问题：

- 系统由哪些核心部分组成
- 各部分在程序层面承担什么职责

当前阶段明确不讨论：

- 具体技术选型
- 数据结构与表设计
- 提示词细则
- 容错、回滚、审计
- 创意工坊与发布系统
- UI 交互细节

## 2. 项目定位

本项目是一个`AIRP 专精框架`。

它不是一个高扩展、强插件化的通用聊天平台，而是一个以`叙事连续性`为核心目标的内容框架。

当前架构讨论以以下前提为基础：

- 记忆系统以`事件`为主
- `时间`用于串联事件，形成完整叙事链
- `档案`用于补充人物、地点、物品等叙事实体信息
- `AI`负责读取剧情并产出修改
- `程序`负责保存、查询、组织与应用修改
- 玩家游玩运行时默认由`平台 WebUI 本地承载`
- 官方服务器默认主要负责`平台与内容分发`

与记忆系统相关的进一步决策，单独记录在：

- [memory-system-decisions.md](../active/memory-system-decisions.md)

与 AI 调度层相关的进一步决策，单独记录在：

- [ai-runtime-skeleton.md](./ai-runtime-skeleton.md)

与状态修改契约相关的进一步决策，单独记录在：

- [patch-contract-skeleton.md](../active/patch-contract-skeleton.md)

与提示词预设层相关的进一步决策，单独记录在：

- [prompt-preset-skeleton.md](./prompt-preset-skeleton.md)

与 WebUI 运行层相关的进一步决策，单独记录在：

- [webui-runtime-skeleton.md](./webui-runtime-skeleton.md)

与模组和存档相关的进一步决策，单独记录在：

- [mod-and-save-skeleton.md](./mod-and-save-skeleton.md)

与技术栈选型相关的进一步决策，单独记录在：

- [technical-stack-skeleton.md](./technical-stack-skeleton.md)

与默认本地运行时相关的进一步决策，单独记录在：

- [local-runtime-skeleton.md](./local-runtime-skeleton.md)

与本地数据存储相关的进一步决策，单独记录在：

- [local-storage-skeleton.md](./local-storage-skeleton.md)

与正式开发骨架相关的进一步决策，单独记录在：

- [development-skeleton.md](./development-skeleton.md)

与实施顺序相关的进一步决策，单独记录在：

- [implementation-plan.md](../active/implementation-plan.md)

## 3. 当前已确定的核心原则

### 3.1 事件主导

系统首先保证“发生过什么”能够被长期保留和再次调用。

事件是叙事连续性的主体，档案不能替代事件。

### 3.2 档案承载实体当前状态

档案不承载完整叙事，但它是实体当前状态的唯一真源。

它负责承载：

- 实体公共基础语义
- 实体当前状态
- 实体关注点
- 实体变体扩展字段

因此当前不再把“实体运行时状态”作为对外独立层暴露。

### 3.3 全局状态独立存在

系统中还存在一层不属于单个实体的`全局状态`。

它用于承载：

- 场景级状态
- 会话级状态
- 前端包消费的全局公式或样式片段

它不替代档案，也不替代事件。

### 3.4 时间显式存在

系统中存在可被 AI 修改的当前时间。

时间的作用是作为事件的串联轴，而不是单独构成记忆主体。

### 3.5 AI 解释剧情，程序执行结果

程序不负责理解剧情，不负责硬编码事件判断逻辑。

程序只负责：

- 提供上下文
- 调用 AI
- 接收修改结果
- 应用修改结果
- 保存新的系统状态

## 4. 底层系统骨架

当前建议的底层系统由以下核心部分组成：

### 4.1 Session Runtime

负责一轮游玩的整体流程调度。

它是系统主入口，负责串联其余模块，但不负责剧情解释。

### 4.2 Context Assembly

负责为主 AI 和维护 AI 组织所需上下文。

它处理的是“取什么给 AI 看”，不是“如何理解剧情”。

### 4.3 Main Generation

负责调用主 AI 生成本轮剧情正文。

### 4.4 Maintenance Processing

负责调用维护 AI 读取本轮正文，并产出对系统状态的修改结果。

### 4.5 Patch Application

负责接收维护 AI 产出的修改，并将其应用到：

- 当前时间
- 全局状态
- 事件记忆
- 档案信息

### 4.6 Event Memory

系统主记忆层。

负责承载和查询事件叙事内容。

### 4.7 Archive Memory

系统辅助记忆层。

负责承载人物、地点、物品等叙事实体的当前状态信息。

### 4.8 Global State

系统会话侧状态层。

负责承载不属于单个实体、但影响当前局面的状态信息。

### 4.9 Time State

负责保存当前叙事时间，并作为事件串联的主轴之一。

## 5. 项目整体系统地图

在记忆系统之外，当前项目还需要从整体上补齐以下系统层。

它们不是实现清单，而是后续架构讨论必须覆盖到的系统版图。

### 5.1 AI Runtime Layer

负责所有 AI 调用的编排与分工。

在当前路线下，它默认运行在`平台 WebUI 的本地运行时`中，而不是官方后端。

它至少覆盖：

- 主生成调用
- 维护调用
- 检索规划调用
- 排序 / 筛选调用
- 不同预设绑定不同提供商与模型

这一层解决的是：

- 哪些 AI 角色存在
- 它们在主链中的调用顺序
- 它们各自读取什么上下文、产出什么结果

### 5.2 Prompt Preset Layer

负责管理 AIRP 的提示词预设。

它至少覆盖：

- 预设本体
- 预设与 AI 提供商 / 模型的绑定
- 预设如何参与上下文组装
- 预设如何影响维护 AI 与检索 AI 的行为

这一层解决的是：

- 玩家切换不同玩法时，系统如何切换整套 AI 行为口径

### 5.3 Narrative State Presentation Layer

负责将系统中的状态信息组织成可渲染内容。

它至少覆盖：

- 可配置状态栏的数据来源
- 哪些状态可以被渲染
- 状态栏如何作为“显示层”接收系统状态

这一层解决的是：

- 叙事状态如何稳定映射到 UI，而不是直接把底层数据裸暴露给前端

### 5.4 WebUI Runtime Layer

负责玩家实际游玩的交互壳层。

它至少覆盖：

- 对话游玩界面
- 预设切换入口
- 状态栏展示
- 记忆 / 档案相关查看入口
- 创意工坊内容使用入口

这一层解决的是：

- 玩家如何与整套框架发生交互

在当前路线下，这一层还默认承载玩家本地运行时壳层。

### 5.5 Content Distribution Layer

负责创意工坊相关能力。

它至少覆盖：

- 模组的分享
- 模组子内容的分享
- 模组的下载、启用与复用

这一层解决的是：

- 用户创造的内容如何打包、上传、下载、启用

## 6. 系统依赖关系

为了避免后续讨论顺序失控，先固定一个高层依赖方向：

- `AI Runtime Layer` 依赖 `Prompt Preset Layer` 的行为配置
- `Context Assembly` 依赖 `Prompt Preset Layer` 与记忆系统共同提供上下文材料
- `Narrative State Presentation Layer` 依赖事件、档案、全局状态与时间，但不反向决定剧情
- `WebUI Runtime Layer` 依赖上述所有运行时能力，但不主导底层叙事逻辑
- `Content Distribution Layer` 依赖前面各系统先定义出“可打包内容”
- `官方服务器` 默认不承载玩家核心游玩运行时，只承载平台与分发能力

## 7. 核心运行主链

当前建议的最小主链如下：

1. Session Runtime 接收用户输入
2. Context Assembly 组织上下文
3. Main Generation 生成本轮剧情正文
4. Maintenance Processing 读取正文并产出修改
5. Patch Application 应用修改
6. Event Memory / Archive Memory / Global State / Time State 更新
7. Session Runtime 返回本轮结果

这条主链只表达系统流程，不表达剧情判断规则。

## 8. 模块关系约束

为了避免后续架构讨论滑向过度设计，先固定以下关系：

- `Session Runtime` 负责调度，不解释剧情
- `Context Assembly` 负责组装上下文，不决定剧情逻辑
- `Main Generation` 只负责正文生成
- `Maintenance Processing` 只负责基于正文产出修改
- `Patch Application` 只负责应用修改，不扩展剧情语义
- `Event Memory` 是主记忆层
- `Archive Memory` 是实体当前状态层，不反向主导叙事
- `Global State` 只承载非实体会话状态，不替代档案

## 9. 当前不进入讨论的内容

以下内容后续可以补，但当前不进入骨架设计：

- 事件如何切分
- 维护 AI 提示词如何写
- 事件、档案、时间分别有哪些字段
- 使用什么数据库、索引或向量方案
- 如何做回滚、版本、审计
- 如何做工坊、导入导出、兼容外部格式

## 10. 后续继续讨论的方向

在当前骨架确定后，后续讨论应继续限定在`程序架构层`，并优先补齐整个项目版图。

当前推荐的讨论顺序如下：

1. `AI Runtime Layer`
2. `Prompt Preset Layer`
3. `Narrative State Presentation Layer`
4. `WebUI Runtime Layer`
5. `Content Distribution Layer`

原因如下：

- `AI Runtime Layer` 决定全项目最核心的运行主链
- `Prompt Preset Layer` 决定不同玩法如何驱动整套 AI 行为
- `Narrative State Presentation Layer` 决定状态栏这类表现层如何接入底层状态
- `WebUI Runtime Layer` 依赖前面三者的输入输出边界
- `Content Distribution Layer` 最晚讨论，因为它依赖前面所有内容先收敛为可分享对象

在这套顺序下，`状态栏` 不应先于 `状态来源系统` 被设计，`WebUI` 也不应先于运行时主链被设计。

## 11. 当前结论

当前骨架的核心结论可以压缩为一句话：

`事件主导叙事记忆，时间串联事件，档案承载实体当前状态，全局状态承载非实体会话状态；玩家游玩运行时默认由平台 WebUI 本地承载，官方服务器主要负责平台与内容分发；项目整体应先确定 AI 运行层，再确定预设层、状态呈现层、WebUI 层与内容分发层。`


