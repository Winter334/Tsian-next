# 卡内 Frontend Action 平台能力

## Goal

让游戏卡通过固定目录发布只供自身前端调用的确定性 Action，并由平台提供严格校验、前端权限、事务回滚、并发保护和生命周期管理，而不把该能力混入 Agent Tool、Skill 或平台硬编码 Action。

## Background

- Play Bridge 当前没有调用卡内脚本的语义 API；`platform.runAction` 是 host-owned closed dispatcher。
- 当前远程前端可触达 `platform.runAction`，其 `workspace.*` 分支可能使用本地助手 actor level，存在权限混淆，需要随本任务修复。
- 现有 browser-script runner、RuntimeWorkspaceTransaction 和 side-channel delta commit 提供可复用基础，但尚缺 Frontend Action Registry、严格 JSON/Schema 校验和 path-level read-set CAS。

## Requirements

### R1. 固定目录发布

- 只发现有效 Workspace 中精确匹配 `frontend-actions/<id>/action.json` 的资源。
- action id 使用小写 kebab-case，拒绝路径分隔、点段、空白和别名归一。
- 固定目录即发布，不读取 game-card manifest allowlist，不暴露 action 枚举给前端动态生成 UI。
- Frontend Action 不进入任何 Agent/Skill/Tool Registry、上下文、查询或 Studio 面板。
- `frontend-actions/**` 对 runtime game Agent 的 read/list/search/glob/contextPaths/macro expansion 完全不可见；desktop assistant/资源管理器仍可按卡内容文件管理。
- 专用 host loader 通过显式内部 capability 读取该目录，不能通过提高通用 actor level 绕过。

### R2. Action manifest

- manifest 版本化，并声明 inputSchema、outputSchema、browser_script executor path、可选 helpers 和 timeout。
- action id 来自目录，不在 manifest 重复声明。
- executor/helper/importScripts 只能解析到本 action 目录内。
- 仅支持 strict JSON 输入和输出；不允许 undefined、BigInt、函数、symbol、循环引用、NaN/Infinity 或非普通对象。
- 使用严格 Draft 2020-12 Schema 校验；首版 `$ref` 只能指向同一 schema document 内的 fragment，远程/异步 ref fail loud。
- 输入在 Worker 启动前校验，输出在提交前校验；Schema 无效或 `$ref` 越界/远程解析 fail loud。

### R3. SDK 与桥协议

- 新增 `tsian.card.runAction(actionId, input, { signal? })`，不暴露裸 RPC method。
- 增加远程桥 `card.runAction` 和取消语义；调用使用 `(sessionId, invocationId)` 唯一键，并把 mounted iframe 与预期 gameCardId 绑定。
- AbortSignal、iframe dispose 或 session replacement 能终止对应未提交 action，不能终止其他会话调用；durable commit 开始后的竞态按明确状态机处理。
- session replacement/dispose 必须拒绝旧 pending Promise，忽略 stale response/event，并清理所有 controller/listener。
- 统一结构化公开 runtime 错误码，错误信息不得向不可信 iframe 泄露 Worker 源码、内部路径外内容、任意 raw message 或敏感 stack。
- 卡脚本可通过专用 domain-error envelope 抛出业务错误；平台严格校验 `code/message/details` 后以 `kind:"domain"` 原样传递 code/details，非法 envelope 降级为 `FRONTEND_ACTION_EXECUTION_FAILED`。
- runtime/transport codes 与 card-defined domain codes 在 wire/SDK type 上可判别，平台不维护游戏业务 code allowlist。

### R4. 权限与安全

- Frontend Action 固定使用 frontend actor level 1 和专用 Workspace operation allowlist。
- 持久写入仅允许 save-runtime，不允许 card-content、card-frontend 或 `.tsian/**`。
- 不通过 `platform.runAction` 执行。
- remote generic `platform.runAction` 改用 host-enforced closed allowlist 和不可伪造的 `play-frontend` caller identity；不得只靠 `workspace.*` 前缀 denylist。
- play-frontend caller 永远不能触发本地助手 actor 解析，也不能从 params 注入 actor/scope/save/session 身份；未知或未来新增 platform action 默认拒绝。
- 增加回归测试枚举当前 platform actions，证明远程前端不能借 generic dispatcher 提权。
- browser-script 执行环境沿用现有 Worker 隔离；网络/随机/时间能力的首版策略必须在 design 中明确并写入安全文档。

