# Technical Design

## Dependency Gate

本任务只在 `07-25-card-frontend-action-runtime` 已提交并归档后开始。实现前先按实际落地的 manifest、错误和 test harness 契约复核本设计；不得在装备代码中复制桥接、权限、CAS 或通知能力。

## Canonical Data Model

角色只保留：

```ts
type CharacterEquipment = Record<string, EquipmentSlot[]>

type EquipmentSlot =
  | { ref: null }
  | { ref: string; applied?: Record<string, number> }
```

物品只保留：

```ts
interface ItemEquipment {
  slotType: string
  add?: Record<string, number>
  percent?: Record<string, number>
  effects?: string[]
}
```

Parser/validator 是 fail-closed：结构不是上述形态即报 corrupt，不接受 interim schema。写回只替换角色 document 的 `attributes` 和 `equipment`，其余字段从读取快照原样保留。

## Deterministic Core

Frontend Action 与 Skill 分别内置同语义 core。core 分为五个无副作用阶段：

1. **load**：读取角色、所有 relevant entities 和 container entries。
2. **validate**：验证 schema、安全整数、slot 地址、ownership graph 和数量。
3. **baseline**：按角色属性 key 顺序从 active attributes 减去所有旧 applied。
4. **plan**：应用 operation/attributeChanges，验证或清理 projection，重算所有合法槽位。
5. **normalize**：构造新 attributes/equipment、delta 和稳定业务结果；此时仍无写入。

计划顺序固定为：

1. 验证 character attributes 与每个 stored applied；missing applied 当空 map，unknown applied key 是 corruption，`ref:null` 携 applied 是 corruption。
2. 按存储的 old applied 原值恢复 baseline；item 当前规则即使已变，也不反推旧 contribution。
3. refresh 把 default-empty attributeChanges 加到 recovered baseline；每个 key 必须已存在。
4. 分类 stored projection；refresh 清 stale 时仍保留步骤 2 对其 old snapshot 的撤销。
5. 所有 live item 都读取同一个 post-change baseline，独立算 contribution。
6. final attributes = post-change baseline + all new applied；原子替换角色完整 attributes/equipment。

commit 仅在完整 plan 成功后写角色 entity。preview 返回同一 plan 的 public output，不执行 write。

### Exact arithmetic

所有 JSON number 先验证 `Number.isSafeInteger` 再转 BigInt。BigInt reduction 是 unbounded，不在 partial sum 或 numerator 上做 safe-range check，避免不同 enumeration order 因中间越界得到不同结果。只在语义 checkpoint 检查 safe range：每属性 recovered baseline、应用 attributeChanges 后 baseline、每槽 round 后 contribution 和最终 persisted attribute。对每个角色已有属性：

```text
baseline = current - sum(oldApplied)
refreshBaseline = baseline + attributeChanges
numerator = 100 * add + abs(refreshBaseline) * percent
contribution = roundAwayFromZero(numerator / 100)
final = refreshBaseline + sum(contribution)
```

属性遍历沿用角色原 key 顺序；modifier lookup 不依赖 object enumeration 顺序。规范化 applied 按角色属性顺序生成，零值 key 省略，全部为零则省略 applied。

## Container Graph

构建一次 canonical ownership index：

```text
buildTargetGraph(character):
  roots = character.containers in authored order
  dfs(containerRef, activeStack, visited):
    if containerRef in activeStack -> EQUIPMENT_CONTAINER_CYCLE
    if containerRef in visited -> return
    visited.add(containerRef)
    for each entry in container authored order:
      if entry resolves to container:
        require entry.count absent or exactly 1
        dfs(entry.ref)
      else:
        count = entry.count ?? 1; require positive safe integer
        available[entry.ref] += count using unbounded BigInt
  require every available result safe before comparison/output

demand(ref) = number of non-null equipment slots using ref after operation
```

同一唯一 container 内重复 item entry 和多个唯一 container 中的同 ref 都求和；visited 保证多路径不重复内容。为证明独占，对其他 character roots 做 deterministic traversal，但只要确认是否命中 target visited container set；完全无关图的 cycle/malformed branch 不阻塞目标操作。target container 被任一其他角色 reach 即 `EQUIPMENT_SHARED_CONTAINER`。同一 item ref 存在于互不共享的独占图中按各自 count 独立，不是 shared ownership。所有 error details 中的 refs/paths/slots 先 canonical sort。

