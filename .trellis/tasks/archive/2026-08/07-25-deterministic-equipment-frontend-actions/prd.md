# 确定性装备与前端 Action

## Goal

让游戏卡可以向自身前端发布不经过 Agent 的确定性 Action，并以该能力实现可预览、可提交、无部分写入的玩家换装；同时为 Stage Manager 提供按需加载的本地装备管理 Skill，使 UI 与 Agent 都能准确维护同一装备 Schema。

## Background

- 当前前端只能直接读写 Workspace、调用 Agent 或调用平台硬编码 Action，不能调用卡自带的确定性能力。
- Skill/Tool 都以 Agent 为调用方；把前端能力复用进现有 Registry 会扩大受众过滤、上下文注入和 Studio 语义。
- 当前已提交装备 Schema 尚未上线，可直接切换，不需要兼容或迁移旧结构。
- 正式卡 `frontend/**` 不在本任务树内直接同步；开发前端由用户独立打包上传。父任务只保证正式卡 Workspace 中的 Action、Skill、Schema 文档与 `workspaceFiles` 路径清单完整。
- 本请求包含两个可独立验证的交付，因此拆为：
  1. `07-25-card-frontend-action-runtime`：通用 Frontend Action 平台能力。
  2. `07-25-deterministic-equipment-management`：装备 Schema、卡内 Action、场记 Skill 和换装 UI。

## Requirements

### R1. 子任务边界

- Frontend Action Runtime 子任务只提供通用发布、桥接、权限、验证、事务、冲突和通知能力，不包含装备规则。
- Equipment Management 子任务依赖前者，拥有全部装备数据、计算、Agent Skill 和 UI 语义。
- 父任务只负责跨子任务契约与最终集成验收，不直接承载产品实现。

### R2. Frontend Action 产品边界

- 卡只通过固定目录 `frontend-actions/<id>/action.json` 发布 Frontend Action；目录即显式发布，不在 `game-card.json` 维护第二份白名单。
- Frontend Action 与 Skill/Tool 分离，不进入 Agent、Skill、Tool Registry 或模型上下文。
- 前端通过语义 API `tsian.card.runAction(actionId, input, options?)` 调用。
- 平台负责严格 JSON 和输入/输出 Schema 校验、前端权限、staged transaction、失败回滚、乐观并发提交、超时/取消及成功通知。
- 默认不创建检查点，不通过现有 `platform.runAction` 或本地助手权限路径执行。

### R3. 装备数据结构

```ts
type CharacterEquipment = Record<
  string,
  Array<{
    ref: string | null
    applied?: Record<string, number>
  }>
>

interface ItemEquipment {
  slotType: string
  add?: Record<string, number>
  percent?: Record<string, number>
  effects?: string[]
}
```

- character equipment key 是槽位类型；数组长度是该角色该类型的固定容量；数组下标只用于 Action 定位，不是业务名称。
- Action 不创建类型、不追加槽位；容量变化属于角色结构维护。
- item `slotType` 与目标类型精确匹配。
- 旧的槽位名称对象、`slot`、字符串 `mods` 和运算符表达式直接删除，不兼容、不迁移。

### R4. 确定性数值规则

- 不增加 `baseAttributes`；`attributes` 是当前有效值。
- 非装备基线为当前 attributes 减去全部旧 applied。
- `attributes`、`applied`、`add`、`percent` 和 `refresh.attributeChanges` 都是安全整数，属性允许负数。
- 每件装备读取同一 baseline，互不连锁；槽位、数组和字段顺序不影响结果。
- 单件装备单属性贡献：
  `roundHalfAwayFromZero(add + abs(baseline) × percent / 100)`。
- 正 percent 始终提高值，负 percent 始终降低值；计算完整表达式后一次取整，`.5` 远离零。
- add/percent/attributeChanges 只能指向角色已有属性；未知属性、非法数值或溢出使整次操作失败。
- 最终保持 `attributes = baseline + Σ applied`；零贡献 key 和空 applied 采用统一规范化。

### R5. 持有与装备

