# 工作流编辑器状态数据流心智模型优化

## Goal

从玩家和作者视角优化工作流编辑器里的状态数据流表达，让 `archives`、`events`、自定义 collection 等持久状态不再像隐藏在查询/写入节点里的工程字段，而是像一个可见、可编辑、可引用的“状态数据库”。查询节点应让人理解“从哪里读”，写入节点应让人理解“写回哪里、做什么操作”，collection 的字段结构应能以接近表格的方式被定义和查看。

## What I already know

* 用户实际使用后认为当前工作流编辑器仍然难用，尤其难以理解状态契约中的 collection 来源和数据流转。
* 用户提出的目标心智模型是：从数据库查询数据，数据经过工作流流转后，再写回数据库（更新、删除、添加）。
* 用户倾向加入“状态数据库节点”，在其中编辑 schema，例如 `archives` 是什么、有哪些字段。
* 用户更偏向让“状态数据库”以画布节点形态出现，并与查询节点、写入节点连线，从而直观看见引用关系。
* 用户可以接受工作流中出现多个数据库节点实例，但这些实例实际都代表同一个底层状态数据库。
* 用户进一步倾向：查询节点和写入节点如果没有连接状态数据库节点，就不能正常查询或写入；操作体验应尽量像普通工作流数据流，不强迫玩家记住“普通边”和“引用边”是两套不同东西。
* 用户提出的心智模型是：数据库节点输出整个数据库或某个大字段/collection（如 `archives`），查询节点接收并处理该数据，再输出目标数据。
* 用户偏向写入关系显示为 `写入节点 -> 数据库 collection`，因为这更符合“写回数据库”的直觉。
* 用户提出为避免工作流形成环，可以要求写入时再放一个数据库节点实例，而不是把同一个数据库节点连成闭环。
* 用户明确表示：工作流中可以出现多个数据库节点，但它们本质都是同一个状态数据库；这个概念后续会通过独立文档解释，不希望把这些注意点分散到 UI 中让玩家自行发现。
* 用户不倾向在 MVP UI 中显式标注“镜像”等额外说明文案。
* 用户希望状态数据库节点默认只有一个 collection 端口；端口可选择接收/输出哪个 collection。
* 用户希望状态数据库节点可手动添加更多 collection 端口，例如从同一个数据库节点分别输出 `archives` 和 `events` 到两个查询节点。
* 用户认可：添加端口时只允许选择已有 collection；新 collection 的创建和字段定义应在数据库节点编辑面板中完成。
* 用户倾向数据库字段表保留简化类型列，因为现有 schema/校验已经支持类型；但担心类型选择会给玩家造成负担，很多玩家不知道应该选什么类型。
* 用户认为第一版可以包含“列表/结构”等稍复杂字段形态；普通玩家可以不碰这些选项，使用低负担的“文本/数字/开关/任意内容”兜底。
* 用户倾向列表/结构在 MVP 中只做浅层类型选择，不继续配置列表项类型或结构子字段，避免过度设计。
* 用户倾向扩展工作流级 schema/state metadata，而不是继续把新数据库模型绕回 `state-write.config.schema`。这是一次工作流系统优化升级，不应在核心模型上偷懒。
* 用户说明当前项目仍处于原型开发期，没有真正的历史迁移需求；测试用默认工作流可以根据实际实现直接修改。
* 用户认可工作流级状态模型字段命名为 `stateModel`，因为它比 `stateSchema` 更少工程感，也比 `stateDatabase` 更适合作为契约层抽象。
* 用户认可：状态数据库节点应存为 `stateModel` 下的单独视图锚点 metadata，而不是进入 `WorkflowDefinition.nodes` 成为可执行节点。
* 用户认可：数据库节点与查询/写入节点之间的可视连线应持久化到 `stateModel.links` 这类 metadata，而不是只临时同步节点配置。
* 用户认可：`stateModel.links` 作为 UI/编辑器真源；保存或应用工作流时同步冗余目标到 `state-query/state-write.config.namespace/collection`，以减少运行时 executor 改动。
* 用户指出当前 `state-write` 已经支持一个写入节点写多个 collection，因此不应为了早先的简化假设强行拆分默认维护写入。
* 用户权衡多查询后认可继续采用单查询节点：多查询即使分别输出，也主要只节省查询节点，后续处理仍需分开，收益一般而复杂度更高。
* 用户认可：新建状态数据库节点时，默认 collection 端口自动绑定第一个已有 collection；如果暂无 collection，则保持未绑定并要求先创建 collection。
* 用户明确事件-档案体系是内置默认组合/预设模型，不只是示例；大多数使用场景应使用默认模型，自创模型是少数高级路径。
* 用户倾向为默认 AIRP 工作流预置内置事件/档案体系相关 collections，而不是只预置当前工作流刚好用到的最小集合。
* 用户认为全局状态也应纳入默认状态模型；它本质上同样是 AI 处理后写入的状态，只是通常不需要经过查询节点。
* 用户认可 `globals` 在状态数据库中作为特殊全局键值表展示，而不是强行建模为普通多记录 collection。
* 用户认可 `globals` 写入复用 `state-write` 机制，不新增专门全局写入节点；当目标是 globals 时，表单/文案表达为更新全局状态。
* 用户预期上下文注入也应该可视化：查询节点输出连接到 AI 节点后，AI 节点提示词中的 `{{archives}}` / `{{globals}}` 应展开为传输过来的内容。
* 用户预期结构化输入可以通过路径读取，例如 `{{globals.currentTime}}` 展开全局状态里的当前时间；如果输入本身只是文本等不可继续读取的值，则自然无法做路径访问。
* 用户倾向 AI prompt 中复杂上下文的最终格式由上游 `record-format` / `template-compose` 等节点显式决定，而不是 AI 节点默认把 records 自动 JSON 化；这样可支持 XML、DSL、Markdown 等非 JSON 格式。
* 用户提出所有节点都应遵循类似模型：上游数据进入目标节点后，像存入节点临时空间/局部变量；节点可按自身能力读取这些变量，结构化数据可用于更复杂处理，例如 compute 脚本算法处理。
* 用户认为统一“局部变量/输入变量”面板如果只显示变量名和粗类型，价值不大，因为节点卡片输入端口已经能看到这些信息。
* 用户认为真正有价值的是展示变量背后的详细字段定义，尤其数据库中定义的各种 collection；可考虑改造现有状态契约抽屉来承担这个用途。
* 用户认可状态数据库/字段定义抽屉第一版应作为只读便捷查看视图，不直接编辑字段；编辑仍在数据库节点面板完成。
* 用户认为抽屉的价值是避免每次查看字段定义都要打开数据库节点。
* 用户询问运行时是否有必要改造，以及改造收益/成本是否划算。
* 用户认可：源工作流保持 `stateModel` 干净作为真源；运行前生成临时 runtime definition，把 links/schema 编译进现有节点 config，不把冗余执行配置写回源工作流。
* 用户希望 collection 字段编辑不需要复杂类型选择，体验更像一张大表。
* 当前运行时持久状态底层是 save-scoped `stateRecords`，逻辑键为 `saveId + namespace + collection + recordId`。
* `state-query` 节点通过 `namespace + collection + query/输入变量` 查询 `stateRecords`。
* `state-write` 节点通过输入的 `StateWriteOperation` 执行 `upsert / patch / delete / clear`，默认目标来自节点配置的 `namespace + collection`，也允许 operation 自身覆盖目标。
* 当前默认 AIRP schema 已把 `globals` 定义为 `collection: "globals"`，主键为 `key`，字段为 `key/value`。
* 当前默认工作流已经通过 `state-query` 查询 `airp/globals`，再把记录数组投影为 `globals` map 用于 prompt/context。
* 当前 storage 投影层会把 `collection: "globals"` 的 state records 转回 `RuntimeGlobalsMap`，并把 `currentTime` 作为保留 globals 记录处理。
* 当前 workflow edge 会把上游输出注入为目标节点的 `inputs[varName]`；`varName` 是字面键，`globals.records` 这类名称不会自动变成嵌套对象。
* 当前 workflow engine 底层已经接近“节点局部变量”模型：调度器收集入边并把值放入目标 executor 的 `inputs` 对象。
* 当前 compute 节点已经能读取结构化 `inputs` 执行脚本处理。
* 当前 template-compose / record-format 使用的模板工具支持对结构化 inputs 做路径读取。
* 当前 `ai-call` executor 会把 `context.macros` 与上游 inputs 合并成宏；非字符串 input 会先 `JSON.stringify`，所以 AI prompt 里可以按精确键展开上游输入，但不是结构化路径访问。
* 当前 prompt-engine 的基础宏是扁平宏表；`{{globals.currentTime}}` 表示名为 `globals.currentTime` 的宏键，不表示从 `globals` 对象读取 `currentTime` 字段。
* 当前 `template-compose` 的模板工具支持对结构化 inputs 做路径访问，但 `ai-call` 使用的 prompt preset 宏替换还没有同等结构化输入上下文。
* 当前已经存在 `StateSchemaEditor.vue`，但它挂在 `state-write.config.schema` 下面，导致 schema 看起来属于写入节点，而不是属于“数据库/状态模型”。
* 当前状态契约面板通过 `state-contract.ts` 从查询/写入节点反推 collection、schema 覆盖状态和参与节点，但它更像诊断汇总，不是数据模型的主入口。
* `state-write` 目前已有输出端口 `upsertedIds / deletedIds / clearedCollections`，但这些输出是写入结果摘要，不直接表达“写入的对象/目标 collection”。
* 上一轮任务 `06-07-workflow-editor-usability-validation` 已改善可发现性、保存状态、表单文案和诊断；本任务是在更高层重塑状态数据流心智模型。
* 当前 `workflow-engine` 调度器会执行 `WorkflowDefinition.nodes` 中的每个节点，并要求每个节点类型都有 executor。
* 当前 `workflow-engine` validator 对所有 `nodes` 做已知类型校验、悬挂边校验和无环拓扑校验。
* 因此，状态数据库节点如果直接进入现有 executable `nodes` 数组，需要同步引入“非执行节点/视图节点”或“边类型”机制；否则它会被误当成普通运行时节点。

