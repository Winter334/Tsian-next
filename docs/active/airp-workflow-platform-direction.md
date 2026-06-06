# Tsian Workflow-As-System Direction

## 1. 文档目的

本文档记录 Tsian 当前可信的产品与架构方向。

它不是阶段任务清单，也不是旧实现细节的堆叠。它回答一个核心问题：

`Tsian 要成为怎样的 AIRP 平台？`

当前答案是：

`Tsian 是一个 workflow-as-system 平台。AIRP 中的记忆、润色、地图、关系、规则、调试和其它系统，都应尽量由工作流、工作流携带的状态契约、资源、平台能力和前端渲染共同配置出来，而不是固化为平台内置的单一玩法链路。`

本文档是后续任务规划和代码 review 的方向约束。若旧文档、旧任务 PRD 或历史实现与本文档冲突，除非另有明确新决策，优先相信本文档、当前代码和 `.trellis/spec/`。

## 2. 核心定位

Tsian 不是单纯的 AI 角色扮演内容应用，也不是只服务一套官方事件/档案记忆系统的固定框架。

Tsian 的核心定位是：

`面向 AIRP 的可配置工作流运行平台。`

平台应让玩家和作者配置出自己的 AIRP 系统：

- 如何收集上下文
- 如何检索记忆
- 如何组织 prompt
- 如何调用 AI
- 如何解析输出
- 如何维护状态
- 如何把状态渲染成前端体验
- 如何追踪和调试这一切

默认 AIRP 体验可以很强，但它应该是一个参考 preset，而不是平台本体。

## 3. 系统模型

一个 Tsian 系统由以下部分组合而成：

1. **Workflow preset**：描述信息流和执行顺序，例如查询、筛选、合并、模板组合、AI 调用、写回。
2. **Workflow-carried state contract**：由工作流中的持久状态读写、节点输入输出、记录处理和写入校验共同形成，描述系统维护的数据结构，例如事件/档案、关键词/片段、地图节点/边、风格规则。
3. **Resources**：提供 prompt preset、workflow preset、静态内容、默认配置等可复用材料。schema 可以作为某些高级系统包的派生或辅助材料存在，但不应默认成为脱离工作流单独维护的主复用单位。
4. **Platform capabilities**：提供受控能力，例如存储写入、checkpoint、回滚、AI 调用、schema 校验、调试追踪。
5. **Frontend renderer**：读取平台状态或资源，将其渲染成聊天界面、地图、关系网、调试面板或其它交互体验。

简化表达：

`System = workflow + carried state contract + resources + platform capabilities + renderer`

这句话比“所有东西都变成节点”更重要。工作流是系统组织方式，但不是让任意节点接管所有底层风险。

系统复用的优先单位不应是孤立 schema，而应是未来的 **workflow block / subworkflow / system package**：

- block/subworkflow 打包一组节点、内部执行顺序和输入输出端口。
- block/subworkflow 随身携带或暴露它形成的 state contract。
- block/subworkflow 可以声明所需 prompt preset、world book、静态内容或 renderer 约定。
- schema resource 若出现，应优先作为系统包或工作流契约的派生/共享材料，而不是作者配置系统的前置入口。

判断标准：

`只抽出 schema 只能复用数据形状；抽出 workflow block 才能复用一个可运行系统。`

## 4. 工作流在平台中的位置

工作流是 AIRP 系统能力的主组织方式。

一轮 AIRP 可以抽象为：

`用户输入 -> 上下文读取 -> 记忆/状态查询 -> 记录处理 -> prompt 组合 -> AI 调用 -> 输出解析 -> 状态维护 -> 受控写回 -> 调试追踪 -> 前端渲染`

不同玩法、不同记忆模型、不同前端体验，应该尽量通过替换或重组这条链上的配置来实现，而不是为每一种玩法新增平台硬编码路径。

工作流应具备：

- 可配置
- 可复用
- 可调试
- 可追踪
- 可逐步拆解
- 可被默认 preset 包装成易用体验

工作流不应承担：

- 直接绕过平台写底层存储
- 自行维护 checkpoint 和回滚一致性
- 以任意脚本替代所有通用平台能力
- 把某个默认 AIRP 数据模型固化成所有用户必须接受的节点语义

## 5. 节点类型原则