- 装备仍位于角色独占容器图中，共享仓库物品须先转移给角色。
- 同一 item ref 的槽位占用次数不得超过角色容器图中的可达数量；完全同质物品可用 ref+count，具有独立状态的装备必须拆分 ref。
- 容器图需要循环保护；同一容器经多条路径重复可达时只计一次，不重复库存。
- 缺失 count 视为 1，显式 count 必须是正安全整数。

### R6. 操作语义

- Frontend Action 支持 preview/commit 下的 equip 与 unequip；preview 和 commit 使用同一核心，preview 不写入。
- equip 定位已有 `slotType + slotIndex`，空槽装备、占用槽直接替换，且必须提供 `expectedCurrentRef` 防止覆盖新状态。
- unequip 清空已有槽，物品留在容器中，并校验预期 ref。
- 不提供 swap；未来出现槽位拖放需求时另行设计。
- Stage Manager 本地 Skill 提供 equip、unequip、refresh；只有 Stage Manager 可见。
- `refresh.attributeChanges` 是非装备属性整数增量；正常运行中 Stage Manager 不再直接修改 attributes。

### R7. 异常与原子性

- refresh 遇到丢失/不可达 ref、非装备物品或类型不匹配时，撤销旧 applied 并清槽。
- applied/add/percent/attributeChanges 损坏、未知属性、库存不足、容器循环/共享或数值溢出时，整次失败且不写入。
- equip/unequip 不应静默清理任何陈旧投影（包括目标槽）；发现时返回需先 refresh 的错误。
- 每次成功提交完整替换角色 attributes 和 equipment，同时保留其他字段。
- 前端 Action 与 Skill 的实现各自自包含；shared equip/unequip 黑盒向量验证两者结果和错误一致，refresh 使用 Skill-only 向量。

### R8. 前端体验

- 当前只读物品模式扩展装备候选选择、属性预览、确认装备和卸装。
- 预览显示最终属性变化，但不在前端复制计算算法。
- Action 成功后刷新角色、装备与容器投影；冲突时刷新并提示重试。
- 保持既有桌面/移动响应式角色舞台、模态和可访问性行为。

## Cross-Child Acceptance Criteria

- [x] 游戏开发前端可通过 `tsian.card.runAction` 执行卡发布的 Frontend Action，且 Agent 无法发现该资源。
- [x] Frontend Action 的失败、超时、取消、输出非法或并发冲突均不留下 Workspace 部分写入。
- [x] 远程前端不能通过 `platform.runAction` 获得本地助手 Workspace 权限。
- [x] 装备 Schema 全链路切换为类型分组数组和 add/percent，无旧格式兼容残留。
- [x] UI preview/commit 与 Stage Manager Skill 对 shared equip/unequip 向量一致；Skill-only refresh 向量独立通过。
- [x] equip/unequip/refresh、库存数量、异常清槽、数据损坏和 attributeChanges 行为符合要求。
- [x] 两个子任务均已通过构建/测试/规范门禁并归档；正式卡 Workspace 的装备 Action、Stage Manager 装备 Skill、Schema 文档和 `workspaceFiles` 路径清单完整，无缺失、孤儿或重复项。

## Out of Scope

- 通用表达式语言、跨属性公式、装备连锁、`baseAttributes`。
- swap、多类型兼容、槽位继承、自动扩容、共享库存直接装备。
- 每次换装自动创建检查点。
- 旧装备 Schema 兼容与迁移。
- 将 Frontend Action 开放给 Agent 或动态枚举生成 UI。
- 直接修改、导入、构建或导出正式卡 `frontend/**`；用户从开发前端独立打包上传。

## Completion Review (2026-08-07)

- `07-25-card-frontend-action-runtime` 与 `07-25-deterministic-equipment-management` 均已归档完成。
- `npm run test:equipment` 通过：3 files / 256 tests。
- 正式卡 Workspace 的 129 个实际文件与 `game-card.json.workspaceFiles` 的 129 条路径一一对应；无缺失、孤儿或重复。
- 装备 Action/Skill 的 8 个必需文件全部存在，Stage Manager 已启用 `agents/stage-manager/skills/装备管理/SKILL.md`。
- `workspaceFiles.size` 不作为本父任务归档门禁：仓库当前同时存在以 CRLF working-tree bytes 和 LF canonical bytes 记录的历史条目；本次按用户确认的产品边界只验证 Workspace 内容与路径完整性。
