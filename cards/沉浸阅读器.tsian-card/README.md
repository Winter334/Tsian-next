# 沉浸阅读器：创作源与分发

本目录保留卡的创作源，不保留解包所得的旧前端副本或生成的 `game-card.json`。

| 内容 | 权威来源 |
| --- | --- |
| 卡配置 | `card-manifest.json` |
| Agent、Skill、工具、静态资料 | `workspace/` |
| 初始存档业务文件 | `workspace/initial-save/`（manifest 的 `runtime.initialSave.templateRoot`） |
| 卡游玩前端源码 | 仓库 `apps/play-frontend-dev/src/` |
| 封面 | `cover/` |
| 平台存档机制、内部元数据 | 仓库 `apps/platform-web/src/storage/`，不随本卡业务模板替换 |

在仓库根执行 `npm run package:card -- --out tmp/immersive-reader.tsian-card.zip`。
打包器读取上述创作源，通过平台真实构建/导出链生成 zip；包中的 `game-card.json`、`frontend/src/`、`frontend/dist/` 是分发内容，不是另一套维护源。

## 初始存档

平台只在新建存档时，将 `initial-save/` 下文件按相对路径原样复制到 `save/`。不解析小说 schema、不展开宏、不合并平台业务默认值。目录不能为空；没有业务初始文件的卡可以省略初始化配置。平台内部 `.tsian/` 元数据独立创建。

导入/更新卡包、打开已有存档、checkpoint 回溯不会重新套用模板。已有存档不自动迁移或覆盖。开局建模仍由卡内世界架构师与脚本填充具体世界资料。

修改后验证实际包和新建存档，而不是同步已废弃的内置 Agent/Skill 模板。


## 场记维护的生产源

- `apps/play-frontend-dev/src/lib/maintenance-context.ts` 在调用前生成 `save/maintenance/context.md`（本轮正文、相关旧资料、世界规则与剧情节点）及不注入模型的 `session.json`（比较基线与提交标识）。两者都是可重建材料，不是新剧情权威。
- `useSyncAfterTurn.ts` 使用 `persist: false` + `includeRecentHistory: false`，调用后核验本轮提交凭据，才刷新界面并显示成功。
- `workspace/agents/stage-manager/skills/回合后维护/` 是语义协议与执行实现的权威：`lookup` 查询资料，`submit_changes` 提交变更；`semantic-fields.json` 由卡前端和脚本共同读取。不能在可分发前端源码中通过仓库外相对 import 引入卡 workspace 文件。
- 场记仅启用这一个 Skill；原始文件工具与旧场记专用 Tool 均不暴露，`schema演进检查` 不启用，旧 `workspace-map.md` 不再引用/注入。旧文件不是当前维护入口。`装备管理/scripts/equipment-core.js` 仅由提交脚本复用其确定性执行逻辑，不要求场记加载装备存储规范。
- 机械回合字段、引用包装、条目标识、记忆编号、装备贡献与提交凭据由程序维护。不再判断原著偏离/并回或提交剧情坐标；重要历史直接复用 recall 摘要。records / seeds / recall 分类保留。

`npm run package:card` 还会使用导入包的真实 Skill，在隔离浏览器 Worker 中执行确定性维护样例，验证幂等、提交凭据和写入/输出失败回滚；不会调用 AI，也不会改动玩家存档。实际提取质量与速度需要在更新平台并导入新卡后由玩家测试。已有存档不自动迁移。

## 原著驱动的生产链

顺序：**写手访谈 → 玩家确认 → 架构师适配世界/schema → 写手阅读原著并创作 → 场记首次建档 → 开局就绪**。

- `workspace/skills/原著阅读/` 是写手与架构师共享的章节定位/连续原文能力，场记不加载。书签只用于检索，不锁未来、不强制回原著。
- `workspace/agents/storyteller/skills/开局访谈/` 提交确认方案。写手正文优先原著人物与文风，前端 `lib/story-source.ts` 在开局和正式回合实际提供连续原文；不足时补读。
- `workspace/agents/world-architect/skills/开局建模/` 仅提交 world/summary，不再预建实体库。schema 文件继续由程序生成。
- `apps/play-frontend-dev/src/lib/opening-flow.ts` 保留独立调用与恢复。`workspace/frontend-actions/opening/` 保留显式确认、从独立持久 transcript 发布正文和最终完成核验。内部 model/id 仅作为世界适配提交凭据及正文 slot 身份。
- 场记基于已落定正文及确认前提创建/更新本局资料；名称/别名 lookup 和程序创建候选检查共同保护稳定 ID，同名不同对象需明确区别。turn 0 首次维护建立主角/地点/场景，成功后 runtime.turn=1。
- 正文已记录就复用，维护失败不重写正文，刷新不调用 AI，显式重试才继续未完成阶段。重要时间线复用 turn.meta.recall 摘要，不展示未来计划或原著差异。旧 frontier 调用、Skill 和前端消费者已退出；RAG 未改造。

`npm run package:card -- --out tmp/immersive-reader-canon-storytelling.tsian-card.zip` 会构建真实前端、导出/导入卡包并用导入资源在真实 Worker 中执行世界适配、开局原子动作、场记初建/维护、原文读取及候选保护验证。不会调用 AI。用新卡新存档测试；旧卡/旧存档不迁移。剧情、人物、文风、认知边界与速度由玩家实测。