图读取必须使用 Frontend Action runtime 的 list/glob/read adapter，因此 ownership、items 和 character 文件都进入 optimistic read set。Skill 执行也基于自身一次调用的有效 Workspace 快照和 staged mutations。

## Projection Classification

先验证所有 slot 与旧 applied 的结构。结构/数值错误永远是 corruption；`ref:null` 只能是 `{ ref:null }`。结构合法后，existing occupied projection 的 missing entity、unreachable、non-equipment 或 item.slotType mismatch 都是 stale，无论是否为当前 target。

- `refresh`：按 old snapshot 已恢复 baseline 后，把 stale slot 规范化为空并继续。
- `equip`/`unequip`：任何 stored stale slot 都返回 `EQUIPMENT_REFRESH_REQUIRED`，目标槽也不能直接替换/清除；零写入。
- 新 equip candidate 缺失、不可达、非装备或 type mismatch 是请求错误，分别返回 item-not-found/not-reachable/data-invalid/slot-type-mismatch，不视为可清 projection。

在清理/修改后，按 ref 聚合 occupied slot demand 并与 reachable available 比较；超额是 `EQUIPMENT_QUANTITY_EXHAUSTED` corruption，整次失败。Frontend Action v1 无 refresh，UI 对 refresh-required 只能提示先运行 Stage Manager maintenance/装备管理 refresh 后再重试，不通过 equip/unequip 偷做 repair。

## Operations

### Exact manifest schemas

`action.json` 的 inputSchema 使用 `oneOf` 两个 `additionalProperties:false` object：

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

所有 string 必须 `minLength:1` 且等于自身 trim；`slotIndex` 是 `minimum:0` 的 safe integer，runtime/core 还验证其不超过现有 array length-1。equip 必须 itemRef，unequip schema 中 itemRef 不存在。unequip 的 expectedCurrentRef 必须 nonempty string，因为空槽不能卸装；equip 可用 null 填空槽或 string 替换占用槽。outputSchema 对下面完整 nested shape 每层 `additionalProperties:false`，attributes/equipment 的 dynamic maps 用 safe-integer/slot schemas 约束：

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

before/after 保留全部角色属性，delta 仅包含非零变化并按角色属性顺序。preview/commit 的业务 output 完全相同，仅 mode 不同。

Skill `equip`/`unequip` input/output 与 Action mutation schema 相同，但不暴露 mode（隐含 commit）；transport adapter parity 时补成 canonical mutation shape。Skill refresh 使用独立 schema：

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

clearedSlots 按 character slotType authored order + slotIndex 排序。commit durable 后由平台附带 mutation lifecycle，不把文件内容放入 event。

### Stage Manager Skill

Skill 固定目录 `agents/stage-manager/skills/装备管理/`，声明三个 browser-script action：

- `equip`：等价于 Action `mode=commit, operation=equip`；
- `unequip`：等价于 Action `mode=commit, operation=unequip`；
- `refresh`：读取全部槽，清 stale projection，并在 baseline 上应用可选 attributeChanges 后重算。

refresh 返回独立 `EquipmentRefreshResult`，不伪造单一 target slot。Prompt 要求场记把正常属性增减交给 refresh，不得先用 generic edit 改 active attributes。shared parity 只比较 equip/unequip；refresh 使用 Skill-only vectors。

## Stable Errors And Precedence

Domain validation 使用固定顺序，首个失败决定 code：input schema → character/slot structure → attributes/old applied → target slot/expected ref → target ownership graph/shared overlap → all stored projection classification → requested candidate → resulting quantity → arithmetic/output normalization。runtime input/output schema、CAS conflict、abort、timeout 属于平台 transport errors，不纳入两 core domain parity。

两个 core 对 shared operation 使用相同业务 code/details schema；diagnostic arrays 全部 canonical sort：

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

`EQUIPMENT_DATA_INVALID.area` 是 allowlisted enum（character/equipment/applied/item/container/count），不回传 raw path/content。Action core 通过 runtime dedicated `tsian.action.fail({ code, message, details })` 发出，SDK 得到 `kind:"domain"`；Skill core 发出 run_script domain failure。所有 code/message/details 满足 runtime envelope 的长度、strict-JSON 与无 raw path/content 限制。测试剥离 transport 后比较 `{ code, details }` exact deep equality。

## Canonical Black-Box Fixtures

Canonical fixtures 分为两个 suites，但共享同一 case schema：

