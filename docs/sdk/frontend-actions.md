# Frontend Actions

Frontend Action 是游戏卡拥有、只供该卡游玩前端调用的受约束卡内业务入口。它把严格 JSON 输入交给卡内 Worker 脚本，并在严格输出校验、权限检查和 read-set CAS 全部成功后，原子提交本次调用实际产生的 `save-runtime` 变更。

Frontend Action 不是 Tool、Skill 或 platform action：

- 调用入口是 `tsian.card.runAction(...)`，不是 generic `tsian.runAction` / `platform.runAction`。
- 它不进入 Agent、Skill、Tool Registry、查询结果、Studio 能力面或模型上下文。
- `frontend-actions/**` 对 runtime game Agent 的 read/list/search/glob、`contextPaths` 和宏展开不可见。
- 桌面助手和资源管理器仍可将这些文件作为卡内容创作、编辑和分发。

## 1. 发布目录

固定目录即发布，不在 `game-card.json` 增加 allowlist，也没有 Action 枚举 RPC：

```text
frontend-actions/<id>/
├── action.json
├── run.js
└── helpers/
    └── normalize.js
```

只有精确匹配 `frontend-actions/<id>/action.json` 的卡内容资源会发布。`id` 来自目录，必须匹配：

```text
[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?
```

因此 id 为 1–64 个字符，只用小写字母、数字和内部连字符；平台不 trim、不做大小写或别名归一。路径分隔、点段、首尾空白等均无效。前端应调用自己与卡约定好的 id，不能依赖动态枚举来生成 UI。

## 2. Manifest v1

`action.json` 是 strict JSON，顶层和 `executor` 都是 closed object，未知字段会使 manifest 无效。action id 不在 manifest 重复声明。

```json
{
  "schemaVersion": 1,
  "inputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "choiceId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 64
      }
    },
    "required": ["choiceId"],
    "additionalProperties": false
  },
  "outputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "applied": { "type": "boolean" }
    },
    "required": ["applied"],
    "additionalProperties": false
  },
  "executor": {
    "type": "browser_script",
    "path": "run.js",
    "timeoutMs": 10000,
    "helpers": ["helpers/normalize.js"]
  }
}
```

字段契约：

```ts
interface FrontendActionManifestV1 {
  schemaVersion: 1
  inputSchema: JsonValue
  outputSchema: JsonValue
  executor: {
    type: "browser_script"
    path: string
    timeoutMs?: number
    helpers?: string[]
  }
}
```

- `executor.path`、`helpers` 以及静态 `importScripts(...)` 只能解析到当前 Action 目录内。
- helper 路径必须唯一；executor、manifest 与 helper 不能相互冒充或重复。
- executor/helper 都必须是文本资源。
- `importScripts(...)` 只允许静态字符串字面量，并且引用已声明、位于当前 Action 根内的 helper；动态参数、混合参数、URL 或越界路径 fail loud。

### Hard limits

| 对象 | 限制 |
|---|---|
| action id | 1–64 字符，匹配上面的 kebab-case pattern |
| manifest | 64 KiB UTF-8 |
| 单个 input/output schema | 64 KiB、深度 64、10,000 nodes |
| input/output strict JSON | 各 1 MiB、深度 64、100,000 nodes |
| executor + helpers | 合计 2 MiB UTF-8 |
| helpers | 最多 16 个 |
| timeout | 默认 10,000 ms；最小 100 ms；最大 30,000 ms |
| validation errors | 最多公开/归一 50 条，其余标记 truncated |
| compiled validator cache | LRU 最多 128 项，以 schema 内容身份为 key |

若底层 workspace 操作已有更小的返回限制，仍以更小限制为准。

## 3. Strict JSON

Action 输入、输出、manifest/schema 和 domain error details 都不能依赖 JSON.stringify 的丢失式转换。strict JSON 只允许：

- `null`、boolean、string、finite number；
- dense array，且原型为 `Array.prototype`，没有自定义、symbol、accessor 或 non-enumerable element；
- 原型为 `Object.prototype` 或 `null` 的普通 record，只含 own enumerable string-keyed data properties。

拒绝 `undefined`、BigInt、function、symbol、`NaN`、`Infinity`、循环引用、稀疏数组、accessor、symbol/non-enumerable property、Date、RegExp、Map、Set、typed array、Blob、class instance 等 exotic object。校验不能调用 getter，也不能修改输入。

