# 统一 AI Trace 核心存储与采集

## Goal

在真实 AI provider 调用边界建立渠道无关的统一 Trace，以一张全局 IndexedDB 表持久化完整请求、响应、重试与通用前端错误，并停止向旧渠道 Trace 写入新记录。

## Requirements

- 定义 `ai-request` / `frontend-error` 联合记录 schema；AI 记录不得包含 turn、saveId、sessionId、agentId、debugLabel 或入口名称。
- 正式回合、`invokeAgent`、桌面助手与未来调用方复用同一 AI recorder。
- 完整记录消息、工具声明/调用、provider/model/参数、最终响应、finish reason、usage/cache、耗时、attempt 与结构化错误。
- 使用 operation/parent/previous/attempt 通用关系表达工具轮次、委派与网络重试。
- 持久化前递归删除 API Key、Authorization、Cookie 等凭据；二进制附件仅记录元数据/引用。
- 捕获未处理 runtime、Promise、Vue 与资源加载错误；不捕获 console 和已处理错误。
- 保留 7 天且最多 100 MiB，最旧优先；写入失败不影响 AI 主流程并暴露会话级诊断缺口。
- 旧 Runtime Trace/AI Debug 不迁移、不兼容读取；升级后停止新写入并移除旧 parser/query/bridge 入口，既有存储内容不做破坏性删除。

## Acceptance Criteria

- [ ] 三类入口产生同一 schema 的全局记录，requestId 唯一且并发不覆盖。
- [ ] 成功、失败、取消、超时、HTTP/解析错误与每次重试均可重建。
- [ ] 多轮工具调用和委派可通过通用关系查询完整链。
- [ ] 本机记录不含凭据，但保留完整文本请求与响应。
- [ ] 四类未处理前端错误可写入；console 与 handled error 不写入。
- [ ] 7 天/100 MiB 自动清理和中断恢复有测试。
- [ ] Trace 持久化失败时原 AI 调用结果不变，健康状态报告丢失。
- [ ] 新调用不再产生 `.tsian/**/traces` 或 `AiDebugRecord` 写入。
- [ ] 旧诊断 parser/query/bridge 不再提供读取能力，统一查询不会混入旧数据。

## Out of Scope

- 系统监视器 UI、zip 导出和 workspace 投影。
- 迁移、展示或兼容读取旧 Trace 内容；确定性回放 provider。

## Dependencies

- 无前置子任务。其 schema 和查询服务是另外两个子任务的显式依赖。
