# Technical Design

## Dependency Gate And Frozen Baseline

`07-25-card-frontend-action-runtime` 已由 `4cdeca9` 实现、由 `e174bb3` 归档。本任务直接使用最终 API：固定目录 manifest、strict JSON/Ajv、opaque-origin Worker、`tsian.action.fail`、immutable snapshot/read-set CAS、two-stage commit lease、path-only mutation event 和 no-checkpoint commit。装备代码不得复制桥接、权限、CAS 或通知能力。

实现开始时记录 dirty baseline；保留全部现有 `07-21-*` planning edits。冻结正式卡 `frontend/**`、`frontendFiles`、coverFiles、manifest、exportedAt 和 exporter metadata。

## Canonical Reference And Entity Loading

### Reference grammar

装备 Action/Skill 各自实现相同的 pure parser，并由 shared fixtures 约束：

```text
<ref>      := <type> ":" <localId>
<type>     := "character" | "container" | "item"
<segment>  := trimmed non-empty string, <= 80 UTF-16 code units
<ref>      := <= 120 UTF-16 code units
```

segment 拒绝 `/`、`\\`、`:`、NUL、`.`、`..`；完整 ref 必须等于自身 trim 且恰有一个冒号。调用点必须传 expected type。canonical path：

```text
save/entities/<type>/<localId>.json
```

读取后：

- document 必须是 plain JSON object；
- `id` 必须与请求 ref 和 filename 精确一致；
- container 要求 `type:"container"`；
- item `type` 为 `equipment|material|consumable|special|other`；
- character 不新增冗余 type 字段，靠 character schema/owned fields 判定。

Action missing read 返回 `null`，Skill missing read 可能抛 operation error。两边各自用 local loader 归一为相同 core-level missing result，不让业务逻辑依赖 transport 差异。

### Character discovery

角色平铺在 `save/entities/character/*.json`。跨角色 ownership index 使用 direct：

```js
tsian.workspace.list({ scope: "effective", path: "save/entities/character" })
```

只处理直属 `<localId>.json` file entry；忽略目录和非 JSON。不得用 result 上限为 200 的 `glob` 枚举完整角色集。直属 JSON unreadable、JSON 非法、id/filename 不一致，或 ownership projection 非法时 fail closed，因为 exclusive ownership 无法证明。

## Canonical Data Model

角色装备：

```ts
type CharacterEquipment = Record<string, EquipmentSlot[]>

type EquipmentSlot =
  | { ref: null }
  | { ref: string; applied?: Record<string, number> }
```

- slotType 是非空 trimmed string，最长 80；数组非空，其现有长度是该类型固定容量。
- empty exact shape 是 `{ref:null}`。
- occupied exact shape 是 `{ref:itemRef, applied?}`。
- output 保持 authored slotType key order、array positions 和 attribute key order。

物品装备：

```ts
interface ItemEquipment {
  slotType: string
  add?: Record<string, number>
  percent?: Record<string, number>
  effects?: string[]
}
```

Parser/validator fail closed，不接受旧 `slot/mods/operator`。写回复制读取到的 character document，只替换 `attributes` 和 `equipment`。

## Deterministic Core Pipeline

Action 与 Skill 各自内置同语义 core。不得抽成跨资源 production module。每个 core 分为：

1. **parse input/ref**：closed input、operation-specific fields、canonical refs、safe slotIndex。
2. **load**：target character、direct character index、target/foreign containers、所需 item documents。
3. **validate structure**：character/equipment/attributes/old applied/root/container entries。
4. **build graph**：target reachable containers + quantities，再做 foreign ownership proof。
5. **recover baseline**：从 current attributes 按 stored old applied 原值撤销。
6. **classify**：stored live/stale projection；refresh 清 stale，mutation 遇任何 stale 返回 refresh-required。
7. **plan operation**：expected-ref、candidate、quantity demand、attributeChanges。
8. **recalculate**：所有 live equipment 读取同一 post-change baseline。
9. **normalize output/document**：strict JSON、key/order/slot capacity。
10. **write last**：preview 不写；Action commit/Skill mutation 均只写一次 character。

