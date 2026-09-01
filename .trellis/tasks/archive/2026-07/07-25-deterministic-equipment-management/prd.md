# 确定性装备管理与换装 UI

## Goal

直接替换尚未上线的临时装备 Schema，并以卡内 Frontend Action 和 Stage Manager 本地 Skill 提供确定、原子、可预览的换装能力；开发游戏前端只消费 Action 结果，不复制装备算法。

## Background

- 当前文档、模板和角色前端使用的是动态槽位名、`item.equipment.slot` 与字符串 `mods` 的临时结构。
- 该结构尚未上线，不保留兼容 parser、迁移脚本或双写。
- 通用 `07-25-card-frontend-action-runtime` 已由提交 `4cdeca9` 实现，并由提交 `e174bb3` 归档；本任务直接复用其 manifest、strict JSON/schema、Worker、domain error、snapshot/CAS、mutation event 和 no-checkpoint 契约，不自行实现旁路。
- Frontend Action 与 Stage Manager Skill 为两个可独立分发的卡资源，因此各自包含确定性核心；shared equip/unequip 黑盒向量约束两者一致，refresh 由 Skill-only 向量约束。

## Requirements

### R0. Canonical entity references and discovery

装备核心只接受以下引用：

```text
character:<localId>
container:<localId>
item:<localId>
```

- 原始 ref 必须是非空字符串且等于自身 `trim()`；完整 ref 最长 120 个 UTF-16 code units。
- ref 必须且只能包含一个冒号。type segment 与 localId segment 均非空、最长 80，拒绝 `/`、`\\`、额外冒号、NUL，以及 segment `.` / `..`。
- 调用点必须声明 expected type；`characterRef` 只能是 character，容器边只能是 container，物品边和装备槽 ref 只能是 item。
- canonical path 固定为 `save/entities/<type>/<localId>.json`，不得从未校验字符串直接拼路径。
- 读取后的 document `id` 必须与请求 ref、目录和文件名精确一致。container 还必须有 `type:"container"`；item 的 `type` 必须是既有五类之一；character 沿用当前 character schema，不新增冗余 `type:"character"` 字段，但必须通过 character-owned 字段校验。
- 角色实体平铺存储于 `save/entities/character/*.json`。跨角色 ownership 证明必须对 `save/entities/character` 做一次 direct `list`，只接受该目录直属的 `<localId>.json` 文件；不得用有 200-result 上限的 `glob` 作为完整角色索引。
- 角色目录中的子目录和非 JSON 文件不属于角色实体，可忽略。直属 JSON 若 unreadable、JSON 非法、id/filename 不一致，或其 `containers` ownership projection 非法，则 ownership 无法证明，操作 fail closed。

### R1. Character equipment schema

```ts
type CharacterEquipment = Record<
  string,
  Array<{
    ref: string | null
    applied?: Record<string, number>
  }>
>
```

- object key 是非空、已 trim、最长 80 的槽位类型；每个 value 是非空数组，数组当前长度就是角色该类型的固定容量。
- Action/Skill 只能修改已存在的 `slotType + slotIndex`，不能创建类型、追加、缩短、重排容量。
- 空槽规范形态精确为 `{ "ref": null }`，不得保留 `applied` 或额外字段。
- 非空槽 `ref` 必须是 canonical item ref；`applied` 只保存该件装备当前实际贡献。
- 输出保持原有槽位类型 key 顺序、数组结构及角色 attribute key 顺序。
- 零贡献 key 省略；没有非零贡献时整个 `applied` 省略。

### R2. Item equipment schema

```ts
interface ItemEquipment {
  slotType: string
  add?: Record<string, number>
  percent?: Record<string, number>
  effects?: string[]
}
```

- `type:"equipment"` 的 item 必须有结构合法的 `equipment`；其他 item 若带该受管字段同样必须结构合法，但不能作为新装备候选。
- `slotType` 必须是非空、已 trim、最长 80 的字符串，并与目标槽位类型精确匹配。
- `add`/`percent` 的 key 只能引用目标角色已存在属性；key 非空、已 trim、最长 80，value 为安全整数。
- `effects` 只用于叙事/UI 展示，不参与数值计算；若存在必须是字符串数组。
- 删除 `item.equipment.slot`、字符串 `mods`、`+=`/`-=`/`*=`/`=`、公式和函数；不保留 fallback parser。

### R3. Numeric contract

- `attributes`、`applied`、`add`、`percent`、`refresh.attributeChanges` 都必须是安全整数；属性与贡献允许负数。
- 当前非装备基线：
  `baseline[attr] = currentAttributes[attr] - sum(oldApplied[attr])`。
