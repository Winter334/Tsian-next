# AI Trace 监视器与诊断包

## Goal

用清晰、可筛选的统一 AI Trace 替换当前 AI Debug 与按 Turn Runtime Trace，并从同一数据源导出可交付开发者的诊断包。

## Requirements

- 以时间倒序分页展示 AI 请求与通用前端错误，不依赖活动存档或 Turn。
- 支持时间、状态、provider/model 与文本过滤；展示请求、响应、工具、usage、耗时、attempt/error 和原始 JSON。
- Overview 的 token/cache/provider 统计改用统一 Trace。
- 显示成功、失败、重试、进行中/中断以及“诊断记录不完整”健康警告。
- 诊断包锚点优先使用选中失败记录，否则最新失败记录；向更早方向取 50 条，并补齐完整关联链。
- Zip 包含 manifest、摘要、复现步骤、平台/build、脱敏配置、index 与逐记录 JSON。
- 完整请求/响应默认包含；不提供对话开关或时间范围选项；导出再次移除凭据。
- 监视器和诊断包只查询新统一存储，不读取或混入旧 Runtime Trace / AI Debug。

## Acceptance Criteria

- [ ] 三类 AI 入口和前端错误出现在同一时间视图，过滤/分页不加载全部正文。
- [ ] 详情布局可读且原始结构可复制，不再依赖 JSONL 文本和 Turn 导航。
- [ ] Overview 统计与 Trace 查询来自同一权威表。
- [ ] 选中错误导出时包含 50 条向前记录与完整关系闭包，不含无关后续记录。
- [ ] Zip 结构稳定、复现步骤可填写、正文完整且无凭据。
- [ ] 没有失败锚点时 UI 给出明确不可导出状态，不生成含义不明的包。
- [ ] 旧 runtime-trace、runtime-diagnostics 与 ai-debug 查询不再被 UI 或导出调用。

## Out of Scope

- 自动上传/发送诊断包、云端工单、AI 自动复现或 provider 回放。
- 渠道过滤和“是否包含对话”选项。
- 旧 Runtime Trace / AI Debug 的兼容浏览或导出。

## Dependencies

- 必须等待 `07-30-unified-ai-trace-core` 完成并稳定记录、分页查询、关系闭包和健康状态契约。
