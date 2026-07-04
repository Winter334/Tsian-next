# 在场人物与角色卡

## Goal

扩展状态栏体验，支持从当前场景查看在场人物，并点击人物打开角色卡。角色卡使用固定 schema 精致渲染基础信息，同时把动态 extensions 字段按类型插入对应槽位。

## Requirements

- R1: 基于 `runtime.activeSceneIds` 与 `save/scenes/<localId>.json` 的 `present` 展示当前在场人物。
- R2: 在场人物列表可作为左侧状态栏/详情面板的一部分出现。
- R3: 点击人物 ref 后读取对应 character entity 并展示角色卡。
- R4: 角色卡固定渲染 `name`、`brief`、`aliases`、`status`、`fields`、`sections`。
- R5: 角色卡支持 `extensions` / `扩展`，并按渲染类型进入数值区、状态区、关联区、详情区等预留槽位。
- R6: `name` 是主显示名；aliases 仅作为详情中的替代称呼显示。
- R7: 读取失败或实体缺失时，用 scene.present/ref 的已有摘要降级展示。

## Acceptance Criteria

- [ ] 当前场景有 `present` 时，前端能显示在场人物列表。
- [ ] 点击在场人物可打开角色卡。
- [ ] 角色卡能展示固定字段和至少一种动态扩展字段。
- [ ] 动态扩展字段不会堆到单一“其它”区域，而是按 render 类型进入预留槽位。
- [ ] 缺失实体、读取失败、空 present 均有降级展示。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。

## Dependencies

- 依赖 `.trellis/tasks/07-04-renderable-runtime-entity-schema`。
- 依赖 `.trellis/tasks/07-04-frontend-runtime-render-infra`。
- 建议在 `.trellis/tasks/07-04-left-status-bar-mvp` 后实施。