Skill 没有 per-script savepoint。步骤 1–9 必须包含所有可失败工作，唯一 write 后不得再 parse、校验、计算或构造可能失败的 output。

### Validation precedence

首个失败按固定顺序决定：

```text
input/ref
→ character/equipment structure
→ attributes/old applied
→ target slot/expected ref
→ target graph
→ foreign ownership proof
→ all stored projection classification
→ requested candidate
→ resulting quantity
→ arithmetic/output normalization
```

runtime schema/CAS/abort/timeout 是平台错误，不进入 business parity。

## Exact Arithmetic

所有受管 JSON number 先 `Number.isSafeInteger` 后转 BigInt。求和、numerator 和 cancellation 使用 unbounded BigInt，不因中间值越 safe range 而产生顺序依赖。

对每个属性：

```text
baseline = current - sum(oldApplied)
postChangeBaseline = baseline + (refresh attributeChanges ?? 0)
numerator = 100 * add + abs(postChangeBaseline) * percent
contribution = roundHalfAwayFromZero(numerator / 100)
final = postChangeBaseline + sum(contribution)
```

half-away：

```text
magnitude = abs(numerator)
quotient = magnitude / 100
remainder = magnitude % 100
if remainder * 2 >= 100: quotient += 1
result = sign(numerator) * quotient
```

只在语义 checkpoint 检查 safe range：recovered baseline、post-change baseline、每槽 contribution、public reachable quantity/error detail，以及 final persisted attribute。BigInt 不得进入 Workspace write、output、SDK args 或 error details。

## Container Graph And Ownership

### Exact entries

```ts
interface RefEntry {
  ref: string
  count?: number
}
```

root/contents entry 必须是只含 `ref/count?` 的 object。

- character root / nested container ref：count absent → 1；显式只能 1；不会乘算 descendants。
- item ref：count absent → 1；显式必须 positive safe integer。
- 其他 type、额外字段、非法 count/ref → corruption。

### Target traversal

```text
walkTarget(containerRef, activeStack, completed):
  if containerRef in activeStack: cycle
  if containerRef in completed: return
  load/validate container
  activeStack.add(containerRef)
  for entry in authored order:
    if container: recurse
    if item: available[itemRef] += count using BigInt
  activeStack.delete(containerRef)
  completed.add(containerRef)
```

`activeStack` 区分 true back-edge；`completed` 处理 diamond/repeated path。target item ref 即使 document missing 仍累计 raw quantity；item validity 在 projection/candidate 阶段判断。

### Foreign ownership proof

完成 target set 后 direct-list 所有其他 characters，遍历其 container edges 直到：

- 命中 target set → `EQUIPMENT_SHARED_CONTAINER`；
- graph exhaustion → 该角色不共享。

foreign traversal 同样使用 active/completed。只要外部 root/container/edge malformed 或 unreadable 导致无法排除 target overlap，就 fail closed；不与 target 相交的 foreign cycle 可终止该 branch，不单独把目标操作判为 target cycle。foreign item document、item modifiers 和 item count 不参与 container ownership proof。

### Quantity

变更后每个 occupied slot 对 ref 贡献 demand 1。available/demand 均用 BigInt 聚合；比较前后需要公开/写入的数值 checked-convert。`demand > available` → `EQUIPMENT_QUANTITY_EXHAUSTED`。

## Projection Classification

先验证所有 slot/old applied 结构并恢复 baseline。结构错误始终 corruption；`ref:null` 只能 exact empty shape。

结构合法的 occupied stored projection 分类：

- item missing；
- unreachable；
- item type 非 equipment；
- item equipment.slotType mismatch；
- live。

refresh 撤销 old applied 后清 stale 并继续；equip/unequip 遇任一 stored stale（target 或 unrelated）均返回 `EQUIPMENT_REFRESH_REQUIRED`，零写入。新 candidate missing/unreachable/non-equipment/type mismatch 分别是 request/domain error，不是 repair。