## Assumptions

* 第一阶段应优先解决“来源和归宿可理解”，不急着重做整个工作流编辑器。
* “状态数据库节点”应优先被定义为编辑器里的建模锚点/引用锚点，不一定需要成为运行时 executor 节点。
* 运行时现有 `stateRecords`、`state-query`、`state-write` 可以作为底层能力继续保留，不需要在第一阶段改动持久化模型。
* Schema 应从“写入节点附属配置”逐步提升为“工作流状态模型”，查询/写入节点引用它。
* 新模型应以工作流级 state schema/state database metadata 作为主承载，而不是继续把 schema 主数据存放在某个 `state-write` 节点中。
* 玩家化表格编辑应隐藏大部分 JSON/schema 复杂度，但保留高级逃生口以免破坏作者能力。

## Requirements (evolving)

* 工作流编辑器应提供一个一眼可见的状态数据库/状态模型入口。
* 状态数据库第一阶段倾向以画布节点形态出现，但应明确它是状态模型/引用锚点，不是普通运行时执行节点。
* 工作流中可以出现多个状态数据库节点实例；多个实例应同步指向同一个底层状态数据库/状态模型，避免形成多个互相不一致的数据库定义。
* 状态数据库节点与查询/写入节点之间的连线应表达“读写引用关系”，不应被运行时 DAG 调度误解为普通数据依赖。
* 查询节点和写入节点应依赖状态数据库连接来确定默认读写目标；未连接且未使用兼容/高级手动配置时，应被诊断为不可执行。
* 状态数据库节点应按 collection 暴露可连接端口，例如 `archives`、`events` 或自定义 collection。
* 状态数据库 collection 端口的语义应优先定义为“集合句柄/表引用”，而不是每轮把整个 collection 全量物化为普通节点输出。
* 查询节点接收 collection 句柄/表引用后，按查询条件、输入文本、limit 等配置输出匹配记录。
* 写入节点接收 collection 句柄/表引用后，按 operations 输入对该 collection 执行添加/更新/删除/清空。
* 写入关系可在画布上表达为 `写入节点 -> 状态数据库 collection`，但该边应被定义为写入目标绑定/提交边，不应在运行时被当作普通数据依赖边参与取值。
* 当查询和写入都引用同一个 collection 时，编辑器应允许放置多个状态数据库节点实例来保持画布无环；这些实例必须共享同一个状态数据库/状态模型定义。
* 编辑器应禁止或诊断普通 DAG 意义上的循环；如果用户试图把同一个数据库节点同时作为读源和写入目标形成闭环，应提示“请放置另一个数据库节点镜像作为写入目标”。
* MVP UI 不需要显式解释“多个数据库节点是镜像”。该语义由后续说明文档承载。
* 即使不在 UI 中显式标注镜像，编辑器行为也必须保持单一状态数据库语义：编辑任意数据库节点实例的 schema/collection 定义，应更新同一份状态模型。
* 状态数据库节点默认显示一个 collection 端口，避免节点一开始过大。
* 新建状态数据库节点时，如果 `stateModel` 中已有 collection，默认端口应自动绑定第一个已有 collection。
* 如果 `stateModel` 中还没有 collection，新建数据库节点的默认端口保持未绑定，并通过数据库节点编辑面板创建 collection。
* 用户可以为数据库节点实例添加多个 collection 端口；每个端口绑定一个 collection，并可分别连到不同查询/写入节点。
* 添加端口只是让该数据库节点实例暴露更多 collection 连接点，不应复制 collection 或创建独立状态库。
* 添加数据库端口时只允许绑定已有 collection；不在端口选择器里快速创建新 collection。
* 新 collection 的创建、命名、字段定义和说明编辑应集中在数据库节点编辑面板里完成。
* 状态数据库入口应展示所有 collection，并把每个 collection 表达为类似表的结构：
  * collection 名称；
  * 显示名/说明；
  * 主键；
  * 字段列表；
  * 字段显示名/说明；
  * 简化字段类型或字段形态；
  * 是否必填；
  * 默认值或示例值（如适合）。
