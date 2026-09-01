# Technical Design

## Resource Model

Frontend Action 是与 Tool/Skill 并列但完全隔离的卡资源：

```text
frontend-actions/<id>/
├── action.json
├── run.js
└── helpers/**
```

有效 Workspace 中精确的 `frontend-actions/<id>/action.json` 即发布源。卡包磁盘自然保存为 `workspace/frontend-actions/**`。不在 game-card manifest 增加字段，不构建对 Agent 可见的 Registry。

定义统一 `isFrontendActionPath(path)`：runtime game Agent 的 direct read/list/search/glob、effective Workspace projection、contextPaths、macro expansion、Agent/Skill/Tool queries 和模型上下文都必须过滤/拒绝该 namespace。desktop assistant 与资源管理器仍按普通 card-content 管理这些文件，符合 fileification 原则。专用 Frontend Action loader 使用显式内部 capability 从 bound-card content snapshot 读取，不能以更高 generic actor level 绕过过滤。

### Manifest v1

```ts
interface FrontendActionManifestV1 {
  schemaVersion: 1
  inputSchema: JsonSchema
  outputSchema: JsonSchema
  executor: {
    type: "browser_script"
    path: string
    timeoutMs?: number
    helpers?: string[]
  }
}
```

id 来自目录，严格匹配 `[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?`，不 trim/alias。manifest 拒绝 unknown fields；timeout default 10s、min 100ms、max 30s；helpers 最多 16 个。实现前以常量固定并测试下列 hard limits：manifest 64 KiB、单 schema 64 KiB/深度 64/节点 10k、input/output 各 1 MiB/深度 64/节点 100k、action source+helpers 合计 2 MiB、validation errors 最多 50、compiled validator LRU 最多 128 项。限制必须在昂贵 parse/compile/clone/Worker 启动前尽早执行。若现有 Workspace read/result 上限更小，沿用更小值。

## Strict JSON And Schema Validation

Action input/output 先做 recursive strict JSON 检查，再交给 JSON Schema validator。strict JSON 仅允许 null、boolean、string、finite number、dense array 和 `Object.prototype`/null-prototype 的普通 record；object 只能包含 own enumerable string-keyed data properties。拒绝 undefined、BigInt、函数、symbol、NaN/Infinity、循环引用、accessor、sparse array、symbol/non-enumerable property、Date/RegExp/Map/Set/typed array/Blob/class instance 等 exotic object。验证不得修改数据。

校验发生在所有 lossy boundary 前后：SDK 在 postMessage 前校验输入；host 对 direct protocol caller 再校验；Worker 在任何 loose normalization/postMessage 前校验 raw output；host 对 cloned output 再校验。Frontend Action strict mode 不调用现有宽松 `toJsonValue`。

Schema 采用 Ajv 8 Draft 2020-12：`strict: true`、`allErrors: true`、`validateFormats: false`，禁用 coerce/default/removeAdditional，不注册 custom keyword/format，不配置异步 `loadSchema`。首版只允许本 schema document 内的 JSON Pointer `$ref`（`#` / `#/...`）；拒绝 `$async`、`$id`、`$anchor`、`$dynamicAnchor`、`$dynamicRef`、非 fragment URI 和不受支持 vocabulary。manifest 必须声明/隐含唯一支持的 2020-12 dialect，unknown keyword 在 strict compile 阶段失败。

Ajv runtime compilation 依赖动态代码生成。实现 gate 必须在实际 production build/CSP 下验证；如果 CSP 不允许，改用 CSP-compatible validator 或重新设计，而不是退回当前浅层 validator。validator 缓存 key 绑定 action manifest 内容身份。

## Bridge And SDK

共享 contracts 增加 request/result/error/mutation 类型和远程方法：

```ts
card.runAction({ invocationId, actionId, input })
card.abortAction({ invocationId })
```

SDK 暴露：

```ts
tsian.card.runAction(actionId, input, { signal? }): Promise<JsonValue>
tsian.onWorkspaceMutation(callback): () => void
```

SDK 生成 invocationId；AbortSignal 触发 abort RPC。remote bridge 为每个 iframe session 维护 `invocationId -> AbortController`，销毁/换 session 时全部取消。Host/remote response 始终 JSON-safe，内部 stack 和脚本内容不外泄。

## Registry And Snapshot Binding

新增 pure manifest parser/registry resolver，但 invocation snapshot 由 storage helper 原子加载：

1. 在 snapshot 前完成既有 Workspace initialization/upgrade。
2. 在一个 Dexie readonly transaction 读取 active-save meta、save row、bound card row、gameCardContentFiles、必要的 gameCardFrontendFiles 和 save workspaceFiles。
3. 验证 mounted iframe 预期 gameCardId === active save.gameCardId；保留每个 effective file 的 provenance，Action manifest/script/helper 必须来自 bound card content，不能仅信任 flattened overlay winner。
4. 只接受 exact `frontend-actions/<id>/action.json`，验证 id、JSON、version、schemas、executor 和 root-confined static paths。
5. 对 manifest、run.js、helpers/importScripts 记录 exact row/content signatures；全部执行 read 都只访问 immutable snapshot + staged overlay，不再读取 live DB。

