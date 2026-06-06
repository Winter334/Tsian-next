# Tsian Current State Handoff

## 1. 文档目的

本文档用于新会话快速接手当前项目状态。

它只记录：

- 当前代码已经落地到什么程度
- 哪些设计决策已经固定
- 哪些内容还没有实现
- 下一步最适合从哪里继续

它不替代其他设计文档，也不展开新的架构设计。

## 2. 当前项目状态

当前项目已经进入可运行原型阶段。

> 2026-06-05 更新：本 `docs/active` 目录中的部分阶段性路线早于
> Trellis 工作流/记忆迁移任务。当前 workflow 与 AIRP generic state records 的
> 真源以 `.trellis/spec/`、`openspec/specs/` 和代码为准；本文保留早期
> 状态说明，同时在下方记录最新增量，避免后续继续按旧 patch-only
> 主链理解系统。

已完成：

- Git 仓库初始化
- 初始提交：`3d671dd Initial Tsian prototype scaffold`
- 平台 WebUI 最小壳
- 官方默认游玩前端包
- 本地 IndexedDB/Dexie 存储
- 最小 AI 主链：检索 AI -> 正文 AI -> 维护 AI
- 事件记忆、档案、全局状态、当前时间的最小闭环
- 默认测试种子
- 新 patch 契约在代码中完成第一轮落地
- 完整状态 checkpoint 最小骨架：创建存档写入初始切片，每轮调度后写入回合切片，官方前端可列出并恢复
- 记忆检索 v2 第一轮落地：默认结构检索为基础链路；可选 AI 增强检索默认关闭，开启后使用非实体语义关键词和本地向量缓存补充召回
- 事件维护缺口补齐：支持轻量多 active event，支持 events.create，允许暂时没有 active event
- 关系强绑定缺口补齐：`entityTags / linkedNames` 仍是名称弱关系，内部 `entityArchiveIds / linkedArchiveIds` 只在当前可见实体池唯一解析时写入
- 内置模组最小装载链：平台可列出内置模组、按 `modId` 建档、前端可读取当前 `mod-static`
- 前端正式运行时写入口最小版：`write-runtime` 已落地，支持完整切片替换与结构化错误返回

当前验证通过：

- `npm run build:contracts`
- `npm run build:runtime-core`
- `npm run build:web`

2026-06-05 workflow / memory 增量：

- 平台工作流来源顺序为：save-level workflow preset override ->
  mod `workflowPresetId` resource -> deprecated `manifest.workflow` ->
  platform default workflow。
- 内置模组不应再通过 deprecated `manifest.workflow` 携带当前工作流；
  built-in workflow preset 由显式 seed 写入资源库，灰盐镇通过
  `workflowPresetId` 引用该资源。
- AIRP 当前权威记忆是 save-scoped generic `stateRecords` 中的
  `airp/events`、`airp/archives`、`airp/globals/currentTime`。
  legacy snapshot/events/archives 是兼容投影，不再反向约束主链。
- `state-query` workflow node 现在是 collection-only；旧
  `memory-query` 节点和旧 `source: "event-archive"` 分支已从
  editor/runtime workflow surface 退场。
  默认工作流使用 AIRP collection query、公开 record 节点和 bounded compute
  组成混合检索 preset。
- 默认维护写入走 `maintenance.operations -> stateWrite.operations`。
  `apply-patch` workflow node 已退场；桥/API patch 兼容写入口保留，并在写
  legacy slices 后同步回 generic AIRP memory。
- `state-write` 节点默认不创建节点本地 checkpoint；
  平台回合成功后统一创建 after-turn checkpoint。
- 当前 DebugView 的维护写入面板展示 maintenance / state-write 节点结果，
  不再把 legacy patch 视为唯一维护结果。
- 已知但刻意暂缓的后续工作记录在 `./deferred-work.md`，包括 schema
  可见性、schema resources 和 renderer adapters。

当前新的边界已经确认，其中仍未继续展开的部分：

