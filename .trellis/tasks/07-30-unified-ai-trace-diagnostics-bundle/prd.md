# 统一 AI Trace 与开发者诊断包

## Goal

把当前分散在正式回合、`invokeAgent`、桌面助手、AI Debug 和浏览器 console 中的 AI 调用诊断收敛为一个渠道无关的统一 Trace。Trace 只回答“平台向 AI 发出了什么请求、AI 如何响应、调用为何失败或性能异常”，并为开发者诊断包提供单一可信数据源。

用户价值：

- 玩家或测试者能在一个入口查看所有 AI 调用，不需要理解调用来自正式回合、旁路 Agent 还是桌面助手。
- 开发者收到诊断包后能还原请求生命周期、模型响应、重试与错误，而不必拼接多套日志。
- 新增 AI 调用入口时复用统一基础设施，不再新增渠道专属 Trace schema 或存储目录。

## Confirmed Facts

- 当前正式回合 Trace 写入 `.tsian/save/traces/turns/*.jsonl`；`invokeAgent` 写入 `.tsian/save/traces/agents/*.jsonl`；桌面助手写入 `.tsian/local/assistant/traces/*.jsonl`。
- 当前系统还存在独立的 `AiDebugRecord` 持久化与浏览器 console 重试日志，几套记录之间缺少稳定的统一请求关联标识。
- 系统监视器的“运行日志”只按活动存档的正式 turn 查询，不能完整显示 `invokeAgent` 与桌面助手调用。
- 桌面助手 Trace 路径未包含 `sessionId`，不同会话的相同 turn 可能覆盖；`invokeAgent` 诊断候选使用 `turn=0`，会被现有正数 turn 窗口排除。
- 平台入口 `main.ts` 当前未安装 Vue `errorHandler`、全局 `error` 或 `unhandledrejection` 持久化；可见卡前端检查器已有 bounded 的 window error、unhandled rejection、资源加载失败与 console 捕获逻辑，可作为通用错误归一化的实现参考。
- 桌面助手当前会在每轮开始时把活动卡/存档 workspace 与全部 `.tsian/local/assistant/` 文件合并成内存快照；若把最高 100 MiB 的 Trace 直接加入普通快照，每次助手调用都会承担全量加载成本。
- 现有 workspace volume 已支持 `platform-meta` 和桌面助手 level 4 读取，但全局本地 volume 只覆盖 `.tsian/local/assistant/` 与平台配置；统一诊断需要独立的全局平台元数据归属，不能落入具体 save 的 `.tsian/` volume。

## Requirements

### R1. 渠道无关的统一 AI Trace

- 正式回合、`invokeAgent`、桌面助手及未来 AI 入口必须通过同一 AI 调用基础设施写入统一 Trace 存储。
- Trace schema 不增加 `invokeAgent`、桌面助手或正式回合专属字段，也不为不同渠道建立独立诊断目录或查询协议。
- 每次 AI 请求必须有稳定唯一的 `requestId`；多轮工具调用或重试只使用通用父子/尝试关系，不使用渠道语义建立关联。

### R2. 只记录 AI 调用与通用诊断

- 核心记录范围聚焦于 AI 请求、响应和调用生命周期：provider、model、参数、请求消息、工具声明/调用、响应正文、finish reason、token/cache usage、耗时、重试尝试、HTTP/解析/超时/中止错误。
- AI 请求与响应正文在本机 Trace 中完整保存；不以预览或摘要替代正文。图片、附件等大体积二进制内容可保存可识别的元数据与内容引用，不要求在每条 Trace 中重复内联 Blob。
- API Key、Authorization、Cookie 等凭据必须在写入本机 Trace 前移除；诊断包导出时再次执行同一脱敏，形成双重保护。
- 不再把 Skill 加载、Agent Runtime step、workspace mutation、checkpoint、业务回合投影等渠道或业务事件作为统一 AI Trace 的核心事件。
- 通用前端错误只采集未捕获运行时异常、未处理 Promise rejection、Vue 全局组件异常和资源加载失败；使用固定通用结构，不按页面或渠道扩展字段。
- 普通 `console.log` / `console.warn` / `console.error` 以及已被业务代码捕获处理的错误不进入统一 Trace。

### R3. 单一查询与监视器入口

- 系统监视器按时间和 AI 请求浏览全部记录，不再以正式 `Turn N` 作为唯一导航维度。
- 用户可区分成功、失败、重试和进行中的请求，并查看一次请求的请求、响应、usage、耗时与错误详情。
- 支持按时间、状态、provider/model 搜索或过滤；原始结构化记录保留可复制入口。

### R4. 开发者诊断包

- 诊断包从统一 Trace 生成，不要求调用渠道额外拼装日志。
- 诊断包至少包含平台/build 信息、脱敏配置摘要、固定数量范围内的完整 AI 请求与响应、通用前端错误、诊断摘要和用户填写的复现步骤。
- 默认以用户选中的失败记录为锚点；未显式选择时使用最新失败记录。从倒序时间线中的锚点开始向更早记录收集 50 条普通记录，不再使用前后固定分钟窗口，也不额外收集锚点之后的记录。
- 锚点所属的完整父子调用、工具轮次与重试链必须整体导出，不因 50 条边界被截断；关联链超出普通条数时允许诊断包超过 50 条。
- 用户主动导出诊断包即视为同意将其中的对话、请求与响应正文交付给开发者；不再增加“是否包含对话内容”的二次选项。
- 导出仍必须自动移除 API Key、Authorization、Cookie 等凭据；对话内容本身不作为需要默认删除或截断的敏感项。

