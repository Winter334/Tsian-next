# 异步图片存档一致性

## Goal

在不阻塞 Composer、不串行化图片生成网络阶段的前提下，保证正式回合、旁路 `invokeAgent` 图片生成/重生成、checkpoint 与 restore 对同一存档形成可线性化的一致结果：不同图片路径可安全合并，同一路径不允许静默覆盖，迟到的废弃分支结果零落盘，任一 checkpoint 恢复到的图片版本都与该分支一致。

本任务只负责 `apps/platform-web` 的 Runtime Workspace、Dexie 提交、checkpoint/restore、Blob GC、旁路 trace 与 `contextSlot` 一致性；不实现 Provider、设置 UI、卡内 Prompt/Agent 或图片展示。卡包 `exportGameCardPackage` 的 UTF-8 ZIP-entry inventory size 修复、ASCII/中文/emoji/binary 回归与 repack 依赖归 UI/repack tooling sibling；即使同样修改 `apps/platform-web`，也不属于本任务的 save-runtime revision/CAS 语义。

## Background and Source Evidence

- 正式回合从启动时 workspace 快照创建 `RuntimeWorkspaceTransaction`，成功后却把 `finalWorkspaceFiles()` 交给 `commitSuccessfulRuntimeTurnForSave`：`apps/platform-web/src/platform-host/runtime-turn.ts:73-100`、`apps/platform-web/src/platform-host/runtime-turn.ts:323-370`。
- `commitSuccessfulRuntimeTurnForSave` 当前从该快照预建 checkpoint，事务内删除并重写整个 `workspaceFiles` 表；正式回合运行期间已由旁路提交的图片因此可能被删除：`apps/platform-web/src/storage/saves.ts:129-193`。
- 普通 `invokeAgent` 已提交 `finalWorkspaceChanges()`，但增量写没有 touched-path CAS；目录删除会在提交时按前缀匹配当前行，可能删除事务启动后新增的后代：`apps/platform-web/src/platform-host/ai-invocation.ts:471-496`、`apps/platform-web/src/storage/saves.ts:232-347`。
- `current-turn-auto` 使用 invocation 启动时的 `invokeMaxTurn`，提交时却从当时的整个 current workspace 构建 manifest；期间若已推进未来回合，会把未来状态写进旧 turn checkpoint：`apps/platform-web/src/platform-host/ai-invocation.ts:242-245`、`apps/platform-web/src/platform-host/ai-invocation.ts:486-491`、`apps/platform-web/src/storage/saves.ts:430-571`。
- checkpoint 是内容寻址 thin manifest；SHA-256 目前在事务外计算，Blob GC 只扫描 remaining manifests：`apps/platform-web/src/storage/checkpoints.ts:145-224`、`apps/platform-web/src/storage/checkpoints.ts:448-513`、`apps/platform-web/src/storage/blobs.ts:11-73`。
- restore 在事务外预取 Blob，事务内替换状态文件、裁剪未来 turn/trace 和 checkpoint；它尚未与迟到媒体提交共享 per-save 生命周期互斥：`apps/platform-web/src/storage/checkpoints.ts:352-440`。
- 旁路 queue 使用原始 `contextSlot`，context 文件路径另行做有损替换；不同输入可映射到同一文件却使用不同 queue key：`apps/platform-web/src/platform-host/ai-invocation.ts:203-218`、`apps/platform-web/src/agent-runtime/context-lifecycle.ts:32-40`。
- 旁路 trace 只由 Agent id 与毫秒时间戳命名，同 Agent 同毫秒 invocation 可碰撞：`apps/platform-web/src/agent-runtime/trace.ts:171-179`。
- sibling `07-21-platform-image-generation` 已冻结 `InvokeAgentRequest` / play-bridge options 的 optional `generatedMediaSourceGuard`、remote strict normalization、invokeAgent host `requiredSourceGuard` closure、Tool-level optional `sourceGuard`、guarded canonical identity/path、唯一 `@tsian/play-bridge` runtime helper，以及 guarded host handoff `{ identityKey, assetPath, blob, sourceGuard }`。required option 存在时，Tool 漏 guard/mismatch/错 assetId 在 Provider 前 fail且不能 ordinary downgrade；本任务只接收已经通过该 authority gate 的 handoff，在 card-agnostic source-registration seam 中把 guard 转成 storage-facing exact-source CAS metadata。