校验覆盖所有可能发生 lossy conversion 的边界：

1. play SDK 在 `postMessage` 前检查输入；
2. host 对 direct protocol caller 再检查输入并验证 `inputSchema`，然后才启动 Worker；
3. Worker 在宽松归一或 postMessage 前检查 raw output；
4. host 对 cloned output 再检查 strict JSON 和 `outputSchema`，然后才允许 commit。

## 4. JSON Schema 2020-12 子集

平台使用 Ajv 8 Draft 2020-12：`strict: true`、`allErrors: true`、`validateFormats: false`，并关闭 coercion、default 注入、`removeAdditional`、`$data`。Action schema 不注册 custom keyword 或 format。

支持普通 Draft 2020-12 validation/applicator keyword；以下边界必须遵守：

- `$schema` 省略时按 2020-12 处理；存在时只能是 `https://json-schema.org/draft/2020-12/schema`。
- `$ref` 只允许同一 schema document 内的 `#` 或 `#/...` JSON Pointer，且必须在 compile 前可解析。
- 不支持远程/相对 URI ref、异步 schema loading、`$async`、`$id`、`$anchor`、`$dynamicAnchor`、`$dynamicRef`、`$recursiveAnchor`、`$recursiveRef` 或 `$vocabulary`。
- strict compile 遇到 unknown keyword、错误 schema position 或其他无效结构时 fail loud；不会退回浅层验证。
- `format` 不执行语义验证；需要格式约束时用明确的 `pattern`、长度或枚举。

Ajv 的 runtime compilation 和 browser-script runner 依赖动态代码能力；Frontend Action 的 opaque-origin Worker 使用 `data:` URL。`platform-server` 不对 platform-web 下发 CSP；部署方若自行添加 CSP，需要确保它兼容这些运行时能力。每次真实 Action 调用在读取 snapshot、解析 schema 或启动 Action Worker 前，都会等待一个进程内 singleton runtime gate：它通过实际 `compileFrontendActionSchema` / `validateFrontendActionData` 编译并验证代表性 Draft 2020-12 schema，再通过实际默认 Worker factory 执行隔离探针。gate 的成功和失败都会缓存；失败时 RPC fail closed，不会改用模拟 Worker 或浅层 validator。发布前还必须运行 `npm run test:frontend-actions:production-browser`，用 production Vite bundle 和真实 Chrome/Edge 执行同一 gate。

## 5. Action 脚本

脚本接收 `input`、`tsian` 和 cooperative `signal`，返回 strict JSON：

```js
const current = await tsian.workspace.read({
  scope: "save-runtime",
  path: "save/card-state.json",
})

const state = current ? JSON.parse(current.content) : { choices: [] }
if (state.choices.includes(input.choiceId)) {
  tsian.action.fail({
    code: "CHOICE_ALREADY_APPLIED",
    message: "This choice was already applied.",
    details: { choiceId: input.choiceId },
  })
}

signal.throwIfAborted()
state.choices.push(input.choiceId)
await tsian.workspace.write({
  scope: "save-runtime",
  path: "save/card-state.json",
  content: JSON.stringify(state),
})

return { applied: true }
```

Authoring guidance：

- 用 manifest schema 表达完整输入/输出边界；object schema 通常应显式写 `required` 和 `additionalProperties: false`。
- 所有业务读写都通过 Action 的 `tsian.workspace` adapter；不要从 live storage 或 generic platform action 旁路。
- 只写普通 `save-runtime` 路径。card-content、card-frontend、temp、platform-meta 和 `.tsian/**` mutation 都会被拒绝。
- `read/list/glob` 读取 invocation-start snapshot 加本次 staged overlay；脚本可 read-your-writes，但不能观察执行中发生的 live DB 变化。
- 需要取消友好时，在长步骤之间调用 `signal.throwIfAborted()`；host 仍会在超时/abort 时终止 Worker 并丢弃 staging。
- 业务可预期失败使用 `tsian.action.fail({ code, message, details? })`，不要依赖普通 throw 的 message 穿过不可信边界。
- 返回值必须直接是 strict JSON；不要返回 `undefined`、class instance、Blob、Date 或循环对象。