```ts
interface EquipmentFixtureCase {
  suite: "shared-mutation" | "skill-refresh"
  name: string
  operation: "equip" | "unequip" | "refresh"
  workspace: Array<{ path: string; content: JsonValue }>
  input: Record<string, JsonValue>
  expected:
    | { ok: true; output: JsonValue; writes: JsonValue }
    | { ok: false; code: string; details: JsonValue; writes: [] }
}
```

`shared-mutation` 的 equip/unequip 分别运行 Action script 与 Skill script，通过 adapter 归一 mode 后 exact compare output/domain error/staged writes；`skill-refresh` 只运行 Skill。runtime CAS/abort/timeout/schema transport errors 由 runtime suite 测试，不混入业务 parity。

cases 至少覆盖：空槽装备、直接替换、卸装、负 baseline、正/负 percent、正负 half tie、一次取整反例、slot 与 add/percent key permutation、safe-limit cancellation、同 ref count、同 container 多路径去重、重复 item entry、quantity exhausted、stored item rules 已变但按 old applied 恢复、stale refresh、target/unrelated stale refresh-required、unknown old applied/attributeChanges、malformed applied/count/container-ref count、cycle/shared ownership、无关角色损坏不阻塞、各语义 checkpoint overflow、expected-ref conflict 和 preview zero-write。

Fixture 是合同数据，不抽取两个资源共享的 production core；否则无法证明分发副本一致。

## Schema And Card Synchronization

以新结构同步：

1. internal AIRP guide/reference 和 default living schema/entity examples；
2. internal default Workspace 的 `frontend-actions/equipment/**`；
3. internal Stage Manager prompt/schema context 和 agent-local equipment Skill；
4. formal card AIRP docs；
5. formal Stage Manager Agent、现有 maintenance Skill 和新增 local equipment Skill；
6. formal card `workspace/frontend-actions/equipment/**`；
7. rebuild formal card `workspaceFiles` from disk。

internal template constants 是同步 authority。测试把 default Workspace materialize 到临时目录，再对设备相关 Action、Skill、schema docs 与 formal Workspace 文件做 byte-for-byte 比较；只允许在明确 exception list 中保留 formal-card 特有 Stage Manager orchestration 差异。canonical suites 同时执行 materialized internal scripts 与 formal-card scripts，防止 TypeScript template escaping 漂移。

保留 card package metadata、coverFiles、frontendFiles 和 exportedAt。删除所有 interim operator/schema 指令，但不触碰 07-21 image-generation planning edits。

## Frontend Integration

`apps/play-frontend-dev` parser/type 层只解析新 schema 并提供展示数据，不计算 contribution。交互流程：

1. 用户激活 equipment slot；
2. inventory pane 过滤/标记同 slotType 的 reachable equipment candidates；
3. 选 item 或 unequip，创建 AbortController + monotonically increasing generation，携带 current ref 调 preview；selection/character/slot change、relevant mutation、Dialog close/unmount 都 abort。
4. 只有 generation、characterRef、slotType/index、expectedCurrentRef、selected item 仍匹配时才接收 preview；Dialog 展示 Action 返回的 before/after/delta。
5. commit pending 禁止重复提交；确认时用相同 expectedCurrentRef 调 commit，不自动 retry。
6. conflict 或相关 mutation 将 preview 标 stale，authoritative reread 后要求新 preview；refresh-required 提示先由 Stage Manager/维护流程 refresh，不能假装玩家端已修。
7. 成功可先展示 Action output，但必须重读 authoritative character/container/item paths 收敛；path-filter mutation subscription 并在 unmount unsubscribe。

使用现有 Reka Dialog/focus patterns：focus trap、initial focus、Escape、return focus、keyboard list navigation、visible focus、live error announcement；移动端不增加第三套导航，保持独立滚动。不可用候选仍可被辅助技术识别并说明原因，不能只靠颜色。player-facing error 不展示 raw path/schema/internal code。

## Packaging Boundary

本任务不修改 `cards/沉浸阅读器.tsian-card/frontend/**`，也不重建 `frontendFiles`。新增 card Workspace Action/Skill 必须进入 `workspaceFiles`；开发前端通过 build/browser 验证，正式成品前端延续既有后续导入流程。因此本 child 交付“开发前端可运行 UI + 正式卡 Workspace 能力”，不声称当前正式卡 dist 已有换装 UI；parent 在 later frontend import/export carrier 完成前保持 open/integration 状态。