## Frozen Runtime Semantics

- 图片生成是旁路能力，网络调用期间 Composer 保持可用；不同 canonical `contextSlot` 的最多三张图片可自然并行。
- 不新增全局队列、取消系统、持久化 job 表、跨重载任务恢复或通用 job framework。允许复用既有 same-slot invocation queue，并仅在线性化短暂持久化/restore 临界区时使用 per-save lifecycle serialization。
- 图片属于 save-runtime 并随 checkpoint 回溯。
- 同一稳定路径重生成成功后，workspace 与所有适用 retained checkpoints 都切换到新 Blob；旧版本无引用后删除。重生成失败或冲突时旧图保持不变。
- restore 到来源 turn 之前（即来源已从当前分支裁剪）后，迟到结果必须作为 stale 丢弃且零持久化写入。
- `completed` 事件只能在所需 workspace、checkpoint 与 Blob 写入 durable 后发送。

## Requirements

### R1. Explicit changes and touched-path CAS

- `RuntimeWorkspaceTransaction` 必须为第一次触及的 save-runtime 路径保留 transient baseline expectation；`finalWorkspaceChanges()` 输出显式 write/delete、对应 expected state，以及目录删除所需的 baseline membership。此信息只服务 commit CAS，不新增 Dexie 审计列或无消费者持久化字段。
- 所有正式回合与旁路提交只应用自身 explicit changes；提交时未触及路径必须保留 current DB 值。
- write/delete 对 touched path 执行完整内容 revision CAS。文本和 Blob 均以完整内容 SHA-256 比较，不能把 `updatedAt`、Blob size/MIME 或对象身份当作内容 revision。
- 同一路径 baseline 已变化时，整个提交 fail loud 且零 workspace/checkpoint 写入；不得 silent last-writer-wins。正常图片 UI 仍由同一 canonical slot 的既有 queue 串行，同路径绕过 queue 的调用由 CAS 拒绝。
- 目录删除必须在 transaction staging 时展开为 baseline exact paths，并在 commit 验证目录 membership 与各成员 revision 未变化；不得按提交时前缀删除新出现的后代，也不得留下未报告的部分删除。

### R2. Formal-turn atomic merge

- `commitSuccessfulRuntimeTurnForSave` 改收 `RuntimeWorkspaceChanges`，不得再接收或整表替换启动时的 `finalWorkspaceFiles()`。
- 正式回合必须在一个 Dexie transaction 内原子持久化：raw turn append、Agent context/普通 state writes、runtime trace writes、save/history 相关 metadata（包括 save `updatedAt`）以及 after-turn checkpoint row 和其所引用的新 Blob rows。
- raw turn 文件是 history authority；不得为当前未消费的 `history` 参数或新 history audit 字段保留第二份权威。
- after-turn manifest 只能在 touched-path CAS 对 current DB state 验证通过后，由“该时刻 current save workspace + 本回合 changes”构建；禁止从 LLM 启动时 stale snapshot 构建。
- `crypto.subtle.digest` 等 hash 工作在 Dexie transaction 外预计算；实现必须先读取 current DB、验证 baseline、合并 changes、预计算 manifest/hash/Blob records，再在短 transaction 中重复 CAS 并一起写入 `blobs/workspaceFiles/checkpoints/saves`。CAS 失败时重做 preparation 或返回明确冲突，绝不接受 stale manifest。
- 当正式回合与不同路径图片交错时：图片先提交则 after-turn manifest 包含它；正式回合先提交则后到图片 patch 该 after-turn checkpoint。两种顺序都不得丢图。

### R3. Guard-to-storage responsibility boundary

- sibling 的通用 Tool 输入继续保持 `sourceGuard?` optional，invokeAgent request/options 新增 `generatedMediaSourceGuard?` optional。两者均缺失时只 stage 普通 Blob write，沿宿主既有 commit/checkpoint 选项，不触发媒体 checkpoint patch；option 缺失而 Tool 自带合法 guard时可以进入 guarded handoff。正式 turn direct Tool 可无 guard。
- MVP `image-director` UI 必须把同一 guard 同时放入 Agent input 与 `invokeAgent.generatedMediaSourceGuard`。host strict-normalize option并闭包为 `requiredSourceGuard`；Tool 漏 guard、任一字段 mismatch或错误 assetId 在 Provider前 `IMAGE_INVALID_ARGUMENTS` fail，零 Provider/零 write且不能降级。合法 handoff中的 guard来自 option closure；Agent/Tool/result回显不是 durable authority。V1 guarded shape 固定为：