- refresh 先把 `attributeChanges` 加到 baseline，再用更新后的同一 baseline 重算所有有效装备。
- 每件装备对单属性的贡献：
  `roundHalfAwayFromZero(add + abs(baseline) × percent / 100)`。
- 缺失 add/percent 视为 0；完整表达式只取整一次；`.5` 远离零。
- 所有装备读取同一 baseline，装备之间不连锁；槽位、数组、对象 key 顺序不影响数值结果。
- 实现先把安全整数转为 BigInt，使用：

```text
numerator = 100 * add + abs(baseline) * percent
magnitude = abs(numerator)
quotient = magnitude / 100
remainder = magnitude % 100
if remainder * 2 >= 100: quotient += 1
contribution = sign(numerator) * quotient
```

- BigInt 只存在于核心内部；任何 Workspace write、output、SDK 参数或 error details 构造前都必须 checked-convert 为安全整数 number。
- BigInt reduction 不因中间值超过 safe range 而提前失败；只在 recovered baseline、refresh 后 baseline、每槽 contribution、reachable quantity public value 和最终 persisted attribute 等语义 checkpoint 检查 safe range。
- 每次成功后满足 `attributes = baseline + Σ applied`。

### R4. Ownership, container graph, and quantity

- 装备实体始终留在角色独占容器图中；装备/卸装不移动或删除 item。
- 共享仓库中的 item 必须先转移到角色自己的容器图，才能装备。
- `character.containers` 若存在必须是数组；每个 root entry 精确为 `{ ref, count? }`，ref 是 canonical container ref，count 缺失视为 1、显式值只能为 1。
- target container document 的 `contents` 必须是数组；每个 entry 精确为 `{ ref, count? }`：
  - container ref 的 count 缺失视为 1、显式值只能为 1，且绝不乘算后代；
  - item ref 的 count 缺失视为 1、显式值必须为正安全整数；
  - 其他 ref type、额外字段或非法 ref/count 都是 corruption。
- target traversal 同时维护 `activeStack` 和 `completed`：命中 activeStack 是真实 cycle；命中 completed 是 diamond/repeated path，只去重、不报错。同一唯一 container 只计一次内容。
- 同一唯一 container 内重复 item entry，以及多个唯一 container 中的同 item ref 数量，都使用 BigInt 求和。
- target container entry 中 canonical item ref 即使指向缺失 item document，仍贡献 raw reachable quantity；item 是否存在/合法在 stored projection 或新候选分类阶段决定。
- 变更后的每个非空装备槽对同一 item ref 产生 1 个 demand；demand 不得超过目标角色容器图的 reachable quantity。
- 独占证明先完成 target graph，再 direct-list 全部其他 character JSON，并只遍历足以判断是否到达 target container set 的 ownership graph：
  - 外部角色 root、外部 container document 或 container edge unreadable/malformed，使 ownership 不可证明时 fail closed；
  - 外部 graph 中不与 target 相交的 cycle 可以用 active/completed 集终止，不因其本身阻塞 target 操作；
  - 外部 item document、item modifier 或 item count 不参与 container ownership 证明，只要该 entry 已明确是 canonical item ref；
  - 任一外部角色到达 target container 时返回 shared ownership corruption。
- 同一 item ref 出现在互不共享的两个角色独占图中，分别按各自 container entry 数量计数，不构成共享 container。
- 完全同质副本可共享 ref+count；有独立耐久、附魔、品质或故事身份的物品必须使用独立 ref。

### R5. Frontend Action

卡发布 `frontend-actions/equipment/action.json`，支持以下 flat input：

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

- input object 是 closed shape。equip 必须提供 canonical itemRef；unequip 不接受 itemRef，且 expectedCurrentRef 必须是 non-null canonical item ref。
- `slotIndex` 必须是 `0..Number.MAX_SAFE_INTEGER` 的安全整数；core 还验证其落在现有数组内。
- equip 可填空槽或直接替换占用槽；新旧 item 都保留在容器中。
- unequip 清空槽位；目标必须为非空槽。
- 两种操作都严格校验 `expectedCurrentRef`；不匹配返回 domain stale error，绝不覆盖新状态。
- preview 与 commit 调用同一个 pure plan/core；preview 返回计划结果但零写入，commit 在 plan/output 完整验证后只写一次 character document，替换其中 attributes/equipment，保留其他字段。
- output 返回 mode/operation、槽位 before/after ref、before/after/delta attributes 和规范化 equipment projection，使 UI 无需重算。
- Action 不提供 swap/refresh，不创建检查点，也不自动重试 runtime CAS conflict。

