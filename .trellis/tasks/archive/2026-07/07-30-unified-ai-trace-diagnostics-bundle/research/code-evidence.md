# 现状代码证据（2026-07-30）

## AI 调用与 AI Debug

- `apps/platform-web/src/runtime-host/ai/calls.ts:73,157,256,496` 是四种真实 provider 请求入口；每个入口分别调用 `pushAiDebugRecord` / `updateAiDebugRecord`，是统一采集的正确边界。
- `apps/platform-web/src/runtime-host/ai/debug-records.ts:63-131` 使用进程内自增 ID、内存 buffer 和 fire-and-forget 的整数组重写；跨刷新唯一性和并发 patch 都不可靠。
- `apps/platform-web/src/storage/ai-debug-records.ts:13-56` 把全部 AI Debug 存在一个 Dexie meta JSON 字符串中，只按 7 天清理，不支持体积、分页、关系或并发更新。
- `apps/platform-web/src/runtime-host/ai/fetch.ts:157-208` 的 retry loop 已知道 attempt、是否重试、delay 和结构化失败，但只写 `console.warn`，没有进入可查询记录。
- `packages/contracts/src/debug.ts:27-55` 的 `AiDebugRecord` 已有 messages/response/usage，但缺少 duration、finish reason、attempt、完整工具与关系字段。

## 分散 Runtime Trace

- `apps/platform-web/src/agent-runtime/trace.ts:145-178` 按 turn 创建 collector，并分别格式化正式回合与 agent 专属 JSONL 路径。
- `apps/platform-web/src/platform-host/runtime-turn.ts:79,361-403` 持久化正式回合 Trace。
- `apps/platform-web/src/platform-host/ai-invocation.ts:229-246,475-527` 把 `invokeAgent` Trace 写入 agents 目录。
- `apps/platform-web/src/platform-host/assistant-chat.ts:458-462,831-843` 把桌面助手 Trace 写入 local assistant 目录。
- `apps/platform-web/src/agent-runtime/diagnostics.ts:16-17,99-105,560-600` 将 agent trace 映射为 turn 0，而正 turn window 会排除它。
- `apps/platform-web/src/platform-host/resource-queries.ts:164-199` 同时暴露 runtime-diagnostics、runtime-trace 与 ai-debug 三套查询源。

## 系统监视器

- `apps/platform-web/src/views/DebugView.vue:58-203` 的 Overview 统计只读 `AiDebugRecord`。
- `apps/platform-web/src/views/DebugView.vue:252-302` 的运行日志按 Turn 导航和渲染 JSONL 事件，天然看不到无活动存档的全局调用。
- `apps/platform-web/src/views/DebugView.vue:798-903` 分别请求 AI Debug、runtime diagnostics 和 runtime trace，证明当前没有单一可信数据源。

## IndexedDB 与 workspace

- `apps/platform-web/src/storage/db.ts:188-222` 集中声明 Dexie 表与 schema；当前 DB 名为 v14、Dexie schema version 为 1。新增表应使用同名数据库的新增 schema version，避免清空既有卡片/存档。
- `apps/platform-web/src/platform-host/assistant-chat.ts:338-376` 在每轮开始把有效 workspace、全部 local assistant 文件与附件合并为内存快照；不能把最多 100 MiB Trace 直接加入该数组。
- `apps/platform-web/src/agent-runtime/workspace-tools/tool-execution.ts:467-478` 现有 workspace 工具统一进入 `executeWorkspaceOperation`，适合增加内部 virtual read adapter 而不新增 Agent 工具。
- `apps/platform-web/src/agent-runtime/workspace-tools-types.ts:488-504` 是 workspace tool context 的透传契约入口。
- `apps/platform-web/src/platform-host/workspace-volumes.ts:396-470` 已按 scope/path-prefix 路由 platform-meta volume，但现有 volume 基于 enumerate，不能直接解决 Agent turn 中的按需虚拟读取。

## 前端错误与导出能力

- `apps/platform-web/src/main.ts:1-6` 当前直接 mount Vue，没有安装 Vue errorHandler、window error 或 unhandledrejection 收集器。
- `apps/platform-web/package.json` 已依赖 `fflate`；`storage/save-backups.ts` 和 `storage/game-card-packages.ts` 已有 zip 构建模式，可复用而无需新增依赖。

## 实施约束

- Trace writer 必须处于 AI provider 调用层；host 入口只能传通用关联上下文。
- 新联合表是权威数据；监视器、导出与 workspace 都通过查询服务消费。
- 虚拟投影必须扩展现有 workspace operation 内部能力，不能通过全量 `WorkspaceFile[]` 快照模拟。
- 旧 JSONL/AI Debug 不迁移也不兼容读取；实现必须同时移除旧 writer 与 parser/query/bridge 读取入口。