节点类型应尽量是通用原语，而不是 AIRP 默认系统的业务名词。

推荐的节点语义类别：

- **控制流**：条件分支、结果输出、子流程或未来 block/subgraph。
- **AI 调用**：调用某个 prompt preset 或模型配置。
- **模板组合**：把输入数据组合成文本或 JSON。
- **泛型状态读写**：按 namespace / collection / schema 查询和写入持久状态记录。
- **记录处理**：筛选、合并、格式化、排序、去重、关系选择、字段提取。
- **受限计算**：高级作者用于局部转换和原型实验的 bounded compute。
- **受控平台能力**：通过平台拥有的 executor 触发安全写入、checkpoint、外部能力调用等。

不推荐的节点语义：

- `event-query`
- `archive-query`
- `map-update`
- `relationship-state-write`
- 任何只对某个默认系统成立、但被注册成平台通用节点的业务动作

判断标准：

`如果一个节点名字只有事件/档案系统能解释，它很可能不该是通用节点。`

事件、档案、关键词、片段、地图坐标、图边、阵营关系，都应该优先作为 workflow-carried state contract / collection / workflow preset / renderer 的配置，而不是绑定到节点类型。

## 6. 默认 AIRP 事件/档案系统的定位

事件/档案记忆仍然重要。它是当前默认 AIRP 体验的参考系统：

- `events` 表达剧情中已经发生或正在发生的事实。
- `archives` 表达人物、地点、物品、组织等叙事实体的当前状态。
- `globals` 表达非实体全局状态，例如当前时间、章节、天气、局势变量。

但它不是平台本体，也不是未来所有记忆系统必须继承的内核。

正确定位是：

`事件/档案是默认 AIRP workflow preset 携带的 state contract 的一个强参考实现。`

这意味着：

- 默认工作流可以使用事件/档案作为优秀起点。
- 默认前端可以提供事件、档案、调试视图。
- 文档可以总结事件/档案为何适合叙事连续性。
- 但平台不应把事件/档案语义焊死进通用节点类型。
- 玩家和作者可以替换 workflow preset 或未来 block/subworkflow，从而替换随工作流形成的状态契约，构建其它记忆或状态系统。

## 7. 可配置系统示例

### 7.1 事件/档案记忆系统

配置：

- carried state contract：`airp/events`、`airp/archives`、`airp/globals`
- workflow：查询集合、筛选当前相关记录、组合记忆 prompt、维护 AI 输出写入操作
- renderer：事件列表、档案页、检索调试面板

这是默认参考系统，不是唯一系统。

### 7.2 关键词 -> 片段/摘要记忆系统

配置：

- carried state contract：`keywords`、`fragments`、`summaries`
- workflow：从当前上下文提取关键词，查询片段或摘要，按相似度和 recency 排序，组合上下文
- renderer：关键词面板、摘要管理视图、命中来源调试

它不需要 `event-query` 或 `archive-query` 节点。它需要的是泛型集合查询、记录筛选、排序、模板组合和受控状态写入。

### 7.3 正文二次处理系统

配置：

- carried state contract：可选的风格规则、禁用词、角色口吻、文本质量配置
- workflow：主 AI 生成正文后，进入润色、风格化、审校、压缩或扩写节点链
- renderer：展示最终正文，也可以在调试面板显示原文和二次处理结果

这说明 Tsian 的系统不只等于记忆系统。工作流可以围绕文本处理、风格控制和后处理构建系统。

### 7.4 地图 / 坐标 / 图数据系统

配置：

- carried state contract：地图节点、区域、坐标、边、可达性、占领状态、可见状态
- workflow：根据剧情事件或玩家操作更新图数据，维护坐标、路径或区域状态
- renderer：前端读取图数据，渲染成地图、路线、区域面板或空间关系图

地图本身不应该要求平台新增 `map-update` 通用节点。它应该复用 workflow-carried state contract、泛型写入、记录处理和前端 renderer。

## 8. 平台安全边界

工作流越强，平台边界越重要。

以下能力应由平台拥有：

- 本地存储结构
- schema 校验
- checkpoint 和回滚
- 写入一致性
- AI 调用封装
- 调试追踪
- 资源解析
- 高风险能力权限
- 兼容投影和迁移策略

工作流可以配置何时调用这些能力，以及如何把数据交给这些能力。工作流不应该绕开它们。