```ts
{
  kind: "turn-projection"
  turn: number
  projectionKey: "illustrations"
  index: number
  fingerprint: `sha256:${string}`
}
```

- frontend 对 projector `$1|trim` 已持久化的 raw projection string 调用 `@tsian/play-bridge` shared helper，得到 fingerprint、`identityKey` 与 `assetPath`；它把 `assetId: identityKey` 和完整 guard 放入 Agent request，并把相同 guard放入 invoke option。Agent 只验证并原样传递 Tool fields，host option closure才是commit authority；host在付费 Provider 请求前以同一 helper重算并执行required guard/Tool guard/assetId一致性检查。Agent 不 hash、不发明 id。
- 本任务的 card-agnostic platform-host source-registration seam只接收平台已经authority-validated的 handoff `{ identityKey, assetPath, blob, sourceGuard }`。guarded metadata的合法来源仅有两种：host required option路径（guard必须来自closure）或option缺失时合法Tool self-guard路径；不得由Agent final result或普通path write推断。seam必须精确读取 `save/history/turns/turn-${String(turn).padStart(6, "0")}.json`，通用定位 assistant `projections[projectionKey][index]`，并使用同一 shared helper 对该 raw string 验证 fingerprint。不得 parse/re-serialize projection、排序字段或规范化 Unicode/空白，也不得把 `illustrations` schema、卡字段或玩法规则放入 storage。
- source-registration 层从完整 turn-file UTF-8 contents 计算 SHA-256 revision，并把已验证 handoff 转换为 storage-facing metadata；storage commit 不再接收或解析 `sourceGuard`/projection JSON：

```ts
interface GeneratedMediaCommitMetadata {
  assetPath: string
  identityKey: string
  source: {
    path: string
    expectedRevision: string
  }
}
```

- `source.path` 必须精确为 `save/history/turns/turn-${String(turn).padStart(6, "0")}.json`；`expectedRevision` 是该权威文件完整 UTF-8 contents 的 SHA-256 lowercase hex，不使用 `updatedAt`，不只 hash projection 片段。
- `writeGeneratedMedia({ identityKey, assetPath, data, source })` 必须把 Blob write 与上述 metadata 成对 stage。transaction seam 验证 metadata 的 `assetPath/identityKey` 与 shared-helper canonical generated path 配对；durable storage 只验证 exact source path 当前存在、完整内容 revision 等于 `expectedRevision`，以及 `assetPath` 确实对应本次 changes 中同 transaction 的 Blob write。

### R4. Guarded media atomic commit and checkpoint patch

- 本任务明确不消费 card runtime `imageGeneration?: {agentId,protocol}` capability，也不消费 `IllustrationBriefV1` runtime validator。capability discovery 与 closed block schema（包括 `additionalProperties:false`、长度/ref grammar/fallback）止于 protocol/UI；source-registration 只理解 generic turn envelope、projection key/index 与 exact raw string，storage 只理解 exact source path/revision。
- guarded `invokeAgent` commit 在同一个 Dexie transaction 内完成：source CAS、asset workspace row、asset Blob row、所有 eligible checkpoint manifest 的 path-level patch、save metadata。任一验证失败均零写入。
- 只 patch 当前仍 retained 且 `checkpoint.turn >= source.turn` 的 checkpoint。不得修改更早 checkpoint，不得从 current workspace 重建旧 manifest，不得创建已不存在/已被 prune 的 checkpoint。
- patch 仅替换或插入 `assetPath` 对应 manifest entry；其它 entries 保持原值。重生成同路径必须把每个 eligible retained checkpoint 的该 entry 同步切换到新 hash。
- source 文件缺失、revision 改变、asset write/metadata 不配对、target path baseline 冲突或 directory expectation 冲突都必须在持久化前失败。
- guarded media 禁止复用 `current-turn-auto` 构建旧 checkpoint；该分支只走 source-guard checkpoint path patch。若调用同时请求不兼容的 generic checkpoint option，应在 commit 前 fail loud，不能猜测优先级。
- Provider/Agent/图片验证在 stage 前失败时不得触碰旧 asset；durable commit 失败时也不得产生部分 Blob、workspace 或 checkpoint 状态。