* 字段表 MVP 应保留简化类型列，但类型文案应面向玩家表达为字段形态，而不是暴露工程术语。
* 新字段应有低负担默认类型；推荐默认是“文本”，并提供“任意内容/JSON”作为不确定时的兜底。
* 简化类型第一版应包含：文本、数字、开关、任意内容、列表、结构。
* 类型选择器应让低负担选项更靠前，列表/结构作为稍高级但可见的选项出现。
* 简化类型应映射到现有 `MemoryFieldType`，继续使用已有 schema 校验能力。
* 简化类型选择不应扩展成复杂类型建模器；列表/结构第一版应提供基础映射，深层嵌套、复杂 relation、index 等能力保留在高级/Raw 能力里逐步处理。
* 列表/结构在 MVP 中只做浅层字段形态选择，不提供列表项类型配置或结构子字段编辑。
* 查询节点应能从已定义 collection 中选择读取来源，而不是只手写 `namespace / collection`。
* 查询节点在画布或节点详情中应清楚显示“读取自哪个状态数据库 collection”。
* 查询节点应能从状态数据库 collection 端口连线生成/同步读取来源。
* 写入节点应能从已定义 collection 中选择默认写入目标。
* 写入节点应能从状态数据库 collection 端口连线生成/同步默认写入目标。
* 写入节点应清楚显示它可能执行的操作类型：添加/更新/删除/清空。
* 写入节点应清楚显示“写回哪个 collection”，并区分固定目标和由运行时 operation 动态决定的目标。
* 状态契约面板应从“诊断式 collection 汇总”升级为“数据流地图”：哪些节点读这个 collection，哪些节点写这个 collection，哪些字段结构已定义。
* 工作流定义应扩展工作流级 `stateModel` 元数据，用于承载状态数据库、collection 定义和字段结构。
* 状态数据库节点应引用工作流级状态数据库/schema 元数据，而不是拥有独立 schema 副本。
* 状态数据库节点实例应存储在 `stateModel` 的视图锚点 metadata 中，例如位置、显示端口、端口绑定的 collection；不进入 `WorkflowDefinition.nodes` 的 executable DAG。
* 状态数据库节点与查询/写入节点之间的可视读写关系应存储在 `stateModel.links` 这类 metadata 中，保存、导入和导出后可以恢复画布关系。
* 查询/写入节点应引用工作流级 collection 定义，并从 `stateModel.links` 解析读写目标。
* MVP 中每个 `state-query` 节点只能绑定一个数据库 collection 端口。
* 多 collection 查询不进入 MVP；如需查询多个 collection，使用多个查询节点分别查询。
* MVP 中每个 `state-write` 节点可以绑定多个数据库 collection 端口，表示该写入节点的 operations 允许/可能写入这些目标。
* 当 `state-write` 只绑定一个 collection 时，编译层可把它同步为默认写入目标 `config.collection`。
* 当 `state-write` 绑定多个 collection 时，编译层不应设置单一默认 collection；operations 必须显式携带 collection，现有 executor 按 operation.collection 写入。
* 多 collection 查询仍应通过多个查询节点 + record-merge/filter 等节点组合实现。
* 保存或应用工作流时，应把 `stateModel.links` 解析出的目标同步到 `state-query/state-write.config.namespace/collection`，供现有运行时 executor 简化执行。
* 当 `stateModel.links` 与节点 config 中的 `namespace/collection` 不一致时，编辑器应以 `stateModel.links` 为准并重写 config，避免双真源。
* 原型期可以接受工作流定义结构升级；默认 AIRP 工作流和内置测试预设应随新模型同步改造。
* 默认 AIRP 工作流的 `stateModel` 应预置内置事件/档案/全局状态相关 collection 定义，作为主要推荐模型。
* `globals` 应纳入状态数据库/状态模型视图，但作为特殊全局键值表展示，不强行伪装成普通多记录 collection。
* `globals` 的常见数据流不同于 `archives/events`：通常由 AI/维护链写入，模板或运行上下文读取，不一定经过 `state-query` 节点。
* `globals` 写入应复用 `state-write` 节点机制；当写入目标是 globals 时，编辑器应把目标语义显示为“全局状态”或“全局键值”，而不是普通 collection records。
* 在数据库端口和节点连线模型里，`globals` 应能像其他 collection 一样暴露端口并连接 `state-query` / `state-write`；差异主要是 UI 展示为 key/value 表，以及常见用法更偏全量读取/直接上下文使用。
* AI 节点应支持把上游连接输入作为结构化提示词变量，而不是只把输入值字符串化为扁平宏。
* 当查询/格式化/模板节点输出连接到 AI 节点，并绑定变量名如 `archives` 时，AI prompt 应能使用该变量；复杂上下文的最终文本格式应优先由上游格式化节点显式决定。
* 当 AI 节点收到结构化对象输入如 `globals` 时，AI prompt 应能使用 `{{globals.currentTime}}` 读取路径字段。
* AI 节点结构化输入变量应优先来自可视化连线；平台内置宏仍保留为兜底/系统上下文，但不应替代可视数据流。
* 所有节点都应以“局部变量 inputs”理解入边：边的目标变量名决定该上游输出在目标节点临时空间中的名字。
* 结构化数据在节点之间传递时应尽量保持结构化，直到格式化/模板/AI prompt 等文本边界才转成文本。
* 需要非 JSON 格式时，应通过 `record-format`、`template-compose` 或未来格式化节点显式产出 Markdown/XML/DSL 等文本，再连接到 AI 节点。
* MVP 需要有针对性的运行时适配，但不应重写 workflow-engine 调度器或底层存储。
* 执行前应有一个 workflow 归一化/编译步骤，把 `stateModel.links` 同步到可执行节点 config，并确保 `state-write` 能拿到对应 collection 的 schema 校验信息。
* 源工作流定义应以 `stateModel` 和可视化 links 作为真源；执行前编译产生的 `state-query/state-write.config.namespace/collection/schema` 等冗余配置只存在于临时 runtime definition 中。
* 编译步骤不应把冗余执行配置写回用户正在编辑/导出的源 workflow，避免源定义再次退化成双真源。
* 数据库节点锚点和 `stateModel.links` 不应进入普通 runtime `edges` 调度。
* AI prompt 解析需要支持结构化 inputs 路径读取；这是当前 `ai-call` 字符串宏近似能力无法覆盖的部分。
* MVP 不新增只列出变量名/粗类型的统一局部变量面板；这类信息应继续通过节点端口和边编辑表达。
* 现有状态契约抽屉应升级为只读状态数据库/字段定义视图，展示 `stateModel` 中定义的 collection、字段、字段形态、必填/说明，以及哪些节点读写它们。
* 抽屉第一版不直接编辑 collection 字段；字段编辑集中在状态数据库节点编辑面板。
* 抽屉可提供跳转/打开对应数据库节点编辑面板的入口，但不把抽屉本身变成第二个编辑表单。
* 对于连接到节点的结构化变量，编辑器应尽量能从其来源 collection/stateModel 推导字段定义，帮助作者理解可读取的路径。
* 自定义 collection/model 应作为高级扩展路径保留，但不是默认用户路径。
* 不需要为旧版 `state-write.config.schema` 实现完整迁移系统；如仍保留临时兼容读取，也应只是开发期过渡，不作为新模型主路径。
* 高级能力继续保留：raw JSON、复杂 field metadata、relation、index、operation 自定义目标仍应可用。