## Operations And Schemas

### Action input

`action.json.inputSchema` 用 `oneOf` 两个 `additionalProperties:false` object：

```ts
type EquipmentActionInput =
  | {
      mode: "preview" | "commit"
      operation: "equip"
      characterRef: string
      slotType: string
      slotIndex: number
      expectedCurrentRef: string | null
      itemRef: string
    }
  | {
      mode: "preview" | "commit"
      operation: "unequip"
      characterRef: string
      slotType: string
      slotIndex: number
      expectedCurrentRef: string
    }
```

Schema 对 slotIndex 写 safe-integer bounds；canonical trim/ref/type 由 core 复核。unequip expectedCurrentRef 必须 non-null item ref。

### Action output

```ts
interface EquipmentMutationResult {
  kind: "mutation"
  mode: "preview" | "commit"
  operation: "equip" | "unequip"
  characterRef: string
  slot: {
    slotType: string
    slotIndex: number
    beforeRef: string | null
    afterRef: string | null
  }
  attributes: {
    before: Record<string, number>
    after: Record<string, number>
    delta: Record<string, number>
  }
  equipment: CharacterEquipment
}
```

Schema 规则：

- fixed wrappers/slots `additionalProperties:false`；
- dynamic numeric maps 使用 schema-valued `additionalProperties` + safe integer min/max；
- equipment 使用 schema-valued `additionalProperties` 指向 `minItems:1` slot arrays；
- fixed capacity 是 core 验证 before/after 各数组长度完全相同，不在 manifest 写一个全局 maxItems；
- slot `oneOf` exact empty/occupied；
- 不使用 remote ref、`$id`、anchor/dynamic vocabulary。

before/after 保留全部属性，delta 只含非零变化，均按原 attribute order。preview/commit 业务结果仅 mode 不同。

### Skill actions

Skill 声明 `equip`、`unequip`、`refresh` 三个 browser-script action，使用三个薄入口和 Skill-local `scripts/equipment-core.js`。Skill action name 不由 runtime 注入，因此不要让单一入口猜测 operation。

Skill declaration schema 仅为 discovery/浅层 guard；core 完整验证 nested input/output。equip/unequip 输出与 Action 去 mode 后一致。refresh：

```ts
interface EquipmentRefreshResult {
  kind: "refresh"
  characterRef: string
  attributes: {
    before: Record<string, number>
    after: Record<string, number>
    delta: Record<string, number>
  }
  equipment: CharacterEquipment
  clearedSlots: Array<{
    slotType: string
    slotIndex: number
    previousRef: string
    reason: "missing" | "unreachable" | "not-equipment" | "slot-type-mismatch"
  }>
}
```

clearedSlots 按 authored slotType order + slotIndex。

## Stable Errors And Runtime Adapters

Core failure：

```ts
interface EquipmentBusinessFailure {
  code: string
  message: string
  details?: JsonValue
}
```

Action adapter 捕获 core failure 并调用 `tsian.action.fail`。Skill adapter 抛带同字段的 error-like value；production run_script 会把它包装在 script error details 中。

Parity normalizer：

- Action：只接受 dedicated domain envelope；
- direct Skill harness：读取 thrown `code/message/details`；
- production run_script regression：读取 wrapper 内 scriptError；
- 比较 canonical `{code,details}`，不要求 raw envelope 相同。

稳定 codes/details：