这条边界尤其适用于：

- `state-write`
- runtime bridge 写入口
- checkpoint 创建
- 旧兼容路径
- 未来外部文件、网络、插件能力

## 9. 兼容结构的处理原则

兼容结构应该明确、收口、可退场。

当前需要特别警惕：

- `apply-patch` 已从 workflow node surface 退场。桥 API 和内部 applier
  可以继续作为平台兼容能力存在，但不再是 workflow preset 语法。
- `memory-write` 已从 workflow node surface 退场。持久状态写入使用
  `state-write`；旧 workflow 若仍声明 `memory-write`，应明确按未知节点
  失败，而不是保留 alias。
- `memory-query` 已从 workflow node surface 退场。持久状态读取使用
  `state-query` 且保持 collection/schema 驱动；旧 workflow 若仍声明
  `memory-query`，或把 `state-query` 配成旧 `source: "event-archive"`，
  应明确失败，而不是继续走隐藏 AIRP 检索分支。
- legacy events / archives / snapshot slices 可以作为兼容投影存在，但默认 AIRP 读写权威应向 generic state records 和 schema-aware workflow 边界收敛。

兼容层不应被扩展成新的通用模型。若一个任务需要新增兼容逻辑，必须同时说明：

- 它保护什么旧入口
- 它何时可以退场
- 它是否污染了通用节点或 schema 设计

## 10. 文档维护原则

`docs/active` 只保留当前仍应维护的入口文档：

- `current-state-handoff.md`
- `airp-workflow-platform-direction.md`
- `deferred-work.md`
- `README.md`

历史设计、旧实施计划和阶段性 skeleton 进入归档。它们可以作为背景材料被引用，但不再作为当前任务规划的权威来源。

活跃文档职责：

- `current-state-handoff.md`：当前实现状态和接手入口。
- `airp-workflow-platform-direction.md`：长期方向、架构原则和未来任务决策标准。
- `deferred-work.md`：明确知道但刻意暂缓的后续工作，记录为什么暂缓、何时回看和范围护栏。
- `README.md`：active 目录阅读顺序和维护规则。

新方向优先收敛到本文档，而不是继续追加到多份旧骨架文档。
暂缓事项优先收敛到 `deferred-work.md`，不要只留在聊天上下文或临时任务
PRD 中。

## 11. 未来任务决策检查表

规划新任务或 review 实现时，先问：

1. 这个需求是在增强通用 workflow primitive，还是在硬编码一个默认 AIRP 系统？
2. 这个能力更适合成为节点、workflow-carried state contract、workflow preset / block、resource、renderer，还是 platform capability？
3. 如果换成关键词/片段记忆、地图系统或正文后处理系统，这个原语还能复用吗？
4. 是否把事件/档案语义绑定进了通用节点类型？
5. 是否把临时兼容层扩展成了长期模型？
6. 写入、checkpoint、回滚和校验是否仍由平台控制？
7. 用户是否能通过配置替换默认系统，而不是只能接受平台硬编码路径？
8. Debug trace 能否解释这个系统为什么这样运行？

若答案显示实现正在把默认系统焊死进平台，应回到本文档重新切分边界。

## 12. 当前优先方向

短期优先级不是立刻实现所有可能系统，而是清理方向漂移，让基础设施朝可配置系统平台收敛。

当前更符合方向的工作包括：

- 收紧节点类型集，移除或隐藏不再适合作为通用节点的兼容节点。
- 保持 `apply-patch` 退场后的边界：workflow preset 使用 `state-write`
  等泛型节点，桥/API patch 只作为平台兼容能力。
- 保持 `state-query` collection-only，避免重新引入 `event-archive` 这类高层历史分支。
- 让 workflow-carried state contract、workflow preset / block 和 renderer 的职责更清晰。
- 继续把默认 AIRP 事件/档案系统作为参考 preset，而不是唯一架构。
- 为未来 block/subgraph、system package、renderer adapters 留出清晰位置；schema resource 若出现，应作为系统包或工作流契约的辅助/派生产物，而不是下一阶段的默认主线。

这条路允许“一切皆有可能”，但不是“一切都无约束”。Tsian 的开放性应来自清晰的工作流、状态契约、资源和能力边界，而不是来自任意硬编码和任意脚本逃生口。