## Acceptance Criteria (evolving)

* [x] 玩家能在工作流编辑器中找到一个明确的状态数据库/状态模型入口。
* [x] 玩家能查看 `archives` 等 collection 的字段结构，不需要先打开某个写入节点。
* [x] 玩家能编辑一个 collection 的基础字段结构，体验接近表格而不是完整 JSON schema。
* [x] 字段表包含简化类型列，并使用玩家可理解的类型文案。
* [x] 简化类型至少包含文本、数字、开关、任意内容、列表、结构。
* [x] 列表/结构字段在 MVP 中不展开嵌套配置；复杂结构仍可通过 Raw/高级能力处理。
* [x] 新字段有默认类型，用户可以不理解类型细节也能继续编辑。
* [x] 简化类型能映射到现有 schema 校验，写入不符合字段类型时仍能被校验发现。
* [x] 新建或编辑 `state-query` 节点时，可以从已有 collection 中选择读取来源。
* [x] `state-query` 节点未连接状态数据库 collection 且未使用兼容/高级手动配置时，诊断提示无法查询来源。
* [x] 从状态数据库 collection 端口连接到 `state-query` 后，查询节点能自动确定读取的 `namespace / collection`。
* [x] 一个 `state-query` 节点在 MVP 中只能绑定一个 collection。
* [x] `state-query` 节点在画布/详情里能显示其读取来源。
* [x] 新建或编辑 `state-write` 节点时，可以从已有 collection 中选择默认写入目标。
* [x] `state-write` 节点未连接任何状态数据库 collection 且未使用兼容/高级手动配置时，诊断提示无法确定写入目标范围。
* [x] 从一个状态数据库 collection 端口连接到 `state-write` 后，写入节点能自动确定默认写入的 `namespace / collection`。
* [x] 从多个状态数据库 collection 端口连接到 `state-write` 后，写入节点显示多个可能写入目标，operations 需要显式携带 collection。
* [x] `state-write` 节点在画布/详情里能显示其写入目标和操作语义。
* [x] 写入目标可以在画布上表达为 `state-write -> 状态数据库 collection`。
* [x] 同一底层状态数据库允许出现多个数据库节点镜像，用于避免读写闭环。
* [x] 编辑器能阻止或提示同一数据库节点读写闭环，并引导用户使用另一个数据库节点实例作为写入目标。
* [x] 编辑任意数据库节点实例中的 collection/schema，都会更新同一份状态数据库定义。
* [x] MVP UI 不强制显示“镜像”说明文案；相关概念由外部/后续文档解释。
* [x] 新建状态数据库节点默认包含一个可选择 collection 的端口。
* [x] 如果已有 collection，新建状态数据库节点的默认端口会自动绑定第一个 collection。
* [x] 如果暂无 collection，新建状态数据库节点的默认端口保持未绑定，并引导用户通过数据库节点编辑面板创建 collection。
* [x] 用户可以在同一个状态数据库节点上添加多个 collection 端口。
* [x] 同一数据库节点的不同端口可以分别连接到不同查询/写入节点。
* [x] 每个端口绑定的 collection 来自同一份状态数据库定义，不会创建独立数据库副本。
* [x] 添加数据库端口时只能选择已有 collection。
* [x] 创建新 collection 必须通过数据库节点编辑面板完成。
* [x] 状态契约/状态数据库视图能展示 collection 的读写节点关系。
* [x] 状态数据库节点与查询/写入节点的连线有不同于运行时数据流边的视觉语义，例如样式、标签或端口分组，用于提示“这是状态引用关系”。
* [x] 动态写入目标仍能被识别并提示“运行时决定目标”。
* [x] 默认 AIRP 工作流仍能加载、查看、编辑和保存。
* [x] 新保存/导出的工作流能在工作流级元数据中携带状态数据库/schema 定义。
* [x] 工作流级状态模型字段命名为 `stateModel`。
* [x] 数据库节点实例引用同一份工作流级 schema，不在节点实例中产生 schema 分叉。
* [x] 内置默认工作流使用新的工作流级 schema/state database 模型，不再依赖 `state-write.config.schema` 作为主 schema 承载位置。
* [x] 默认 AIRP 工作流预置内置事件/档案/全局状态 collection 定义。
* [x] 默认预置模型能覆盖常用事件、档案、全局状态工作流编辑，不要求用户从零自创 collection。
* [x] `globals` 在状态数据库 UI 中作为全局键值表展示，而不是普通 records collection。
* [x] `globals` 写入复用 `state-write` 节点，不新增专门全局写入节点类型。
* [x] 当 `state-write` 目标是 globals 时，节点详情/画布摘要使用全局状态语义文案。
* [x] `globals` 数据库端口可以像其他 collection 一样连接到 `state-query` / `state-write`。
* [x] 查询/格式化等上游节点连接到 AI 节点后，目标变量名可在 AI prompt 中通过 `{{变量名}}` 使用。
* [x] AI prompt 支持对结构化上游输入做路径展开，例如 `{{globals.currentTime}}`。
* [x] AI prompt 中的结构化变量来自可视化连线，而不是只能依赖平台预置宏。
* [x] 复杂上下文注入的最终文本格式可由上游格式化/模板节点显式决定，不被 AI 节点强制 JSON 格式化。
* [x] 非结构化文本输入仍可通过 `{{变量名}}` 直接展开；对文本继续做路径访问时不应产生误导性结果。
* [x] 节点详情或边编辑能让用户理解“目标变量名 = 该节点的局部变量名”，但不新增仅重复端口信息的局部变量面板。
* [x] 结构化输入在 compute/template/record 类节点中保持结构化可读。
* [x] 状态契约抽屉升级为只读状态数据库/字段定义视图，能查看各 collection 的字段定义和读写节点关系。
* [x] 抽屉不直接编辑字段，字段编辑在数据库节点编辑面板完成。
* [x] 抽屉提供便捷查看或跳转能力，避免用户每次查字段都必须打开数据库节点。
* [x] 作者能从状态数据库/字段定义视图理解结构化变量中可用的字段路径。
* [x] 数据库节点实例保存在 `stateModel` 的视图锚点 metadata 中，不出现在可执行 `nodes` 数组里。
* [x] 数据库节点与查询/写入节点之间的可视连线保存在 `stateModel.links` 这类 metadata 中。
* [x] 工作流保存、导出、导入后能恢复数据库节点锚点与数据库读写连线。
* [x] 执行前临时编译时，`stateModel.links` 会同步到相关查询/写入节点的 `namespace/collection` config。
* [x] 如果 links 与 config 目标不一致，运行时编译以 links 为准并生成派生 config。
* [x] 执行前归一化能从 `stateModel.links` 生成运行时所需的查询/写入目标配置。
* [x] 源 workflow 以 `stateModel` 为真源；运行前临时 runtime definition 可包含派生 config，但不把派生 config 写回源 workflow。
* [x] `state-write` 对 workflow-level `stateModel` 中定义的 collection 继续执行 schema 校验。
* [x] 数据库节点不会被运行时误当成普通 executor 节点执行。
* [x] 数据库读写目标边不会破坏 workflow-engine 的普通 DAG 调度。
* [x] `npm run build:web` 通过。

