# 角色形象上传与持久化

## Goal

支持玩家在角色卡中上传角色形象图片并持久化，替代当前 MVP 的首字占位。让角色卡的固定立绘栏能展示真实角色视觉，提升 RPG 档案感与玩家代入感。

## Background

`07-04-present-characters-character-cards` 任务已实现角色卡全屏视图，其中 `CharacterPortrait.vue` 是 3:4.15 比例的固定立绘栏，MVP 阶段无图片时使用首字占位 + 暗色仪式风边框/微光。本任务把"图片上传/持久化"补齐。

核心约束：现有 `tsian.workspace.write` 只接受 string，二进制上传需要后续专门设计 platform action 或扩展 bridge。本任务必然涉及 platform-web 侧改动，不只是前端 UI。

## Confirmed Direction（来自 07-04 PRD D6）

- 概况标签页左侧放较大的角色形象区（3:4.15 比例），目标是 RPG 立绘/档案主视觉感。
- MVP 无图片时使用首字占位（已在 07-04 完成）。
- 图片上传/持久化不在 07-04 实现；现有 `tsian.workspace.write` 只接受 string，二进制上传需要专门设计 platform action 或扩展 bridge。

## Requirements

- R1: 设计二进制图片写入能力：扩展 `tsian.workspace.write` 接受 binary content，或新增 platform action 专门处理角色形象上传。
- R2: 持久化路径设计：图片存到 workspace 哪里（例如 `save/entities/character/<localId>.portrait.png` 或单独的 blob 存储）；与 entity json 的关系（entity 引用图片路径还是内嵌）。
- R3: 角色卡 `CharacterPortrait.vue` 在有图片时展示图片，无图片时回退首字占位（保留现有降级）。
- R4: 上传 UI 入口（按钮/区域）设计：不破坏角色卡视觉，符合烛火书卷·重铸主题。
- R5: 图片尺寸/格式约束：限制上传大小、支持格式（png/jpg/webp）、自动缩放/裁剪到 3:4.15 比例。
- R6: 玩家 persona 与 NPC 的上传权限：玩家角色可上传；NPC 是否允许玩家上传（默认建议只读，由 world-architect/stage-manager 维护）。
- R7: 不在本任务实现：AI 生图集成、多套形象切换、形象历史版本。

## Acceptance Criteria

- [ ] 二进制写入能力设计文档化（platform action 或 bridge 扩展形态）。
- [ ] 玩家可以在角色卡上传角色形象图片，图片持久化到 workspace。
- [ ] 重新打开角色卡时图片能加载展示。
- [ ] 无图片时仍展示首字占位（不破坏现有 MVP 降级）。
- [ ] 上传有大小/格式约束与错误提示。
- [ ] 通过 `npm run build --workspace play-frontend-dev` 与 `npm run build:web`。

## Out of Scope

- AI 生图集成。
- 多套形象切换。
- 形象历史版本。
- NPC 上传权限完整策略（先聚焦玩家角色）。

## Dependencies

- 依赖 `07-04-present-characters-character-cards`（已归档，提供 CharacterPortrait 占位与角色卡壳）。
- 涉及 platform-web bridge 扩展，可能与 platform storage 层改动耦合。

## Notes

- 本任务在父任务 `07-03-play-frontend-status-bar` Child Task Map 中的位置：在 `07-04-containers-inventory-item-details` 之后、状态栏钉选任务之前/并行均可。
- 实施前需要先和用户讨论二进制写入能力的 platform 设计方向（bridge 扩展 vs platform action）。
