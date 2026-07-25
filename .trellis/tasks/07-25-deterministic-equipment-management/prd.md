# 确定性装备管理与换装 UI

## Goal

直接替换尚未上线的临时装备 Schema，并以卡内 Frontend Action 和 Stage Manager 本地 Skill 提供确定、原子、可预览的换装能力；开发游戏前端只消费 Action 结果，不复制装备算法。

## Background

- 当前文档、模板和角色前端使用的是动态槽位名、`item.equipment.slot` 与字符串 `mods` 的临时结构。
- 该结构尚未上线，不保留兼容 parser、迁移脚本或双写。
- 通用 `07-25-card-frontend-action-runtime` 必须先完成并归档；本任务不自行实现桥接、事务或权限旁路。
- Frontend Action 与 Stage Manager Skill 为两个可独立分发的卡资源，因此各自包含确定性核心；shared equip/unequip 黑盒向量约束两者一致，refresh 由 Skill-only 向量约束。

## Requirements

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

- object key 是槽位类型；数组长度是角色该类型的固定容量；下标只作为 Action 地址。
- Action 只能修改已存在的 `slotType + slotIndex`，不能创建类型、追加或缩短容量。
- 空槽规范形态是 `{ "ref": null }`，不得保留 `applied`。
- 非空槽 `ref` 必须是 item ref；`applied` 只保存该件装备当前实际贡献。
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

- 装备 item 的 `slotType` 与目标类型精确匹配。
- `add`/`percent` 的 key 只能引用目标角色已存在属性。
- `effects` 只用于叙事/UI 展示，不参与数值计算。
- 删除动态槽位名称对象、`item.equipment.slot`、字符串 `mods`、`+=`/`-=`/`*=`/`=`、公式和函数；不保留 fallback parser。

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

- baseline、贡献求和和最终属性转回 JSON number 前都必须在安全整数范围内，否则整次失败。
- 每次成功后满足 `attributes = baseline + Σ applied`。

### R4. Ownership and quantity

- 装备实体始终留在角色独占容器图中；装备/卸装不移动或删除 item。
- 共享仓库中的 item 必须先转移到角色自己的容器图，才能装备。
- 递归遍历角色根容器及嵌套容器；检测循环；同一容器经多条路径到达时只计一次。
- 角色容器 entry 指向嵌套 container 时 count 缺失视为 1，显式值只能为 1；不允许用 container ref count 乘算其内容。
- item entry 缺失 count 视为 1；显式 count 必须是正安全整数，同一唯一容器内重复 item entry 及多个唯一容器中的同 ref count 求和。
- 同一 item ref 的每个非空装备槽消耗 1 个数量，结果 demand 不得超过目标角色容器图的可达总量。
- 同一容器经目标角色图多条路径到达只计一次；仅遍历其他角色图到足以证明其与目标 reachable container set 是否重叠，无关角色自身缺陷不阻塞目标操作。
- 同一 container 归属多个角色是损坏；同一 item ref 出现在互不共享的两个角色独占图中，分别按各自实体 entry 数量计数，不构成共享 container。
- 完全同质副本可共享 ref+count；有独立耐久、附魔、品质或故事身份的物品必须使用独立 ref。

### R5. Frontend Action

卡发布 `frontend-actions/equipment/action.json`，支持以下 flat input：

```ts
interface EquipmentActionInput {
  mode: "preview" | "commit"
  operation: "equip" | "unequip"
  characterRef: string
  slotType: string
  slotIndex: number
  expectedCurrentRef: string | null
  itemRef?: string
}
```

- equip 必须提供 itemRef；unequip 不接受 itemRef。
- equip 可填空槽或直接替换占用槽；新旧 item 都保留在容器中。
- unequip 清空槽位；目标必须为非空槽。
- 两种操作都严格校验 `expectedCurrentRef`；不匹配返回 conflict/stale 类错误，绝不覆盖新状态。
- preview 与 commit 调用同一个 pure plan/core；preview 返回计划结果但零写入，commit 原子替换角色的 attributes/equipment。
- output 返回 mode/operation、槽位 before/after ref、before/after/delta attributes 和规范化后的 equipment projection，使 UI 无需重算。
- 不提供 swap；不创建检查点。

### R6. Stage Manager local Skill

- 只在 Stage Manager agent-local scope 发布装备管理 Skill，其他 Agent 看不到。
- Skill 提供 browser-script actions：equip、unequip、refresh。
- equip/unequip 遵守与 Frontend Action 相同的槽位、预期 ref、持有、数量、数值和原子性规则；shared parity suite 只覆盖两边共有的 equip/unequip，refresh 使用 Skill-only suite。
- refresh input 可选：

```ts
interface RefreshInput {
  characterRef: string
  attributeChanges?: Record<string, number>
}
```

- `attributeChanges` 是非装备基线的增量，不是最终属性覆写。
- 正常运行时 Stage Manager 对 active attributes 的变化统一通过 refresh，不再先直接编辑 attributes 再补装备。
- Frontend Action 与 Skill 不在运行时互相调用或依赖目录外 helper，各自可随资源独立分发。
- Skill 目录固定为 `agents/stage-manager/skills/装备管理/`，internal template 与 formal card 使用同一路径。

### R7. Stale projections and corrupt data

refresh 对以下 stale projection 做可恢复清理：

- ref 指向不存在的 item；
- item 不在角色容器图内；
- entity 不是装备；
- 有效 item 的 slotType 与槽位类型不匹配。

处理方式是先按存储值撤销旧 applied，再清槽，并继续刷新其他合法槽。