## Technical Approach (initial)

建议把本任务拆成小步推进，而不是一次性规划完整方案：

1. 先做产品模型整理：把“状态数据库节点”定义为画布上的状态模型引用锚点，而不是会被调度执行的普通节点。
2. 扩展工作流契约：为 `WorkflowDefinition` 增加工作流级状态数据库/schema 元数据，作为 collection 定义的主存储位置。
3. 再做 MVP UI：状态数据库节点可打开 collection 表格式查看/编辑，并复用现有 `StateSchemaEditor` 的数据结构和校验能力。
4. 然后做节点联动：`state-query` / `state-write` 表单优先从状态数据库 collection 选择，保留手动输入。
5. 最后做数据库连线：查询读取可表达为 `状态数据库 collection -> state-query`，写入提交可表达为 `state-write -> 状态数据库 collection`；连线在编辑体验上看起来像数据流，但工程上应同步为查询/写入节点的读写目标，避免每轮全量传递 collection 或把提交边纳入普通取值依赖。

## Decisions (locked)

* 查询节点在 MVP 中保持单 collection 绑定：一个 `state-query` 只从一个数据库 collection 端口读取；需要读取多个 collection 时，使用多个查询节点分别输出。
* 不做“一个查询节点多 collection 分别输出”的 MVP 形态。它主要减少少量查询节点，但后续筛选、格式化、合并、AI 输入等处理仍然需要分开，收益不足以抵消动态端口、查询配置、调试和校验复杂度。
* 写入节点允许绑定多个 collection 目标，因为当前 `state-write` 已经支持 `StateWriteOperation.collection`，多写更贴合 AI 一次产出多类状态变更的默认维护链。
* 当 `state-write` 只连接一个目标 collection 时，编译层可同步为默认 `config.collection`；当它连接多个目标 collection 时，operation 必须显式携带目标 collection。