### R6. Stage Manager local Skill

- Skill 固定目录为 `agents/stage-manager/skills/装备管理/`，并必须在 internal/formal 两份 Stage Manager `agent.json.skills.enabled` exact-path whitelist 中加入 `agents/stage-manager/skills/装备管理/SKILL.md`；其他 Agent 不启用该 Skill。
- Skill 提供三个 browser-script action：equip、unequip、refresh。建议三个薄入口分别选择 operation，共享仅位于该 Skill 自己目录中的 `scripts/equipment-core.js`。
- equip/unequip 遵守与 Frontend Action 相同的槽位、预期 ref、持有、数量、数值和业务结果规则；shared parity suite 只覆盖两边共有的 equip/unequip，refresh 使用 Skill-only suite。
- refresh input：

```ts
interface RefreshInput {
  characterRef: string
  attributeChanges?: Record<string, number>
}
```

- `attributeChanges` 是非装备基线的增量，不是最终属性覆写；每个 key 必须已存在。
- 正常运行时 Stage Manager 对 active attributes 的变化统一通过 refresh，不再先直接编辑 attributes 再补装备。
- Skill `tsian-actions` schema 只视为 discovery metadata/浅层 guard；Skill core 自身必须完整验证 closed input/output、嵌套结构、safe integer、ref、fixed-capacity projection 和 strict JSON。
- Skill 没有 Action 的独立 snapshot/CAS/savepoint。它必须先完成所有 reads、graph/schema/arithmetic/plan/output validation，最后执行唯一一次 character write，write 后不再执行可能失败的逻辑；不得描述为与 Frontend Action 事务等价。
- Frontend Action 与 Skill 不在运行时互相调用或依赖目录外 helper，各自可随资源独立分发。

### R7. Stale projections and corrupt data

refresh 对以下结构合法的 stored stale projection 做可恢复清理：

- ref 指向不存在的 item；
- item 不在角色 target container graph 内；
- entity 不是装备；
- 有效 item 的 slotType 与槽位类型不匹配。

处理方式是先按存储值撤销旧 applied，再清槽，并继续刷新其他合法槽。

equip/unequip 对任何现有 stale projection（包括目标槽）都不静默修复，统一返回 `EQUIPMENT_REFRESH_REQUIRED` 且零写入；Frontend Action v1 不暴露 refresh，因此玩家端提示需由 Stage Manager/维护流程先 refresh 后重试。新 equip candidate 的 missing/unreachable/non-equipment/type mismatch 是请求错误，不属于 stored stale repair。`ref:null` 携带 applied 是 corrupt structure，不是 stale。

以下情况视为 corrupt data，所有操作均整体失败且零写入：

- attributes/applied/add/percent/attributeChanges 不是安全整数或结构非法；
- item equipment 的受管字段结构非法；
- add/percent/attributeChanges 指向未知属性；
- 安全整数或 public quantity 溢出；
- 可达数量不足；
- target container cycle、共享所有权，或 ownership 因 malformed root/container edge 无法证明；
- 槽位结构、count 或引用结构非法。

### R8. Error and parity contract

核心业务失败先统一为 strict-JSON-safe：

```ts
interface EquipmentBusinessFailure {
  code: string
  message: string
  details?: JsonValue
}
```

- Action adapter 用 `tsian.action.fail(failure)` 发出，SDK 侧表现为 `FrontendActionError { kind:"domain", ... }`。
- Skill adapter 抛带稳定 `code/message/details` 的 error-like value；生产 `run_script` 会另加 transport wrapper。不得要求 raw Action/Skill envelope 相同。
- parity normalizer 只剥离 Action domain wrapper、Skill `run_script` wrapper/correlationId，再精确比较 canonical `{ code, details }`；普通 throw、runtime CAS/abort/timeout/schema transport failure 不伪装成业务 parity error。
- error details 至少把可安全展示的 `characterRef`、`slotType`、`slotIndex` 等放入 details，不泄露文件内容、raw path 或 stack。数组 diagnostics canonical sort。
- 至少区分：character/item not found、invalid data、slot not found、expected ref mismatch、item not reachable、slot type mismatch、quantity exhausted、refresh required、unknown attribute、overflow、container cycle/shared ownership。
- domain validation precedence 固定为：input/ref → character/equipment structure → attributes/old applied → target slot/expected ref → target graph → foreign ownership proof → all stored projection classification → requested candidate → resulting quantity → arithmetic/output normalization。
- 建立 canonical black-box suites：shared equip/unequip suite 同时运行 Action 与 Skill；Skill-only refresh suite 单独覆盖 attributeChanges/stale cleanup。
- shared suite 对相同输入深比较规范化 success output、business error 和 staged writes；runtime CAS/abort/timeout/schema transport error 留在 runtime suite。
- 必含一次取整反例：baseline=1、add=2、percent=-50 的贡献是 2，不是 1。