- 开局引导不属于平台基础能力，由前端包按玩法自行实现
- 灰盐镇当前仍是开发测试种子；在模组装载阶段会暂时作为内置测试模组使用，但不视为长期官方模组

## 3. 已落地的核心契约

注意：本节记录当前代码已落地状态。档案契约已进一步收敛为 `type` + 扁平档案对象方向。

### 3.1 档案就是实体当前状态

当前代码已经采用以下口径：

- `ArchiveRecord` 使用 `type`
- `ArchiveRecord` 使用 `linkedNames`
- 档案对象允许承载扩展字段
- 不再使用旧的 `entityType`
- 不再使用旧的 `relatedEntities`

当前理解方式：

`archives` 不是独立设定库加另一份运行时状态，而是实体当前状态的唯一真源。

当前新方向：

- 存储对象仍然保持扁平档案对象
- 使用最终实体 `type`，不再使用 `kind`
- 程序内部可以有父类 / 子类式类型定义来复用字段
- AI 只看最终 `type` 及其合并后的合法字段列表，不看内部继承关系
- `focus` 不再作为所有实体强制公共字段，改为部分类型可选字段

### 3.2 全局状态使用 globals

当前代码已经采用以下口径：

- `RuntimeSnapshotShell.state.globals` 承载非实体全局状态
- 不再使用旧的 `RuntimeStatusMap`
- 不再使用旧的 `state.status`

当前理解方式：

`globals` 只放不属于任何单个实体、但影响当前局面的状态，例如场景、风险、天气、章节名、前端包消费的全局数据。

### 3.3 Patch 契约

当前维护 AI patch 顶层分组为：

1. `currentTime`
2. `globals`
3. `events`
4. `archives`

当前动作口径为：

- `target`
- `set`
- `create`

当前明确不引入：

- `del`
- RFC 6902 JSON Patch
- 深层路径 patch
- 多事件复杂定位系统

### 3.4 事件 patch

当前事件 patch 仍保持最小闭环：

```json
{
  "target": "active",
  "set": {
    "status": "ongoing",
    "time": "...",
    "entityTags": ["..."],
    "content": "..."
  }
}
```

当前只维护一个 `active` 进行中事件。

### 3.5 Checkpoint 状态切片

当前平台已有最小线性 checkpoint：

- checkpoint 是完整游戏状态切片，不是只保存 `RuntimeSnapshotShell`
- 每个 checkpoint 包含 `snapshot / history / events / archives / stateRecords`
- 创建存档时写入 `initial` checkpoint
- 每轮 AI 调度完成并持久化后写入 `after-turn` checkpoint
- 官方默认前端通过“回溯”页签列出 checkpoint，并可恢复到指定切片

当前明确不做：

- 不做分支时间线
- 不做 diff 快照
- 不做局部 reroll
- 不做 checkpoint 版本兼容

### 3.6 记忆检索 v2 当前落地

当前代码已将正文注入前的默认检索主链路改为结构检索：

- 直接命中实体档案默认注入
- active event `entityTags` 对应实体作为当前在场/关键实体默认注入；多个 active event 会共同参与在场实体池
- 历史事件不再依赖检索 AI 生成实体查询词组作为主链路
- 程序按当前实体池匹配事件 `entityTags`，选择高质量 seed event
- 以 seed event 为中心注入相邻事件链片段
- 最终注入事件 `entityTags` 对应档案默认补充注入
- 关联实体只作为桥接候选，当前不因为 `linkedNames` 存在就无条件注入
- seed event 数量、相邻事件数量、注入上限、候选上限、桥接实体上限已支持代码级配置；当前只通过环境变量覆盖，不做可视化配置

可选 AI 增强检索当前已落地最小闭环：

- 默认关闭，需要显式开启 `VITE_RETRIEVAL_AI_ENHANCED`
- 开启后由检索 AI 生成非实体语义关键词
- 使用 embedding 对事件记录和实体档案做本地向量召回
- 向量缓存保存在 Dexie `embeddings` 表，按 `targetType / targetId / embeddingModel / contentHash` 判断是否复用
- AI 增强结果只作为补充来源，不挤掉默认结构检索的基础结果
- 命中的语义事件仍按相邻事件链片段注入
- 测试前端的“检索”页会显示是否开启、关键词、语义命中事件和语义命中档案

