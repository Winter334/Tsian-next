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

当前验证通过：

- `npm run build:contracts`
- `npm run build:runtime-core`
- `npm run build:web`

## 3. 已落地的核心契约

### 3.1 档案就是实体当前状态

当前代码已经采用以下口径：

- `ArchiveRecord` 使用 `kind`
- `ArchiveRecord` 使用 `linkedNames`
- 档案对象允许承载扩展字段
- 不再使用旧的 `entityType`
- 不再使用旧的 `relatedEntities`

当前理解方式：

`archives` 不是独立设定库加另一份运行时状态，而是实体当前状态的唯一真源。

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

### 3.5 档案 patch

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
    "kind": "item:object",
    "name": "...",
    "aliases": [],
    "background": "...",
    "situation": "...",
    "focus": "...",
    "linkedNames": [],
    "presence": "foreground"
  }
}
```

## 4. 当前实现入口

文档入口：

- `README.md`
- `current-state-handoff.md`
- `implementation-plan.md`

主干参考文档：

- `memory-system-decisions.md`
- `narrative-entity-archive-skeleton.md`
- `patch-contract-skeleton.md`

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
- 模组导入、导出、下载、上传
- 前端包沙箱与权限边界
- `kind` 对应字段定义的正式配置 UI
- 多进行中事件并行维护
- 完整工坊系统
- 正式提示词预设兼容 SillyTavern
- 正式测试体系

## 6. 下一步建议

当前最适合继续的方向是：

`围绕已落地的新契约做一次真实运行验收。`

建议验收顺序：

1. 启动 `npm run dev:web`
2. 新建存档，确保使用 `tsian-local-v2` 新库
3. 发送一轮真实游玩输入
4. 检查检索调试是否使用实体名称生成查询组
5. 检查维护 AI 是否输出 `globals/events/archives` 新 patch
6. 检查事件是否更新 `entityTags/content/status`
7. 检查档案是否更新 `situation/focus/linkedNames`
8. 检查快照中是否只存在 `globals`，不再出现旧 `status`

如果这轮验收通过，再进入 `implementation-plan.md` 中的阶段 B。

## 7. 注意事项

当前仍处于快速原型期：

- 不做旧 IndexedDB 数据迁移
- 不做兼容层
- 本地数据异常时优先新建存档或清空浏览器本地数据
- 不提前设计复杂通用 patch 系统
- 不提前实现多事件并行维护
- 不提前抽象插件系统