### R5. 事务与并发

- Action invocation start 通过一个原子只读快照绑定 active save、save→card、mounted gameCardId、卡资源行和 save Workspace；执行期间不再读取 live Workspace。
- manifest、脚本、helpers 和业务 read/list/glob 都来自该 immutable snapshot；staged read 可看到本次写入，但并发 baseline 始终来自调用开始快照。
- 所有 Workspace mutation 进入 RuntimeWorkspaceTransaction；任何错误、取消、超时或校验失败均丢弃。
- 成功时只合并 action 实际改变的路径，byte-identical write 折叠为 no-op，保留无关并发修改。
- 提交时校验 active binding、Action 资源、所有 file/list/glob 读取、盲写目标和删除前缀依赖未变化；missing→created、结果集 membership 变化或 delete-prefix 新后代均冲突。
- read-only/no-op 也必须完成依赖验证，不能返回基于失效快照的成功结果。
- 提交与冲突检查在一个持久化事务中完成；相关冲突零写入、不重试，默认不创建检查点。

### R6. 通知

- durable commit 后发出 save-runtime mutation 通知，包含 invocationId、saveId、actionId 和排序后的实际变更路径，不携带文件内容。invocationId 是本次 commit correlation id；事件不承诺全局排序，订阅方以 authoritative reread 收敛。
- byte-identical/空 delta 不更新持久化记录也不发通知；失败、回滚、取消、超时或冲突同样不发通知。
- local event 在 transaction 返回后发出；session-owned remote event 在成功 response 前发送，只转发给当前绑定同一 save/card 的 mounted session，subscriber 异常不影响 commit。
- SDK/前端可以订阅或由语义调用方明确刷新；不能只触发 runtime.json 刷新而遗漏 entity/container/item。

### R7. 文档与测试

- 更新 Play Frontend API、SDK direction、Tool/Skill/Frontend Action 边界和 Trellis contract/frontend/storage specs。
- 增加可自动运行的测试 harness，覆盖 Registry、Schema、Worker、权限、rollback、CAS、abort、通知和远程权限回归。
- 运行 contracts、play-bridge、platform-web 构建。

## Acceptance Criteria

- [ ] 固定目录中的合法 Action 可通过 `tsian.card.runAction` 执行，其他路径或资源不可执行。
- [ ] Frontend Action 在 Agent/Skill/Tool indexes 和模型上下文中零可见，runtime Agent 也不能通过 Workspace 操作或 context macro 发现其文件；desktop assistant authoring 不受影响。
- [ ] 输入/输出和 manifest 严格校验，非法值在执行/提交前失败。
- [ ] save-runtime 多步写入成功时一次提交，任一失败时零写入。
- [ ] 无关路径并发修改被保留；active binding、Action 资源、读取/盲写/删除依赖变化返回 conflict，read-only/no-op 同样验证快照。
- [ ] 前端不能写卡内容、前端源码或 `.tsian/**`，也不能借 `platform.runAction` 提权。
- [ ] AbortSignal、timeout 和 iframe dispose 可终止且不提交。
- [ ] 默认不创建检查点，成功后仅发送路径级 mutation 通知。
- [ ] API/authoring/security 文档与 executable specs 完成。
- [ ] 自动测试及 `build:contracts`、play-bridge build、`build:web`、`git diff --check` 通过。

## Out of Scope

- 装备或其他游戏领域逻辑。
- Frontend Action 动态枚举 UI、Agent 调用、独立市场资源包或 Studio 编辑器。
- 将任意 Tool/Skill 标记后暴露给前端。
- 自动创建检查点或正式回合/history 语义。