## Current View

我赞同用户希望采用节点形态，并且赞同“未连线则无法正常读写”的产品语义。这样更接近普通工作流编辑器，玩家不需要同时记住两套边规则。

但不建议把数据库节点的输出理解为“每轮真实输出整个数据库/collection 内容”。更稳妥的定义是：状态数据库节点输出的是 collection 句柄/表引用；查询节点拿到这个引用后执行查询并输出匹配记录，写入节点通过写入提交边绑定目标 collection 后执行写入操作。UI 上它看起来像数据流，工程上它是读写目标绑定。

原因是当前运行时已经有清晰的数据边界：查询节点读 `stateRecords`，写入节点写 `stateRecords`，schema 由 `state-write.config.schema` 承载并校验。真正让人困惑的是编辑器把 schema 放在写入节点内部，迫使玩家从读写节点倒推出数据库结构。把 collection/schema 提升到工作流级视图后，玩家的心智模型会变成：

`状态数据库 collection -> 查询节点 -> 中间处理/AI -> 写入节点 -> 状态数据库 collection`

这比让 schema 继续藏在写入节点中更符合“从数据库读，流转后写回数据库”的直觉。

如果状态数据库节点被做成真正执行节点并全量输出 collection，风险是用户会自然期待它有输出数据、输入变更、执行顺序、失败重试等 DAG 行为；这会和当前 `state-query` / `state-write` 的职责重叠，也可能让大 collection 在每轮运行时被无意义传递。因此 MVP 应把它做成“视觉节点 + collection 句柄端口 + 共享状态模型 + 读写目标同步”，而不是新增一个全量吐数据的普通 executor 节点。

用户提出的“写入时再放一个数据库节点实例来避免环”是可行的，且产品直觉较强。关键约束是：这些数据库节点实例必须是同一底层状态数据库的镜像；写入目标边必须是提交/目标绑定边，而不是普通运行时数据边。否则编辑器虽然视觉上无环，但会把一个数据库误导成多个独立状态源。

用户不希望把“镜像节点”等注意点显式铺到 UI 上，而是后续用文档解释。这个选择可以接受，尤其当前工作流编辑器更接近高级作者工具，而不是完全零文档的新手工具。代价是新用户第一次看到多个数据库节点时可能会误解为多个数据库；MVP 应避免用额外说明文案解决这个问题，但必须通过行为保证语义一致：所有数据库节点实例编辑同一份状态模型，不能出现实例间 schema 分叉。

端口设计上，采用“默认一个 collection 端口 + 可手动增加端口”是一个较好的折中。它避免默认展示所有 collection 导致节点过大，同时允许一个数据库节点承担多路读写引用。端口应被理解为 collection 连接点，不是 collection 的副本；端口数量属于画布布局/可视化表达，collection 定义仍属于同一份状态数据库模型。

添加端口只允许选择已有 collection 是当前 MVP 的推荐边界。这样画布上的端口负责“暴露连接点”，数据库编辑面板负责“定义表结构”。这会稍微多一步操作，但能显著降低端口配置、建表、schema 编辑三件事混在一起的风险。

字段类型上，MVP 推荐保留简化类型列。完全取消类型看似减负，但会让字段定义变成“只有名字的表格”，后续写入校验、格式化、默认值、数组/对象字段都会变得更反直觉。更好的折中是：类型列存在，低负担选项靠前，并设置合理默认值。类型承担校验和后续工作流提示的基础设施作用，不把它变成高级 schema 设计负担。