```text
EQUIPMENT_CHARACTER_NOT_FOUND { characterRef }
EQUIPMENT_DATA_INVALID { characterRef, area, field? }
EQUIPMENT_SLOT_NOT_FOUND { characterRef, slotType, slotIndex }
EQUIPMENT_EXPECTED_REF_MISMATCH { characterRef, slotType, slotIndex, expectedCurrentRef, actualCurrentRef }
EQUIPMENT_ITEM_NOT_FOUND { characterRef, itemRef }
EQUIPMENT_ITEM_NOT_REACHABLE { characterRef, itemRef }
EQUIPMENT_SLOT_TYPE_MISMATCH { characterRef, itemRef, expectedSlotType, actualSlotType }
EQUIPMENT_QUANTITY_EXHAUSTED { characterRef, itemRef, available, demanded }
EQUIPMENT_REFRESH_REQUIRED { characterRef, staleSlots:[{slotType,slotIndex,ref,reason}] }
EQUIPMENT_UNKNOWN_ATTRIBUTE { characterRef, source, attributes:string[] }
EQUIPMENT_INTEGER_OVERFLOW { characterRef, stage, attribute? }
EQUIPMENT_CONTAINER_CYCLE { characterRef, containerRefs:string[] }
EQUIPMENT_SHARED_CONTAINER { characterRef, otherCharacterRefs:string[], containerRefs:string[] }
```

`EQUIPMENT_DATA_INVALID.area` allowlist：character/equipment/applied/item/container/count/ref/ownership。不得包含 raw path/content/stack。diagnostic arrays canonical sort。

## Canonical Black-Box Fixtures

Prospective test-only location：

```text
apps/platform-web/src/platform-host/equipment-scripts/
├── equipment-cases.json
├── equipment-script-harness.ts
└── equipment-scripts.test.ts
```

Fixture content 区分 JSON/text encoding：

```ts
type FixtureContent =
  | { encoding: "json"; value: JsonValue }
  | { encoding: "text"; value: string }

interface EquipmentFixtureCase {
  schemaVersion: 1
  id: string
  suite: "shared-mutation" | "skill-refresh"
  operation: "equip" | "unequip" | "refresh"
  input: Record<string, JsonValue>
  workspace: Array<{
    scope: "card-content" | "save-runtime"
    path: string
    content: FixtureContent
  }>
  expected:
    | { ok: true; output: JsonValue; stateChanges: Array<{ path: string; content: FixtureContent }> }
    | { ok: false; error: { code: string; details?: JsonValue }; stateChanges: [] }
}
```

Execution matrix：

- shared-mutation：internal/formal × Action preview/commit/Skill；
- skill-refresh：internal/formal × Skill；
- each target fresh Workspace transaction；无 target-specific skip。

Harness 使用 production Action registry/import validator、production Skill declaration/path resolver 和 runtime transaction adapters；AsyncFunction 仅负责执行真实分发脚本文本。browser scripts 以 Babel `allowReturnOutsideFunction/allowAwaitOutsideFunction` 解析，不用普通 `node --check`。

Normalizer 只剥离 mode、transport wrapper、correlationId 和 write wrapper。Action preview 零 writes；commit/Skill staged state 精确匹配；failure 零 writes。runtime CAS/abort/CSP/timeout 继续由 runtime child tests 覆盖。

最小 case matrix 包含 empty/replace/unequip、expected ref、positive/negative half ties、一次取整反例、order permutation、safe cancellation/overflow、duplicate/multi-path counts、quantity exhausted、true cycle、shared/indeterminate ownership、stored rule changed、target/unrelated stale、refresh idempotency、malformed ref/applied/count、unknown attributes 和 preview zero-write。

## Internal And Formal Resource Layout

Internal template 新建 scoped equipment Action module/group，不把 Action source 塞进 Stage Manager/docs collection。materialized paths：

```text
frontend-actions/equipment/action.json
frontend-actions/equipment/run.js
agents/stage-manager/skills/装备管理/SKILL.md
agents/stage-manager/skills/装备管理/scripts/equip.js
agents/stage-manager/skills/装备管理/scripts/unequip.js
agents/stage-manager/skills/装备管理/scripts/refresh.js
agents/stage-manager/skills/装备管理/scripts/equipment-core.js
```

formal card 使用相同 Workspace paths。两份 Stage Manager `skills.enabled` exact whitelist 增加：