不增加 action enumeration RPC。前端调用已知 action id，缺失 fail loud。

## Executor

把 browser-script runner 的 owner 抽象从 Skill/Tool 扩展为：

```ts
type BrowserScriptOwner =
  | { type: "skill"; rootDirectory: string }
  | { type: "tool"; rootDirectory: string }
  | { type: "frontend-action"; rootDirectory: string }
```

Frontend Action 使用独立 execution context：

- actorLevel 固定 1；
- operation allowlist 首版限制为业务 Action 所需的 `read/list/glob/write/delete`，并显式禁用 `reply.project` 等所有非 Workspace SDK capability；
- read/list/glob 只返回 strict-JSON text metadata/result，不把 Blob/binary 直接传入 Worker；binary path fail loud；
- write/delete 必须显式/归一到 ordinary `save-runtime`，拒绝 temp、card-content、card-frontend、platform-meta 和 `.tsian/**`；
- persistent mutation 仍由 RuntimeWorkspaceTransaction staging；
- timeout/abort/worker cleanup 复用 runner；
- action output 采用 strict JSON 模式，不能沿用把 unsupported/circular 值转字符串/null 的宽松输出归一。

首版不宣称平台提供 deterministic sandbox。Worker 的网络/时间/随机/计时器/代码生成能力沿用当前 browser-script 威胁模型；卡前端本身已能读取 Workspace 并访问网络。确定性由具体 Action 代码和测试保证。文档必须明确这一点。

Frontend Action 脚本内的 `importScripts` 路径继续由现有 Worker 协议支持，但 host 用 `@babel/parser` 在启动前只接受全部参数均为 static string literal 的调用，解析为同一 action 根目录内已声明 helper；dynamic/mixed call 整体拒绝，运行中不能按任意 URL 或 Workspace 路径动态取脚本。

## Transaction And Read Set

扩展 action execution adapter 记录实际读取依赖：

```ts
type RuntimeWorkspaceReadDependency =
  | { kind: "file"; scope; path; observed: "missing" | "present"; signature? }
  | { kind: "list"; scope; path; recursive; entriesSignature }
  | { kind: "glob"; scope; pattern; limit; truncated; matchesSignature }
  | { kind: "write-baseline"; scope: "save-runtime"; path; observed; signature? }
  | { kind: "delete-range"; scope: "save-runtime"; prefix; descendantsSignature }
```

read/list/glob 的 normalized input、ordering、limit/truncation 与 observable result 用稳定签名记录；missing file 也是依赖。每个 blind write 自动记录原 target baseline，每个 delete 记录原 descendant range。effective scope 在 commit 时以相同 overlay/provenance 规则重放。Action 读取使用 invocation-start 的 immutable snapshot；自身 staged write 后再 read 时，由 transaction overlay 返回 read-your-writes，但 optimistic dependency 始终指向最初持久化 snapshot，不能用 staged 内容覆盖 baseline signature。

新增 no-checkpoint optimistic commit helper：

1. 规范化 actual written paths/concrete deleted paths/read dependencies；byte-identical write 折叠，write/delete 以 final overlay state 互斥。
2. 在包含 meta、saves、workspaceFiles、gameCards、gameCardContentFiles 和必要 frontend rows 的同一个 Dexie read-write transaction 中，验证 active save、save→card、mounted gameCardId 和 session binding。
3. 按 exact rows/results 重放 Action resource、file/list/glob、blind-write baseline 和 delete-range；相关变化 -> conflict，零写入、不重试。新 descendant、missing→created 和 list/glob membership 变化都冲突。
4. 即使 read-only/empty delta 也完成 2–3，避免返回失效快照结果。
5. 非空 delta 只应用 action actual changes，保留无关并发路径并更新 save.updatedAt，不创建 checkpoint。
6. 空 delta 成功但不写 DB、不更新 timestamp、不发 event。

若 transaction 已写入后续输出校验失败，根本不会调用 commit；staged state 直接 discard。

## Mutation Event

commit 成功后发送：

```ts
interface RuntimeWorkspaceMutationEvent {
  invocationId: string
  saveId: string
  source: "frontend-action"
  actionId: string
  writtenPaths: string[]
  deletedPaths: string[]
}
```

只发送路径：writtenPaths 是实际内容变化，deletedPaths 是实际被删除的具体文件，不是请求 prefix；两者稳定排序。invocationId 用于关联本次 commit，不增加 DB field/table，也不承诺跨调用全局排序。Host local event 在 transaction 完成后发出；session-owned remote event 仅发给仍绑定同一 save/card 的 mount，并在成功 response 前投递。空 delta 不发 event。subscriber 异常隔离，不能改变 commit/Promise 结果。调用方以 authoritative reread 收敛状态。