第一版可以包含“列表/结构”。这个选择的前提是：文本、数字、开关、任意内容这些低负担选项足够明显，列表/结构只是可见但不强迫使用的高级一点的字段形态。列表/结构在 MVP 中应保持浅层能力，先映射到现有 `array/object`，不在第一版引入复杂嵌套 schema 设计器。

Schema 承载位置上，推荐扩展 `WorkflowDefinition` 增加工作流级 `stateModel` 元数据。这比继续把 schema 塞回某个 `state-write` 节点更符合产品心智模型，也能让多个数据库节点实例天然共享一份定义。代价是需要改 contracts、导入导出、校验和默认工作流结构，但这是本次系统优化的核心边界，不应通过 UI 包装绕开。

由于项目仍在原型期，本任务不需要投入完整历史迁移机制。默认 AIRP 工作流、内置预设和测试数据可以直接升级到新模型。若实现中临时读取旧 `state-write.config.schema`，也只应作为开发期兼容兜底，不作为 acceptance criteria。

默认模型定位上，事件-档案-全局状态体系应作为内置预设模型预置到默认 AIRP 工作流的 `stateModel` 中。这样普通用户大多数时候是在已有状态表上编辑和连线，而不是从零创建数据模型。自定义 collection 仍然保留，但它是高级作者路径。`globals` 虽然通常不需要像 `archives/events` 一样查询筛选，但它仍是 AI 维护和工作流读写的状态，适合纳入同一个状态数据库心智模型。UI 上它应作为特殊全局键值表展示，避免玩家把它误解成普通 records collection。

`globals` 写入复用 `state-write`，避免新增一套全局写入节点。这样默认工作流的维护链仍然统一表达为“AI 产出操作 -> 写入状态数据库”。差异应主要体现在编辑器表单和节点摘要文案上：目标是 globals 时说“更新全局状态”，目标是 archives/events 时说“写入记录集合”。

因此，`globals` 和普通 collection 的差异不应扩大成另一套节点体系。更准确的模型是：`globals` 是内置状态模型里的 key/value collection，UI 用全局键值表表达它；读写连线仍可沿用数据库 collection 端口、`state-query` 和 `state-write`。真正需要另行评估的是“是否把 globals 直接连到模板/AI 节点来表示宏/上下文读取”，这会把 prompt 宏注入也纳入画布数据流，属于更大的可视化范围。

用户进一步澄清后，prompt 上下文注入可视化应进入本任务方向：AI 节点收到上游输入后，提示词变量应来自这些可视化输入。当前实现只做了“inputs -> 扁平字符串宏”的近似能力，缺少结构化变量上下文。更符合目标心智模型的方向是：AI prompt resolver 先解析结构化 inputs，再解析平台宏；`{{globals.currentTime}}` 对结构化 globals 做路径访问。对于 `archives` 这类复杂记录列表，不应由 AI 节点默认决定最终文本格式；应优先通过上游 `record-format` / `template-compose` 把它变成作者想要的 Markdown、XML、DSL 或 JSON 文本，再连入 AI 节点。

更通用地说，工作流边应被解释为“把上游输出存入目标节点局部变量”。这与当前 executor 的 `inputs` 模型一致，值得在编辑器里产品化。AI 节点、compute 节点、template-compose 节点、record-filter/merge/format 节点都是不同的局部变量消费者：compute 可以脚本读取结构化输入，template 可以路径读取和渲染，record 节点可以筛选/合并/格式化数组，AI 节点可以把局部变量注入 prompt。

不过，单独做一个只显示局部变量名和粗类型的面板收益不高，因为节点端口和边编辑已经承担了大部分可见性。更有价值的是把现有状态契约抽屉升级为只读状态数据库/字段定义视图：展示 `archives/events/globals` 以及自定义 collection 的字段结构、字段形态、说明、读写节点关系，并帮助作者判断结构化变量里有哪些可读路径。抽屉是便捷查阅面板，不是第二个 schema 编辑器；真正编辑仍放在数据库节点编辑面板中。

当前代码意味着“数据库节点是正式可执行节点”不是一个轻量选项。调度器会尝试执行所有 `nodes`，validator 也会把所有边纳入无环 DAG。因此 MVP 决定把数据库节点作为工作流定义中的状态模型视图节点/锚点存储，例如 `stateModel.anchors`；不要用 no-op executor 假装数据库节点是普通执行节点。

数据库读写可视连线应持久化在 `stateModel.links` 这类 metadata 中。仅同步 `state-query/state-write` 配置虽然更省事，但会让用户保存后失去“数据库 -> 查询 / 写入 -> 数据库”的画布关系，违背本任务最核心的可理解性目标。运行时执行则可以保守一些：保存或应用工作流时把 links 解析结果同步到 `state-query/state-write.config.namespace/collection`，继续复用现有 executor。为避免双真源，编辑器层必须把 links 作为 UI 真源，发现 config 不一致时重写 config。

读写绑定范围上，MVP 区分查询和写入：查询节点仍限制为一个 collection，因为一次查询的输入、输出和调试语义需要清楚；写入节点允许多个 collection 目标，因为当前 `state-write` 已经通过 `StateWriteOperation.collection` 支持一批 operations 写入多个 collection。强行拆分写入节点会要求额外拆分 AI 产出的 operations，反而增加复杂度。

多查询暂不进入 MVP。即使采用“分别输出”的方式，多查询节点主要也只是减少几个查询节点，后续筛选、格式化、合并等处理仍然需要按 collection 分开。相较之下，它会增加动态输出端口、limit/query 语义和调试复杂度，因此第一版继续保持单查询节点更稳。