```text
agents/stage-manager/skills/装备管理/SKILL.md
```

internal materialization 和 formal files 对 equipment Action/Skill 做 byte parity。Action 不引用 Skill tree；Skill 不引用 Action tree。正式卡特有 Stage Manager tools/orchestration 只在 explicit comparison exception list 中排除。

## Frontend Integration

### Data contracts

`apps/play-frontend-dev` 只解析新 schema，不做 contribution arithmetic。character/item parser 对 equipment 部分 fail closed；equipment corrupt 时保留其他合法角色展示，但返回 equipment error state 并禁用装备交互。

entity/inventory loader 至少区分：missing、read-failed、invalid-json、wrong-entity-type、schema-corrupt。recursive candidate discovery 只提供 presentation metadata 和 read-path set；Action 仍是 ownership/count/type/arithmetic authority。

### State ownership

```text
CharacterSlot
  ├─ authoritative character read/reload
  ├─ screen-local useEquipmentManagement
  ├─ CharacterCard presentation coordinator
  └─ EquipmentManagementDialog
```

- CharacterStage flatten `{slotType,slotIndex,slot}`，stable key `${slotType}:${slotIndex}`；empty slot 也可激活。
- InventoryPane 保持现有 drill-in，用 refresh token 重读当前层；不变成全局 mutation store。
- ItemDetailModal 展示 slotType/add/percent/effects 和 stored applied，不计算 contribution。

建议新增：

```text
lib/equipment-action.ts
lib/load-character-inventory.ts
composables/useEquipmentManagement.ts
components/equipment/EquipmentManagementDialog.vue
```

### Preview/commit races

Preview：abort previous → generation++ → capture immutable identity → call Action → parse output → identity/generation 都匹配才 publish。角色/slot/candidate/mutation/dialog/unmount 使 preview abort+stale。

Commit 从 accepted preview identity 构造，仅 mode 改 commit。commit request 先复制到局部常量；同一 commit mutation event 可能早于 response，event 可清 preview，但不能据此 abort commit。成功后 reread character + recursive containers/items，并用权威数据替换 UI snapshot。

runtime `FRONTEND_ACTION_WORKSPACE_CONFLICT` 与 domain `EQUIPMENT_EXPECTED_REF_MISMATCH` 都 reread 并要求 fresh preview，不自动 retry。refresh-required 显示玩家可理解的维护提示。

Dialog 使用 Reka focus trap/initial focus/Escape/close-auto-focus；candidate list 支持 keyboard navigation。不可用候选保持可聚焦/可读并说明原因，而不是只用 native disabled/颜色。

## Schema, Prompt, And Card Synchronization

同步：

1. internal AIRP guide/reference、living schema/entity examples；
2. internal equipment Action/Skill；
3. internal Stage Manager prompt/maintenance guidance；
4. formal AIRP docs；
5. formal Stage Manager AGENT、maintenance Skill、new local Skill；
6. formal equipment Action；
7. formal workspaceFiles。

旧 slot/mod/operator 指令从所有 AI-facing 表面删除，不写 fallback/迁移说明。Stage Manager 正常属性变化走 `装备管理.refresh(attributeChanges)`，不先 generic edit active attributes。

## Inventory Rebuild And Frozen Carrier

正式 inventory rebuild：

1. deep-snapshot manifest/frontendFiles/coverFiles/exportedAt/exporter；
2. walk raw `workspace/**` bytes；
3. normalized package paths lexicographic sort；
4. `size` 用 raw/UTF-8 bytes，不用 JS string.length；
5. mediaType 用平台统一 inference；
6. 只替换 workspaceFiles；
7. 验证 disk/manifest one-to-one、unique、no orphan、size/mediaType；
8. deep-compare protected subtrees；
9. changed-path guard 断言 formal `frontend/**` 零变更。

本 child 交付开发前端 UI + 正式卡 Workspace 能力，不声称 formal packaged dist 已有 UI。parent 等后续 frontend import/build/export 后再完成。
