# 本任务适用的存储契约摘录

来源：`.trellis/spec/platform-web/storage/index.md` 与本任务已确认设计。

- Dexie table interface 和 schema 必须集中在 `apps/platform-web/src/storage/db.ts`；同一表不得创建重复 helper。
- 当前项目通常通过更换数据库名重置本地数据，不默认维护迁移。本任务因为只新增独立诊断表、且重置会无必要地清空用户卡片/存档，明确选择在现有数据库名内增加 Dexie schema version。该例外必须随最终规划由用户批准，并有升级保留既有表的测试。
- 新权威表名为 `diagnosticRecords`；AI 与前端错误共享一张联合表和 7 天/100 MiB 清理策略。
- Trace 属于内部可查询 bookkeeping，适合 IndexedDB；`.tsian/local/diagnostics/**` 是只读虚拟派生视图，不是第二份持久化文件。
- `.tsian/local/**` 不进入 checkpoint；新诊断表也不随 save/card 生灭，不因切换卡片清空。
- 旧 `.tsian/save/traces/**`、`.tsian/local/assistant/traces/**` 与 AI Debug 不迁移、不兼容读取、不破坏性删除；升级后不得继续写入，也不得保留诊断 parser/query/bridge 入口。
- 任意 storage 改动运行 `npm run build:web`；contract 改动另运行 `npm run build:contracts`；最后运行定向测试和 `git diff --check`。