运行时改造应分层控制：不重写 workflow-engine scheduler，不把数据库锚点当 executor，不重做 IndexedDB/stateRecords。必须做的是执行前归一化和 AI prompt 结构化输入支持。执行前归一化负责把 `stateModel.links` 转换成现有 `state-query/state-write` executor 可理解的配置，并让 `state-write` 继续基于 workflow-level schema 做校验。AI prompt 结构化输入支持负责让可视化连线真正变成 `{{globals.currentTime}}` 这类可用变量。这个范围收益高、成本可控；完整调度器改造收益不匹配 MVP 成本。

源 workflow 应保持干净：`stateModel`、数据库锚点和 links 是作者编辑/导出的真源；运行前临时编译出 runtime definition，派生出 executor 需要的 `namespace/collection/schema` 等 config。这样运行时复用现有 executor，又不会把旧的节点内 schema/config 模型重新写回源数据。

## MVP Slice

第一轮实现以“状态数据库节点 + 可视读写关系 + 结构化输入心智模型成立”为目标，不一次性重写整个工作流系统。

MVP includes:

* 扩展 `WorkflowDefinition.stateModel`，承载内置/自定义状态模型、数据库锚点和可视读写 links。
* 默认 AIRP 工作流升级到 `stateModel`，预置 `archives/events/globals`。
* 数据库节点作为 `stateModel.anchors` 渲染在画布上，不进入可执行 `nodes`。
* 数据库节点默认一个 collection 端口，可添加端口并绑定已有 collection。
* 读关系显示为 `数据库 collection -> state-query`，写关系显示为 `state-write -> 数据库 collection`，持久化到 `stateModel.links`。
* 执行前编译 runtime definition：从 links 派生查询/写入目标配置和写入 schema 校验所需信息，不把派生配置写回源 workflow。
* `ai-call` prompt 支持结构化 inputs 路径读取，让可视化连线进入 AI 节点后能作为 prompt 变量使用。
* 状态契约抽屉升级为只读状态数据库/字段定义视图，展示 collection 字段定义和读写关系。
* 数据库节点编辑面板提供 collection/字段表编辑，字段类型使用简化形态：文本、数字、开关、任意内容、列表、结构；列表/结构不展开嵌套配置。

Deferred:

* 不重写 workflow-engine scheduler。
* 不把数据库节点加入可执行 DAG。
* 不做完整历史工作流迁移系统。
* 不做复杂 schema 版本迁移、查询 DSL、关系型数据库能力。
* 不做完整 compute 脚本可视化或所有 prompt 宏来源可视化。

## Implementation Plan

1. Contracts and model:
   Add `WorkflowDefinition.stateModel` types for collections/global state, anchors, ports, and links.

2. Runtime compile layer:
   Add a pure helper that compiles source workflow definitions into executable runtime definitions by applying `stateModel.links` and schema metadata to existing state nodes.

3. Default workflow:
   Update the built-in AIRP workflow/preset to carry `stateModel` and database anchors/links for `archives/events/globals`.

4. Editor model:
   Teach `useWorkflowEditor` and `WorkflowEditorCanvas` to render database anchors as visual nodes and `stateModel.links` as visual database edges without feeding them into runtime DAG edges.

5. Database authoring:
   Add/adjust database node editing UI for collection ports and simplified table-style field editing.

6. Field reference drawer:
   Upgrade the state-contract drawer into a read-only state database/field definition view with collection fields and read/write participants.

7. Structured prompt inputs:
   Update AI prompt macro/input resolution so connected structured inputs can be used by path in prompts, while formatted text still comes from explicit upstream formatting nodes.

8. Validation and tests:
   Add editor diagnostics for missing database links, invalid anchor ports, one-collection-per-state-node rule, dangling `stateModel.links`, and build/test coverage for contracts/runtime compile/prompt input behavior.

## Open Questions

* None for the first MVP slice.

## Out of Scope (initial)

* 不在第一阶段重做底层 IndexedDB/Dexie 存储模型。
* 不在第一阶段引入完整关系型数据库能力、迁移系统、复杂查询 DSL 或 schema 版本迁移。
* 不移除 `state-query` / `state-write` 的手动 `namespace / collection` 高级输入能力。
* 不强制把所有运行时动态写入都静态化。
* 不把 compute 脚本或 AI 输出结构完全可视化。

## Technical Notes

* 当前任务目录：`.trellis/tasks/06-07-workflow-editor-state-dataflow`
* 工作流编辑器：
  * `apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue`
  * `apps/platform-web/src/components/workflow/NodeInspector.vue`
  * `apps/platform-web/src/components/workflow/node-schema.ts`
  * `apps/platform-web/src/components/workflow/state-contract.ts`
  * `apps/platform-web/src/components/workflow/workflow-diagnostics.ts`
* 状态节点表单：
  * `apps/platform-web/src/components/workflow/inspector/StateQueryForm.vue`
  * `apps/platform-web/src/components/workflow/inspector/StateWriteForm.vue`
  * `apps/platform-web/src/components/workflow/inspector/StateSchemaEditor.vue`
* 运行时执行：
  * `apps/platform-web/src/workflow-host/executors/state-query.ts`
  * `apps/platform-web/src/workflow-host/executors/state-write.ts`
  * `apps/platform-web/src/storage/state-records.ts`
* 契约类型：
  * `packages/contracts/src/workflow.ts`
  * `packages/contracts/src/memory.ts`
  * `packages/contracts/src/runtime.ts`
* 相关历史任务：
  * `.trellis/tasks/archive/2026-06/06-06-workflow-carried-state-contract-authoring/prd.md`
  * `.trellis/tasks/archive/2026-06/06-06-workflow-editor-state-contract-ux/prd.md`
  * `.trellis/tasks/archive/2026-06/06-07-workflow-editor-usability-validation/prd.md`
