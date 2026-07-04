# 容器背包与物品详情

## Goal

支持玩家从状态栏/角色卡逐层查看背包、容器与物品详情。容器和物品使用固定 UI 精致渲染基础信息，并支持动态 extensions 字段自然融入对应槽位。

## Requirements

- R1: 支持读取 container entity，并渲染 `name`、`brief`、`capacityNote`、`status`、`contents`。
- R2: `contents` 中的 item/container ref 可作为可点击入口，打开物品卡或嵌套容器卡。
- R3: 支持 item entity 的基础详情展示：`name`、`brief`、`tags`、`status`、`fields`、`sections`、`extensions`。
- R4: 容器/物品 extensions 按渲染类型进入容量/状态/数值/详情/关联等槽位。
- R5: 未来装备槽可作为容器/slot 模型的后续扩展预留设计方向，但第一版不必完整实现装备系统。
- R6: 缺失 ref、读取失败、空容器有降级展示。

## Acceptance Criteria

- [ ] 能从 runtime 或角色卡入口打开主容器/背包。
- [ ] 能展示容器 contents 列表。
- [ ] 能点击至少一类 item ref 查看物品详情。
- [ ] 容器或物品 extensions 能按渲染类型进入对应槽位。
- [ ] 嵌套容器或读取失败不会导致 UI 崩溃。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。

## Dependencies

- 依赖 `.trellis/tasks/07-04-renderable-runtime-entity-schema`。
- 依赖 `.trellis/tasks/07-04-frontend-runtime-render-infra`。
- 建议在 `.trellis/tasks/07-04-present-characters-character-cards` 后实施。