当前尚未落地：

- 可视化配置 seed event 数量、相邻事件数量和注入上限

### 3.7 事件维护当前落地

当前事件维护已从单一 active event 升级为轻量多 active：

- 维护 AI 可以用 `target + set` 更新已有事件
- 维护 AI 可以用 `create` 创建新事件，事件 id 由程序生成
- 系统允许暂时没有 active event
- 系统允许多个 `ongoing` 事件同时存在
- 当前不做复杂事件调度器、事件分支、事件删除或依赖图
- 测试前端事件页会显示事件 id 和内部强绑定档案 id

### 3.8 关系字段当前落地

当前关系字段分为两层：

- `entityTags / linkedNames`：AI 可读名称弱关系，允许同名，不要求全局唯一
- `entityArchiveIds / linkedArchiveIds`：程序内部强关系，只在当前可见实体池唯一解析时写入

当前明确不做：

- 不限制正文 AI 命名自由
- 不做名称唯一校验
- 不做程序层自动合并同名档案
- 不做全库扫描补齐强关系
- 不做后续轮次自动回填
- 同名歧义导致无法唯一解析时，宁愿不写强关系，也不猜测绑定

### 3.9 档案 patch

更新已有档案：

```json
{
  "target": "C7KQ",
  "set": {
    "situation": "...",
    "focus": "...",
    "linkedNames": ["..."]
  }
}
```

新建档案：

```json
{
  "create": {
    "type": "equipment",
    "name": "...",
    "aliases": [],
    "background": "...",
    "situation": "...",
    "linkedNames": [],
    "presence": "foreground"
  }
}
```

### 3.10 模组、运行时与桥 API 边界

当前已经确认以下实现边界：

- 模组提供`静态内容`，运行中的存档提供`实际游玩状态`
- 模组静态层当前建议至少包含：
  - `manifest`
  - `frontend config`
  - `entity type definitions`
  - `archive catalog`
  - `event catalog`
  - `globals defaults`
- 模组中的`event catalog`是作者预设的潜在事件定义，不等于运行时 `events`
- 运行时 `events` 仍然只表示已经发生或正在发生的事实记录
- 平台负责把某个模组实例化为一份存档；模组本身不等于某次具体游玩进度
- 开局引导不是平台基础契约，不由平台统一提供；如果某个玩法需要开局引导，由对应前端包自行实现
- 前端包需要的能力由桥 API 提供，至少包括：读取模组静态内容、读取运行时状态、写入运行时状态、调用 AI、修改平台配置
- 前端包对运行时状态的修改必须走平台正式写入口，不能直接写底层存储，否则 checkpoint、回溯和调试视图会失真
- 灰盐镇在模组装载实现阶段会暂时作为内置测试模组参与链路验证，但后续可以被真正的官方模组替换

### 3.11 预设事件 event catalog 当前口径

当前对作者预定义事件进一步固定如下：

- `event catalog` 是静态预设剧情钩子，不是事实记录，不直接写入运行时 `events`
- 预设事件最小结构建议包含：`id / name / entityTags / content / trigger / guidance`
- `trigger` 当前推荐混合触发：先用时间、`globals`、实体、地点等硬条件过滤，再结合当前上下文做软排序
- 预设事件应单独注入给正文 AI，不与历史事件记录混在同一分区
- 预设事件进入正文上下文只表示“本轮可吸收”，不代表事实已经发生
- 只有正文 AI 实际采用并在正文中产生相关事实后，维护 AI 才将其抽取为运行时事件，进入 `active event -> 历史事件` 主链
- 维护 AI 不负责维护预设事件自身的未触发、已采用、废弃等状态
- 当前不引入预设事件运行时状态机，不引入 `sourceCatalogEventId`，不建立预设事件与运行时事件之间的程序级显式追踪关系