### Worker 能力边界

Frontend Action 在 opaque-origin `data:` Worker 中执行，并只通过 host-mediated Workspace adapter 访问持久数据。opaque origin 是阻止 Action 接触平台 origin IndexedDB/Cache Storage 的主要边界；Worker 启动时还会移除/固定 `globalThis.indexedDB`、`globalThis.caches`、`globalThis.Worker`、`globalThis.SharedWorker` 以及 `navigator.storage` / `navigator.serviceWorker`，并在接受 execute 前自检这些能力确实不可用。参数 shadowing 只作为额外防御，不是边界本身。这样 Action 不能用平台 origin 的 ambient storage 或 nested Worker 绕过 staged Workspace/CAS。

该设计仍然不是 deterministic、secure 或 capability-secure sandbox：

- 原生网络 `fetch` 当前可用；不能宣称网络隔离。
- `Date`/时钟、timers 和 `Math.random` 未虚拟化；同样输入不保证仅因平台而可重放。
- runner 使用动态函数构造来执行脚本；不能宣称禁止 eval/code generation。部署方自行添加 CSP 时必须保留该能力。
- opaque origin 和 ambient-global taming 针对平台 origin storage/nested Worker bypass，不是对 JavaScript reflection、浏览器实现或所有未来 Web API 的完整 capability-security 证明。

具体 Action 若要求确定性或更强的网络/能力约束，必须使用额外的专用执行环境和测试；平台不提供这些声明。

## 6. SDK 调用

```ts
import {
  createTsian,
  FrontendActionError,
} from "@tsian/play-bridge"
import type {
  FrontendActionOptions,
  FrontendActionPublicError,
  FrontendActionRuntimeErrorCode,
  JsonValue,
  RuntimeWorkspaceMutationEvent,
} from "@tsian/play-bridge"

const tsian = createTsian()
await tsian.waitForReady()

const controller = new AbortController()
try {
  const output = await tsian.card.runAction(
    "apply-choice",
    { choiceId: "north-gate" },
    { signal: controller.signal },
  )
  console.log(output)
} catch (error) {
  if (error instanceof FrontendActionError) {
    if (error.kind === "domain") showBusinessMessage(error.code, error.message)
    else showRuntimeFailure(error.code)
  }
}
```

签名：

```ts
interface FrontendActionOptions {
  signal?: AbortSignal
}

tsian.card.runAction(
  actionId: string,
  input: JsonValue,
  options?: FrontendActionOptions,
): Promise<JsonValue>
```

SDK 为每次调用生成 `invocationId`。pre-aborted signal 不发送 run 或 abort RPC；活动调用 abort 时 SDK 发送专用 `card.abortAction`。不要手写 bridge method，也不要调用 generic `platform.runAction` 来执行卡 Action。

## 7. 错误

所有失败都抛 `FrontendActionError`。`kind` 是业务错误与平台/runtime 错误的判别字段：

```ts
type FrontendActionPublicError =
  | {
      kind: "runtime"
      code: FrontendActionRuntimeErrorCode
      message: string
      details?: JsonValue
      correlationId?: string
    }
  | {
      kind: "domain"
      code: string
      message: string
      details?: JsonValue
      correlationId?: string
    }
```

稳定 runtime codes：

- `FRONTEND_ACTION_NOT_FOUND`
- `FRONTEND_ACTION_MANIFEST_INVALID`
- `FRONTEND_ACTION_INPUT_INVALID`
- `FRONTEND_ACTION_OUTPUT_INVALID`
- `FRONTEND_ACTION_TIMEOUT`
- `FRONTEND_ACTION_ABORTED`
- `FRONTEND_ACTION_WORKSPACE_CONFLICT`
- `FRONTEND_ACTION_EXECUTION_FAILED`
- `FRONTEND_ACTION_SESSION_REPLACED`

判断错误应使用 `error.kind + error.code`，不要解析 message。

合法 domain envelope 必须：

- 只含 `code`、`message`、可选 `details`；
- `code` 匹配 `[A-Z][A-Z0-9_]{0,63}`；
- `message` 非空且不超过 500 字符；
- `details` 是 strict JSON，不超过 64 KiB、深度 16；
- 不携带 stack、source 或 path。