### R9. Action manifest schema

- input `oneOf` 使用两个 fixed closed objects；string 的完整 canonical 规则由 core 再验证。
- `slotIndex` 以及所有 output number schema 显式使用 `minimum:-9007199254740991` / `maximum:9007199254740991`；JSON Schema `integer` 不替代 `Number.isSafeInteger` core check。
- `additionalProperties:false` 只用于 fixed wrapper、slot 和 cleared-slot objects。
- attribute/add/percent/applied 等动态数值 map 使用 schema-valued `additionalProperties`；可配合 `propertyNames` 限制非空/trim/长度。
- `equipment` 使用 schema-valued `additionalProperties` 映射到 non-empty slot arrays。固定容量是“保持当前角色每个数组长度不变”的运行时不变量，不是 manifest 中一个全局 `maxItems` 常量；manifest 约束 `minItems:1`，core 精确比较 before/after 长度。
- slot schema 用 `oneOf` 表示 exact `{ref:null}` 或 `{ref:itemRef, applied?}`；不允许远程 ref、`$id`、anchor 或 runtime 不支持 vocabulary。

### R10. Canonical fixtures and resource synchronization

- 一份 canonical fixture document 同时驱动 internal-materialized 与 formal-card 资源；测试不能执行手抄的 production script 副本。
- `shared-mutation` case 自动运行：internal/formal Action preview、Action commit、Skill；`skill-refresh` case 自动运行 internal/formal Skill。case 不提供 target-specific skip 开关。
- 每次 execution 使用 fresh Workspace transaction。Action preview staged writes 必须为空；Action commit/Skill mutation 与 expected state changes 精确一致；失败零写入。
- fixture workspace/state change content 明确区分 JSON value 与 text encoding，不把文件文本误标成已解析 JsonValue。
- harness 只归一化 mode/transport wrapper/error envelope/write wrapper；不得归一化不同 attributes、slot、ownership decision、error code/details 或最终 document。
- internal default Workspace materialization 与 formal Workspace 的 equipment Action/Skill/schema docs 做 byte parity；formal-specific Stage Manager orchestration 差异只能出现在 explicit exception list。
- Action helper 只能位于 Action root 并通过 static literal `importScripts`；Skill helper 只能位于 Skill tree。两边不得共享 production core。

### R11. Schema and prompt synchronization

全量切换以下产品表面，不留下旧格式描述：

- 内部 AIRP schema guide/reference、living `save/schema/current.md` 和实体示例；
- 内部默认 Workspace 的装备 Frontend Action、Stage Manager 本地 Skill、模板及维护约束；
- 正式卡 AIRP 文档、装备 Frontend Action、Stage Manager Agent/Skill；
- 正式卡 workspace inventory。

Schema 文档必须说明 canonical ref、固定容量、持有/数量、baseline/applied invariant、refresh 清理与 corrupt fail-closed。现有未知 `extensions.render` warn-and-hide 规则不得回退。Stage Manager 不再通过 generic edit 手工维护装备投影。

### R12. Game frontend UX