### R5. Restore linearization and same/different-path concurrency

- 引入 per-save lifecycle serialization，覆盖 guarded media durable commit 与 `restoreCheckpointForSave` 从读取 checkpoint/预取 Blob到完成事务的完整临界区；所有 restore 入口通过 shared storage helper 自动获得该保护，不能只在一个 UI action 加锁。
- serialization 只覆盖本地 hash/DB 临界区，不覆盖 Provider/Agent 网络调用，不锁 Composer，不把不同 slot 的生成变成全局生成队列。
- 线性化结果必须是：
  - media commit 先完成 → restore 读取已 patch manifest并恢复该图；
  - restore 先完成 → source turn 被裁剪后 late media source CAS 失败且零写入。
- 不同 asset paths 即使 transaction 启动基线相同，也必须各自 rebase 到 current DB 并都成功合并。短 durable sections 可由 IndexedDB/per-save lock 顺序落地，但不能互相报告冲突或丢失。
- 同 asset path 由 canonical same-slot queue 正常串行；非正常并发仍必须由 target touched-path CAS 拒绝 stale writer，不能依赖最后提交者覆盖。

### R6. `current-turn-auto` branch safety

- `current-turn-auto` 在 durable commit 时重新读取 authoritative turn files，并要求调用启动时 captured turn 仍等于 current branch max turn；不相等时整个 workspace+checkpoint commit 零写入并返回明确 stale-turn conflict。
- 条件成立时，manifest 仍由 commit-time current workspace + explicit changes 构建，并维持 same-turn auto canonicalization。
- 不得把未来 turn workspace 写入旧 turn checkpoint，也不得让 guarded generated media 走这个分支。

### R7. Blob lifecycle

- Blob liveness/GC 必须以“current workspace 的完整内容 hashes + 所有 remaining checkpoint manifests 的 hashes”并集为准；manifest-only GC 不符合本任务要求。
- checkpoint prune/delete/overwrite/restore 与 generated-media regeneration 使用同一 liveness helper，按 `ownerSaveId` 删除不再引用的 Blob。
- 新 asset hash 必须在引用它的 workspace/checkpoint 同一 transaction 内写入，避免 manifest 指向不存在 Blob。hash 可预计算，但 stale/failed guarded commit 不得留下新 orphan Blob row。
- 成功重生成后旧 hash 若不再被 current workspace 或任何 retained manifest 引用，应被删除；失败时旧 hash、旧 workspace row 与 manifest entries 均保持。

### R8. Invocation identity and context-slot canonicalization

- `formatAgentTracePath` 增加 `invocationId`，成功事务 trace 与失败 best-effort trace 使用同一三元组 `(agentId, timestamp, invocationId)`。invocation id 必须使用无碰撞的 path-safe encoding/hash，不得用会把不同原值压成同一字符串的简单替换。
- `contextSlot` 在 queue key 构造前统一 normalize/validate 一次，并把同一 canonical value传给 context read/write/path helper；显式空值、路径字符或其它 noncanonical 输入 fail loud。
- queue key 必须区分 slot omitted 与字符串值（包括 `"default"`），不能用同一个文本 sentinel 造成 identity 混淆。
- 上述 slot 规则即使 `persist:false` 也执行；`persist` 只决定 context 文件读写，不改变并发 identity。

### R9. Executable verification

- 为 storage/host concurrency 增加可重复执行的 browser-compatible unit/integration harness；当前仓库只有 Playwright UI E2E，没有 IndexedDB storage unit harness，因此实施应引入最小 `Vitest + fake-indexeddb` dev test seam（或等价且可在 CI 单命令执行的真实 Dexie harness），不得只写手工步骤。
- 测试必须使用真实 Dexie transactions 与可控 async barriers，断言 workspace rows、checkpoint manifests、Blob rows和 save metadata，而非只测纯 merge helper。
- 至少运行 `npm run build:web`。仅当共享 `@tsian/contracts` shape/exports 发生变化时运行 `npm run build:contracts`；本任务优先把 generated-media commit metadata 保持在 platform-web internal storage seam，避免不必要 shared contract drift。