### 3.12 前端正式写入口 `write-runtime`

当前平台桥新增最小正式写入口：

- 动作名：`write-runtime`
- 目标：供前端包在非 AI 通道下正式修改运行时切片
- 原则：`完整切片替换 + 省略字段保持不变`

当前请求字段：

- `turn`
- `currentTime`
- `globals`
- `history`
- `events`
- `archives`
- `checkpointLabel`

当前固定语义：

- `globals` 提供时，整体替换当前 `globals`
- `history` 提供时，同时替换 `saveHistory` 和 `snapshot.state.messages`
- `events` 提供时，整体替换当前事件切片
- `archives` 提供时，整体替换当前档案切片
- `events[].id / archives[].id` 可省略；省略时由平台分配
- 每次成功写入后，平台会自动创建一条 `manual` checkpoint
- 平台不会暴露底层 Dexie 表给前端包直接操作

当前错误返回已结构化：

- `error.code`
- `error.message`
- `error.details`

当前明确不做：

- 不做深层路径 patch
- 不做前端直写底层表
- 不做复杂通用事务 DSL

## 4. 当前实现入口

文档入口：

- `../README.md`
- `./current-state-handoff.md`
- `./airp-workflow-platform-direction.md`
- `./deferred-work.md`

历史参考文档：

- `../archive/2026-06-05-workflow-as-system/implementation-plan.md`
- `../archive/2026-06-05-workflow-as-system/memory-system-decisions.md`
- `../archive/2026-06-05-workflow-as-system/narrative-entity-archive-skeleton.md`
- `../archive/2026-06-05-workflow-as-system/patch-contract-skeleton.md`

这些历史文档不再作为 active guidance。长期方向以
`./airp-workflow-platform-direction.md` 为准。

关键实现入口：

- `packages/contracts/src/runtime.ts`
- `apps/platform-web/src/runtime-host/retrieval.ts`
- `apps/platform-web/src/runtime-host/maintenance.ts`
- `apps/platform-web/src/runtime-host/engine.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/storage/archives.ts`
- `apps/platform-web/src/storage/events.ts`
- `apps/platform-web/src/storage/saves.ts`
- `builtin/play-frontends/official-default/src/index.ts`

## 5. 当前没有做的内容

当前仍未实现或未正式设计：

- 可视化 AI 提供商配置 UI
- 可视化提示词预设系统
- 可视化 AI 调度编排
- 模组静态内容装载与内置模组选择
- 读取模组静态内容与写入运行时状态的桥 API
- 模组导入、导出、下载、上传
- 前端包沙箱与权限边界
- `type` 对应字段定义的正式配置 UI
- 完整工坊系统
- 正式提示词预设兼容 SillyTavern
- 正式测试体系

## 6. 下一步建议

当前最适合继续的方向是：

`围绕 workflow-as-system 方向继续清理工作流节点语义、兼容边界和默认 AIRP 系统的配置化边界。`

优先候选：

1. 收紧或退役不再适合作为通用 workflow surface 的兼容节点。
2. 继续把默认 AIRP 事件/档案系统表达为 schema + workflow preset +
   renderer，而不是平台通用节点语义。
3. 为未来 schema resources、workflow blocks/subgraphs、renderer adapters
   留出清晰位置。

已知但刻意暂缓的任务不要只留在聊天上下文里；登记到
`./deferred-work.md`，并在真正实现时按条目里的 scope guard 单独开
Trellis 任务。

具体实现仍应通过 Trellis 任务 PRD 明确范围后再推进。

## 7. 注意事项

当前仍处于快速原型期：

- 不做旧 IndexedDB 数据迁移
- 不把临时兼容层扩展成长期模型
- 本地数据异常时优先新建存档或清空浏览器本地数据
- 不提前设计复杂通用 patch 系统
- 不把默认事件/档案系统误当成所有 AIRP 系统的唯一架构
- 不用任意 compute 脚本替代应沉淀为平台原语的常见能力