- 在 `apps/play-frontend-dev` 的现有“角色 / 物品”布局中增加装备候选、属性预览、确认装备与卸装，不重做桌面/移动壳层。
- parser 只接受新 schema，无 legacy fallback。角色其他字段合法但 equipment 损坏时，角色主体仍可展示；装备区域标记不可用并禁用交互，不把损坏投影静默转为空。
- entity/inventory load result 至少区分 missing、read-failed、invalid-json、wrong-entity-type、schema-corrupt。
- 点击空槽或占用槽均可打开 Dialog；占用槽允许直接替换，不拆成前端 unequip+equip。
- 前端递归 inventory discovery 仅生成候选展示与 read-path invalidation metadata；不能成为 ownership/count/type/arithmetic authority，Action 会重新验证所有业务约束。
- preview 必须调用 `tsian.card.runAction("equipment", ...)`，不能在 Vue/parser 中复制公式。
- preview 使用 AbortController + generation guard；选择/角色/槽位变化、相关 mutation、Dialog 关闭或卸载会取消旧 preview，旧响应不得覆盖新状态。
- commit 请求从已接受 preview 的 immutable identity 构造，只把 mode 改为 commit；不能重新从当前 UI 推导 expectedCurrentRef。
- commit pending 时禁止重复提交。mutation event 可能早于 commit success response：event 可使 preview stale，但不能据此 abort 已发送 commit；abort 不证明 durable write 未发生。
- runtime CAS conflict 或 domain expected-ref mismatch 都触发 authoritative reread，要求 fresh preview，不自动重试 commit。
- refresh-required 明确提示需先完成场记维护/刷新，当前玩家 UI 不伪装成已修复；其他 corrupt 错误明确失败，不显示 raw path/schema/internal code。
- Action output 只用于即时 preview/result；commit 后仍重读 authoritative character/container/item paths，并以重读数据更新 UI。
- Dialog 保持 focus trap、initial focus、Escape、return focus、keyboard list navigation、visible focus 和 live error announcement；不可用候选可被键盘/辅助技术发现并说明原因。

### R13. Packaging boundary and inventory

- 本任务更新开发前端和正式卡 Workspace，不手工改写 `cards/沉浸阅读器.tsian-card/frontend/**`；`frontendFiles` 保持不变。
- 重建正式卡 `workspaceFiles` 前先 deep-snapshot manifest、frontendFiles、coverFiles、exportedAt 和 exporter metadata。
- inventory 从实际 `workspace/**` raw bytes 递归生成，path lexicographic sort，size 使用 UTF-8/raw byte length，不使用 JavaScript `string.length`；mediaType 使用平台统一 path inference。
- 重建只替换 `workspaceFiles`，并验证 disk/manifest 一一对应、无重复/orphan、size/mediaType 正确以及所有保护子树 deep-equal。
- 后续通过既有导入/打包流程更新成品前端；本 child 不声称当前正式卡 dist 已有换装 UI。

## Acceptance Criteria

- [ ] 所有运行时、模板、文档和前端 parser 只接受新类型分组数组与 add/percent，无旧 schema fallback。
- [ ] canonical ref/path/document identity、direct character discovery 和 target/foreign ownership proof 按 R0/R4 fail closed。
- [ ] Action preview/commit 与 Skill equip/unequip/refresh 实现固定容量、expected ref 和 no-swap 规则。
- [ ] 公式使用 BigInt 精确执行且只取整一次，顺序变化不改变结果，所有外部值为安全整数 number。
- [ ] 持有数量、重复路径、跨角色共享、真实 cycle、ownership indeterminate、stale projection 与 corrupt data 行为符合契约。
- [ ] Action manifest 能被最终 runtime strict Ajv 编译；dynamic maps、slot union 和 safe-integer bounds 与 core 一致。
- [ ] 空槽、零 applied 和 key/array 顺序按规范输出，角色其他字段不被改写。
- [ ] canonical shared equip/unequip vectors 对 internal/formal 两份 Action+Skill 全部通过；Skill-only refresh vectors 覆盖 attributeChanges、stale cleanup、拒绝、溢出和舍入边界。
- [ ] Action/Skill raw errors 保持各自 runtime 形状，但 normalized `{code,details}` 和 staged writes 在 shared cases 精确一致。
- [ ] Skill 在唯一 write 前完成所有可失败工作，失败测试证明零 staged write；Skill 只对 Stage Manager 可见。
- [ ] 开发前端可完成选择、preview、commit、replace 和 unequip；损坏 equipment 不隐藏角色主体但禁用装备操作；移动/桌面及可访问性通过浏览器检查。
- [ ] Stage Manager 指令把普通属性变化收敛到 refresh，AI-facing 表面无旧 slot/mod/operator 规则。
- [ ] 正式卡 workspaceFiles 与 raw disk bytes 完全一致，新增 Action/Skill 被打包，frontend/**、frontendFiles、coverFiles/包元数据不被误改。
- [ ] runtime child 的 Action transaction/CAS/security tests 继续通过；equipment focused tests、相关 builds 和 `git diff --check` 通过。

## Out of Scope

- `baseAttributes`、表达式语言、跨属性公式、装备连锁或随机词条结算。
- 槽位显示名称字段、swap、自动扩容、多类型兼容、共享仓库直接装备。
- 自动 checkpoint、回合 history 或旧 schema migration。
- 正式卡 packaged frontend 的手工同步。