## Acceptance Criteria

- [ ] AC1: 正式回合只提交 explicit changes；与不同路径旁路图片交错时，无论先后顺序，最终 workspace 和 after-turn checkpoint 都含正文状态与图片。
- [ ] AC2: raw turn、context/state、trace、save metadata、after-turn checkpoint 及其新 Blob references 同一 Dexie transaction 原子落地；注入失败时无部分 accepted turn。
- [ ] AC3: after-turn manifest 基于 CAS 通过后的 current DB + changes，未使用 turn startup snapshot；touched-path 冲突 fail loud且不覆盖并发写。
- [ ] AC4: invokeAgent host required option/Tool guard/assetId gate 已在 Provider 前通过；source-registration 只接收合法来源的 handoff，generic 验证权威 turn projection raw string并 stage 精确 `{assetPath, identityKey, source:{path,expectedRevision}}`；storage 不解析 projection/card JSON。guarded metadata只由 host-required-and-validated option路径或 option缺失时合法 Tool self-guard路径产生，Agent result无authority。card `{agentId,protocol}` capability与closed brief validator均不进入本层。
- [ ] AC5: source path 严格使用六位 turn 文件名，revision 为完整文件内容 SHA-256；修改 `updatedAt` 不影响 revision，内容改变/删除会使 late commit 零写入。
- [ ] AC6: guarded commit 原子写 asset/Blob并只 patch retained `checkpoint.turn >= source.turn` 的同一路径；更早、已 prune 或缺失 checkpoint 不被修改/重建。
- [ ] AC7: 同路径重生成成功后 current workspace 与所有 eligible checkpoint 指向新 hash，旧无引用 Blob 被 GC；生成或 commit 失败保留旧图和旧 hash。
- [ ] AC8: media-before-restore 恢复出新图；restore-before-media 使迟到结果 stale 且零写入；两个 shared restore 调用入口均由 storage-level serialization 覆盖。
- [ ] AC9: 不同路径并发 commit 均合并；同路径正常 same-slot 串行，绕过 queue 的 stale writer 被 CAS 拒绝；目录新增后代不会被旧目录删除静默抹除。
- [ ] AC10: stale `current-turn-auto` 不写 workspace也不污染旧 checkpoint；合法 current-turn-auto 仍从 commit-time merged state canonicalize same-turn auto checkpoint；guarded media 不使用该模式。
- [ ] AC11: unguarded `generate_image` 仍是普通 Blob transaction write，保留宿主既有 checkpoint option 语义且不触发媒体 manifest patch；option缺失+合法Tool guard仍走guarded path。required option mismatch绝不会进入本任务commit seam或ordinary write。
- [ ] AC12: 两个同 Agent、同毫秒、不同 invocationId 的 trace paths 不同；成功/失败路径都带 invocationId。
- [ ] AC13: noncanonical/空 `contextSlot` 在 queue 前被拒绝，canonical slot 同时驱动 queue/path；omitted slot 与显式 `default` 不混淆，`persist:false` 也执行相同验证。
- [ ] AC14: 可执行 storage matrix 覆盖 formal/media、different/same path、regeneration success/failure、restore race、checkpoint eligibility/prune、current-turn-auto、atomic failure、directory delete、GC、trace 和 slot 情形并通过。
- [ ] AC15: `npm run build:web`、conditional `npm run build:contracts`、storage test command 与 `git diff --check` 通过；未新增 Dexie table/job/audit field，未修改 Provider/UI/Agent Prompt。

## Out of Scope

- 图像 Provider 配置/adapter、`generate_image` Tool schema/权限/UI，以及 Settings 测试生成。
- storyteller / `image-director` Prompt、卡 entrypoint、illustration block schema/fingerprint 业务定义与正文 UI。
- 全局图片队列、取消、自动重试、持久化 job、进度/费用系统、跨 reload 恢复网络请求。
- 多版本图片画廊、历史视觉快照、任意 path 模型写入或旧存档迁移。
- 新 Dexie table、通用事件溯源框架、无消费者 audit metadata。

## Delivery Constraints

- 规划阶段只修改 `.trellis/tasks/07-21-image-save-consistency/`。
- 不修改 `task.json`，不运行 `task.py start`，不实现产品代码，不 commit。