### R5. 生命周期与旧数据策略

- 统一 Trace 固定保留最近 7 天且总量最多 100 MiB；任一上限触发时从最旧记录开始清理。首版不提供用户配置项。
- 旧 Runtime Trace 与 AI Debug 数据不迁移、不展示，也不提供兼容读取或旧查询入口；升级后的所有诊断读取只访问统一存储。
- 既有旧 Trace 文件和 AI Debug 数据不主动执行破坏性删除，可作为未使用的遗留数据随原有 save/本地数据生命周期消失；新调用只能写入统一存储。
- Trace 写入失败不得影响 AI 主流程，但必须能够在监视器中暴露“诊断记录不完整”的状态。

### R6. 权威存储与 workspace 投影

- 统一 Trace 的权威数据存入全局专用 IndexedDB 表，不归属具体 save、Game Card、桌面助手会话或调用渠道。
- 桌面助手通过 `.tsian/local/diagnostics/` 只读虚拟 workspace 投影使用现有 `workspace_list`、`workspace_read`、`workspace_search` 读取诊断，不新增 Agent-facing 诊断工具。
- 虚拟投影至少提供轻量索引、按 requestId 分片的完整 AI 请求记录和按 errorId 分片的通用前端错误记录；投影不产生第二份持久化数据。
- Trace 记录由 AI 基础设施和全局前端错误收集器写入；即使桌面助手拥有 level 4，也不能修改或删除 `.tsian/local/diagnostics/`。助手读取诊断后可通过现有 workspace 工具修改实际故障目标。
- workspace 工具必须按需读取虚拟诊断文件；不得把最多 100 MiB 的全部 Trace 合并进每轮桌面助手内存快照。

## Acceptance Criteria

- [ ] AC1: 正式回合、`invokeAgent` 与桌面助手各发起一次 AI 调用后，都出现在同一按时间排序的 Trace 请求列表中。
- [ ] AC2: 三种入口产出的记录使用同一 schema；不存在入口专属必填字段或独立查询分支。
- [ ] AC3: 每条调用至少可查看 requestId、provider/model、开始/结束时间、耗时、状态、重试、完整文本请求与响应、finish reason、usage 和结构化错误（适用时）。
- [ ] AC4: Skill/workspace/checkpoint/业务回合事件不会作为独立记录混入统一 AI Trace。
- [ ] AC4a: 未捕获运行时异常、未处理 Promise rejection、Vue 全局组件异常和资源加载失败可进入通用错误列表；普通 console 输出和已处理错误不会被采集。
- [ ] AC5: 系统监视器可按时间、状态、provider/model 浏览和过滤，不依赖活动存档 turn 才能查看桌面助手调用。
- [ ] AC6: 多桌面助手会话、失败后重试和并发 `invokeAgent` 不会覆盖或错误合并记录。
- [ ] AC7: Trace 写入失败时 AI 调用仍按原行为完成或失败，监视器能显示诊断缺口。
- [ ] AC8: 导出的诊断包以选中失败记录或最新失败记录为锚点，按倒序时间线向更早记录收集 50 条普通记录且不额外收集锚点之后的记录，同时完整包含锚点的父子调用、工具轮次与重试链，即使因此超过 50 条；包内保留完整文本请求与响应、不含凭据，且不要求用户再次选择是否包含对话。
- [ ] AC9: 超过 7 天或总量超过 100 MiB 时，统一 Trace 从最旧记录开始清理；监视器不会因长期运行而无界加载。
- [ ] AC10: 桌面助手可用现有 workspace list/read/search 找到并读取 `.tsian/local/diagnostics/` 中的索引、完整 AI 请求和前端错误记录，无需新的诊断工具。
- [ ] AC11: 虚拟诊断文件为平台只写；桌面助手对该路径的 write/edit/delete 明确失败，但仍可修改卡、存档或前端中的实际问题文件。
- [ ] AC12: 未显式读取诊断文件时，桌面助手单轮不会加载全部保留期 Trace；虚拟投影与 IndexedDB 权威记录保持一致且无第二份持久化副本。
- [ ] AC13: 升级后旧 Runtime Trace 与 AI Debug 不出现在监视器、诊断包或 workspace 投影中，旧 parser/query API 不再作为可用读取入口。

## Out of Scope

- 把所有浏览器 console、业务日志或 workspace 文件收集进 Trace。
- 为正式回合、`invokeAgent`、桌面助手分别设计诊断字段、存储或 UI。
- 自动修复 Agent、Skill、workspace 或存档状态。
- 首版提供确定性 AI 回放或模拟 provider；诊断包先服务定位与人工复现。
- 迁移、展示、导出或兼容读取旧 Runtime Trace / AI Debug 数据。

## Delivery Map

- `07-30-unified-ai-trace-core`：统一 schema、全局 IndexedDB 存储、AI 基础设施采集、重试与通用前端错误；无前置子任务。
- `07-30-ai-trace-monitor-diagnostic-export`：系统监视器 Trace UI 与诊断包导出；依赖核心子任务提供稳定查询和记录契约。
- `07-30-diagnostics-workspace-projection`：`.tsian/local/diagnostics/` 只读虚拟投影；依赖核心子任务提供按 ID 查询和流式枚举接口。
- 父任务不直接承载产品代码，负责统一需求、跨子任务契约和最终集成验收。核心完成后，后两个子任务可并行实施。