平台不维护 card-defined domain code allowlist；合法 code/details 保持为 `kind: "domain"`。非法 envelope、普通 throw、非法 transport error 都投影为 sanitized `kind: "runtime", code: "FRONTEND_ACTION_EXECUTION_FAILED"`。Worker 源码、内部路径、raw message、schema compiler internals、Workspace 内容和 stack 不会传给不可信 iframe。

## 8. Abort、session 与 late commit

每次 mounted session 以 `(sessionId, invocationId)` 隔离调用：

- abort 在 durable commit barrier 前被观察到：终止执行、丢弃 staging、返回 `FRONTEND_ACTION_ABORTED`，不发 mutation event。
- commit transaction 已 durable 后才到达的 late abort：commit/success 胜出；已提交数据不会被回滚成失败。
- iframe dispose 或 session replacement：取消该旧 session 的未提交 Action，拒绝旧 pending Promise，清理 listener/controller，并忽略 stale response/event；不会取消其他 session 的调用。
- completed/unknown invocation 的 abort 是幂等操作。

## 9. Snapshot、CAS 与提交

调用开始时，平台在一个原子只读快照中绑定 active save、save→card、mounted gameCardId、卡资源行和 save workspace。manifest、executor、helpers/importScripts 及业务 read/list/glob 都只读该 immutable snapshot；staged mutation 在内存 overlay 中提供 read-your-writes。

成功提交前，平台在一个持久化事务内重放并比较：

- active save、bound card、mounted session/card binding；
- manifest、executor、helpers/importScripts 的精确 card-content 资源签名；
- file read（包括 missing）、list result、glob result/limit/truncated；
- 每个 blind write 的 invocation-start target baseline；
- 每个 delete prefix 的完整 descendant range。

任何相关变化（包括 missing→created、list/glob membership 变化、delete prefix 新后代）都返回 `FRONTEND_ACTION_WORKSPACE_CONFLICT`，零写入且不自动重试。read-only 和最终 no-op 调用也必须完成依赖验证，不能返回基于失效快照的成功结果。

成功时只合并 Action 实际改变的路径，并保留无关并发修改。byte-identical write 折叠为 no-op；删除事件记录实际删除的具体文件，而不是请求的 prefix。默认不创建 checkpoint，也不写新的隐藏 DB 配置。

`tsian.workspace.write(...)` 仍是现有、独立的立即写入 API。它不自动加入 Frontend Action staging，也不继承 Action 的 all-or-nothing、CAS 或 no-checkpoint transaction；需要这些语义时应在 `tsian.card.runAction(...)` 内完成整组 mutation。

## 10. Mutation subscription 与 authoritative reread

非空 durable commit 后，平台发送一个 path-only event：

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

```ts
const off = tsian.onWorkspaceMutation((event) => {
  if (event.actionId !== "apply-choice") return
  // Event 只说明哪些实际路径变了；按自己的数据依赖重新读取。
  void reloadCardState()
})
```

- 两个路径数组稳定排序，只含实际变化路径，不含文件内容。
- byte-identical/空 delta、失败、回滚、取消、超时和冲突都不发 event。
- local event 在 transaction 返回后发送；当前 session 的 remote event 在成功 response 前发送。
- subscriber 抛错不影响已完成的 commit 或调用 Promise。
- `invocationId` 只用于关联这次 commit，不保证跨调用全局顺序。

Event 不是数据真相，也不能只刷新一个约定文件。订阅方必须按自身依赖 authoritative reread 所有相关 entity/container/item/state 文件，以应对事件重排、丢失、并发调用或未来恢复流程。

## 11. Generic platform action 边界

`platform.runAction` 仍是 host-owned generic dispatcher，不执行 Frontend Action。remote play frontend 的 caller identity 由 host 固定为 `play-frontend`，只允许 closed allowlist：

- `reply-project`
- `restore-checkpoint`
- `create-checkpoint`
- `update-checkpoint`
- `overwrite-checkpoint`
- `delete-checkpoint`

所有 workspace-family、未知或未来新增 platform action 默认拒绝。request params 中的 actor level、scope、save/card/session id 或 caller 字段不参与授权，也不能让 play frontend 进入桌面助手 actor 解析。需要卡内业务动作时始终使用 `tsian.card.runAction`。
