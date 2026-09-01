# 开局实体闭包复核

## 结论

container、item 与 character containers/equipment 是现有正式模型的普通组成部分，不应在开局被特殊要求或禁止。开局仍遵循“按当前内容需要建立最小充分闭包”：有真实需要就按 schema 建模，没有就不创建。

## 当前冲突

- schema guide 已定义 character `containers` / `equipment`、container contents、item 五种 type 与装备规则。
- play frontend 已有 container/item parser、角色物品栏与装备展示消费者。
- Stage Manager 已启用《装备管理》Skill，卡前端已有 equipment Frontend Action；二者使用确定性槽位、可达性、数量和属性贡献语义。
- 当前 `commit_opening` 的 `normalizeOpeningEntity` 只允许 character/location，Tool schema 也不暴露 container/item 或 character containers/equipment。
- 《开局建模》Skill 又把这一实现限制写成特殊禁止，导致小说或玩家已经确认的开局持有物无法进入 turn 0 正式模型。

## 历史原因

“访谈驱动开局建模”首版为了在一次原子 action 中完整校验 session、refs、scene/runtime/frontier、turn 0 与 receipt，把 entity 允许面缩到 character/location，并假定装备可在后续正式回合建立。这是范围控制，不是领域规则。

更早的 `commit_entities` 支持任意实体并对 container/item type 做基础检查，但没有当前所需的封闭字段、容器图、装备可达性、属性贡献和全量引用校验，不能直接恢复。

## 正常建模判据

- 内容判断与 character/location/relationship 相同：只建立当前开局成立且后续第一回合需要读取的事实。
- container/item/equipment 不进入固定问卷，不要求每局创建，也不作为特殊风险向 Agent 反复强调。
- 小说事实、玩家回答或已确认开局处境需要持有物/装备时，使用正式 entity/ref 结构；普通环境描写或没有独立状态/消费价值的物件可留在叙述中。
- relationships 仍只保存 character-to-character 社会关系；物品持有和穿戴只走 containers/equipment。
- extensions 不代替已有核心字段；未知 ref-bearing 扩展由 action schema/validator 拒绝，不在 Skill 中形成额外概念负担。

## 提交校验边界

扩展后的 `commit_opening` 至少需要在写入前完成：

- container/item/character/location 的封闭字段与 canonical id/path；
- character container roots、container contents 的 ref 与正整数 count；
- container graph 无循环，根容器不跨角色共享；
- item type 与 equipment 规则合法；
- 装备 ref 对当前角色容器图可达，数量足够，slotType 匹配；
- 装备属性只引用角色既有六维属性，使用现有确定性公式产生或验证 `applied`，所有整数保持安全；
- scene、runtime、relationship、frontier 和最终 opening reply 的既有闭包继续成立；
- 任一失败仍由同一 action transaction 零持久写入。
