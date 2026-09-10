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
- 机械回合字段、引用包装、条目标识、记忆编号、装备贡献与提交凭据由程序维护。`plotOrder`、显著剧情节点与原著的关系仍由场记判断。records / seeds / recall 分类保留。

`npm run package:card` 还会使用导入包的真实 Skill，在隔离浏览器 Worker 中执行确定性维护样例，验证幂等、提交凭据和写入/输出失败回滚；不会调用 AI，也不会改动玩家存档。实际提取质量与速度需要在更新平台并导入新卡后由玩家测试。已有存档不自动迁移。