equip/unequip 对任何现有 stale projection（包括目标槽）都不静默修复，统一返回 `refresh required` 且零写入；Frontend Action v1 不暴露 refresh，因此玩家端提示需由 Stage Manager/维护流程先 refresh 后重试。新 equip candidate 的 missing/unreachable/non-equipment/type mismatch 是请求错误，不属于 stored stale repair。`ref: null` 携带 applied 是 corrupt structure，不是 stale。

以下情况视为 corrupt data，所有操作均整体失败且零写入：

- attributes/applied/add/percent/attributeChanges 不是安全整数或结构非法；
- item equipment 的受管字段结构非法；
- add/percent/attributeChanges 指向未知属性；
- 安全整数溢出；
- 可达数量不足；
- 容器循环或跨角色共享所有权；
- 槽位结构、count 或引用结构非法。

### R8. Error and parity contract

- 业务错误通过 runtime 的专用 domain-error envelope 传递，使用稳定 code 和 strict-JSON details；至少把可安全展示的 `characterRef`、`slotType`、`slotIndex` 等放入 details，不泄露文件内容、raw path 或 stack。
- 至少区分：not found/invalid data、slot not found、expected ref mismatch、item not reachable、slot type mismatch、quantity exhausted、refresh required、unknown attribute、overflow、container cycle/shared ownership。
- 建立 canonical black-box suites：shared equip/unequip suite 同时运行 Frontend Action core 与 Skill core；Skill-only refresh suite 单独覆盖 attributeChanges/stale cleanup。
- shared suite 对相同输入深比较规范化 success output/domain error 和 staged writes；runtime CAS/abort/timeout/schema transport error 不纳入业务 parity。
- 两个 suites 都由一份明确 fixture schema 维护，不以复制的单元期望分别漂移。
- 必含一次取整反例：baseline=1、add=2、percent=-50 的贡献是 2，不是 1。

### R9. Schema and prompt synchronization

全量切换以下产品表面，不留下旧格式描述：

- 内部 AIRP schema guide/reference、living `save/schema/current.md` 和实体示例；
- 内部默认 Workspace 的装备 Frontend Action、Stage Manager 本地 Skill、模板及维护约束；
- 正式卡 AIRP 文档、装备 Frontend Action、Stage Manager Agent/Skill；
- 正式卡 workspace inventory。

Schema 文档必须说明固定容量、持有/数量、baseline/applied invariant、refresh 清理与 corrupt fail-closed。现有未知 `extensions.render` warn-and-hide 规则不得回退。

### R10. Game frontend UX

- 在 `apps/play-frontend-dev` 的现有“角色 / 物品”布局中增加装备候选、属性预览、确认装备与卸装。
- 点击装备槽可选择与 slotType 匹配且在当前角色容器图可达的候选；占用槽允许直接替换。
- preview 必须调用 `tsian.card.runAction("equipment", ...)`，不能在 Vue/parser 中复制公式。
- 确认时以预览时读取的 current ref 作为 expectedCurrentRef；成功后使用 Action output 并使角色/容器相关读取失效。
- conflict 时重新读取并给出可恢复重试提示；`refresh-required` 明确提示需先完成场记维护/刷新，当前玩家 UI 不伪装成已修复；其他 corrupt 错误明确失败。
- preview 使用 AbortController + generation guard；选择/角色/槽位变化、相关 mutation、Dialog 关闭或卸载会取消旧请求，旧响应不得覆盖新状态。
- commit pending 时禁止重复提交；相关 mutation 或 conflict 使 preview 失效，authoritative reread 后必须重新 preview，不自动重试 commit。
- Action output 只用于即时 preview/result；commit 后仍重读 authoritative character/container/item 路径，并清理 mutation listener。
- 保持桌面/移动双轨布局、Dialog focus trap/initial focus/Escape/return focus、键盘 list navigation、live error announcement 和现有独立滚动行为。
- 遵守上一轮确定的发布边界：本任务更新开发前端和正式卡 Workspace，不手工改写正式卡 `frontend/**`；`frontendFiles` 保持不变，后续通过既有导入/打包流程更新成品前端。

## Acceptance Criteria

- [ ] 所有运行时、模板、文档和前端 parser 只接受新类型分组数组与 add/percent，无旧 schema fallback。
- [ ] Action preview/commit 与 Skill equip/unequip/refresh 实现固定容量、expected ref 和 no-swap 规则。
- [ ] 公式使用 BigInt 精确执行且只取整一次，顺序变化不改变结果，所有输出为安全整数。
- [ ] 持有数量、重复路径、跨角色共享、循环、stale projection 与 corrupt data 行为符合契约。
- [ ] 空槽、零 applied 和 key/array 顺序按规范输出，角色其他字段不被改写。
- [ ] canonical shared equip/unequip vectors 对两个自包含核心全部通过；Skill-only refresh vectors 覆盖 attributeChanges、stale cleanup、拒绝、溢出和舍入边界。
- [ ] 开发前端可完成选择、preview、commit、replace 和 unequip，移动/桌面及可访问性通过浏览器检查。
- [ ] Stage Manager 指令把普通属性变化收敛到 refresh，其他 Agent 不可见本地 Skill。
- [ ] 正式卡 workspaceFiles 与磁盘完全一致，新增 Action/Skill 被打包，frontendFiles/coverFiles/包元数据不被误改。
- [ ] runtime child 提供的 Action transaction/CAS/security tests 继续通过；equipment focused tests、相关 builds 和 `git diff --check` 通过。

## Out of Scope

- `baseAttributes`、表达式语言、跨属性公式、装备连锁或随机词条结算。
- 槽位名称、swap、自动扩容、多类型兼容、共享仓库直接装备。
- 自动 checkpoint、回合 history 或旧 schema migration。
- 正式卡 packaged frontend 的手工同步。