## Invocation Lifecycle And Public Errors

每个 mount 以 `(sessionId, invocationId)` 保存 controller，状态为 `accepted → running → committing → committed/completed`，或在 commit 前终止为 `aborted | timed-out | conflicted | failed`：

- pre-aborted signal 不发 run request；duplicate active id 拒绝；unknown/completed abort 幂等成功。
- abort 在 committing 前被观察到则禁止 commit；durable transaction 一旦成功，success + mutation event 胜出，late abort 不能回溯成失败。
- dispose/session replacement abort 当前 session 全部 running invocation、拒绝全部旧 pending Promise、移除 listener/controller，忽略 stale response/event。
- SDK 只接受 `window.parent` 消息，并在 ready 后固定可验证的 parent origin/session；每个 terminal path 清理 pending。

SDK Promise 失败统一抛 `FrontendActionError`，wire/SDK error 是 discriminated union：

```ts
type FrontendActionPublicError =
  | { kind: "runtime"; code: FrontendActionRuntimeErrorCode; message: string; details?: JsonValue; correlationId?: string }
  | { kind: "domain"; code: string; message: string; details?: JsonValue; correlationId?: string }
```

稳定 runtime codes 至少包括 `FRONTEND_ACTION_NOT_FOUND`、`FRONTEND_ACTION_MANIFEST_INVALID`、`FRONTEND_ACTION_INPUT_INVALID`、`FRONTEND_ACTION_OUTPUT_INVALID`、`FRONTEND_ACTION_TIMEOUT`、`FRONTEND_ACTION_ABORTED`、`FRONTEND_ACTION_WORKSPACE_CONFLICT`、`FRONTEND_ACTION_EXECUTION_FAILED`、`FRONTEND_ACTION_SESSION_REPLACED`。AbortSignal 映射为 runtime typed error，`kind+code` 是判据。

卡脚本用 Worker SDK `tsian.action.fail({ code, message, details? })`（或同等 dedicated envelope）发出 domain error。host 只接受：code 匹配 `[A-Z][A-Z0-9_]{0,63}`、message 非空且 ≤500 chars、details 通过 strict JSON 且 ≤64 KiB/深度 16；envelope 不能携带 stack/path/source。校验通过后保持 card code/details 并标记 `kind:"domain"`，平台不维护业务 code allowlist；非法 envelope 或普通 throw 统一投影为 runtime `FRONTEND_ACTION_EXECUTION_FAILED`。所有 runtime message/details 经过 allowlisted projection；raw thrown message、stack、source/helper path、schema compiler internals 和 Workspace content 只进 host diagnostics。

## Platform Action Privilege Fix

remote iframe 的 `platform.runAction` 使用 closed `REMOTE_PLATFORM_ACTION_ALLOWLIST` 和 host-internal caller=`play-frontend`。caller policy 在 `executePlatformAction` 内再次执行，不仅在 bridge normalize；unknown/future action 默认拒绝，play frontend 永远不能进入 `resolveLocalAssistantActorLevel()`。首版保留现有游玩前端实际需要的 `reply-project` 与 checkpoint semantic actions，但逐项审计后显式列出；workspace family 永不允许。request params 中 actorLevel/scope/saveId/sessionId/caller 等身份字段不参与授权。增加表驱动测试枚举当前所有 platform actions，证明 remote caller 只能调用 allowlist，desktop assistant trusted path 保持原行为。

## Validation Infrastructure

引入 root Vitest project、fake-indexeddb 和 DOM test environment，覆盖 platform-web 与 play-bridge；Ajv 是 platform-web runtime dependency。Worker tests 注入 Worker factory，避免依赖 DOM emulator 的不完整 Worker。测试 pure registry/schema/JSON helper、executor adapter、atomic snapshot/CAS、SDK pending/session state、remote normalization/abort、Agent filesystem isolation 和 privilege regression。

CSP gate 不是普通 build：使用 production bundle 在带目标 CSP headers 的 production-like origin 启动，分别运行代表性 Ajv compile/validate 与真实 browser-script Worker；记录所需 `script-src`、`worker-src`、Blob/module Worker directive，并在支持浏览器验证。若 `unsafe-eval`/dynamic compilation 不允许，预先选择 CSP-compatible schema interpreter，并单独重构 browser-script loading；把 Ajv 移进 Worker不算解决方案。gate 未通过不得暴露 RPC。

## Compatibility

- 新 RPC method 是协议扩展，不修改现有 method 语义。
- Skill/Tool runner 通过 owner-neutral refactor 保持行为与错误契约。
- Frontend Action 缺失不影响现有卡。
- rollback 可移除新增 card namespace method/registry/service，不触碰现有 Agent runtime。
