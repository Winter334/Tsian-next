# 核心设计

遵循父任务 `design.md` 第 2–4 节。

## 模块边界

- `@tsian/contracts`：联合记录、摘要、查询与健康状态类型。
- `storage/db.ts`：在当前 DB 名中增加 Dexie schema 版本和 `diagnosticRecords` 表。
- `storage/diagnostic-records.ts`：put/update/query/关系闭包/保留清理；唯一权威持久层。
- `runtime-host/ai/trace-recorder.ts`：request 生命周期、attempt observer、脱敏、size 计量、健康事件。
- `runtime-host/ai/calls.ts` / `fetch.ts`：所有 provider 请求接入 recorder。
- Agent Runtime：只传递通用关联上下文，不持久化渠道字段。
- `frontend-diagnostics.ts` + `main.ts`：安装四类全局前端错误收集器。

## 旧数据策略

采用同名数据库的新增 Dexie version，避免清空已有卡片和存档。旧 Trace 文件和 AI Debug meta key 不迁移、不读取、不主动删除；核心切换同步删除旧写入以及 parser/query/bridge 读取入口，不保留临时兼容层。旧路径只可继续被 save 生命周期代码当作普通遗留文件清理。
