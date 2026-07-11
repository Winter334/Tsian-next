# 美化角色状态显示

## Goal

提升 play 前端中角色“当前状态”的视觉品质与详情查看体验，让角色档案里的状态从普通胶囊升级为符合暗色仪式系角色档案风格的状态札记，并通过统一弹窗查看状态详情。同时移除左侧状态栏的状态分区，让侧栏更简洁，避免与角色档案详情重复。

## Background / Confirmed Facts

- 当前角色概况页状态由 `apps/play-frontend-dev/src/components/character/StatusChips.vue` 渲染，原样式是圆角胶囊，并用 `title` 暴露 description。
- 左侧状态栏状态原由 `apps/play-frontend-dev/src/components/status-bar/StatusBarStatus.vue` 渲染，但用户明确希望整块移除侧边栏状态显示。
- 状态数据结构为 `CharacterStatus`：`id`、`name?`、`description?`、`polarity?`，其中 `polarity` 可为 `positive | negative | neutral`。
- 项目已有物品/容器详情弹窗 `ItemDetailModal.vue` 与特质详情弹窗 `TraitDetailModal.vue`，提供了遮罩关闭、关闭按钮、Escape 关闭、暗色档案卡面的既有模式。
- 用户明确倾向角色状态详情采用类似物品/容器的弹窗，而不是轻量 popover。
- 用户明确要求状态详情弹窗不要渲染“状态标记字段”等玩家无感的内部标记信息。

## Requirements

- R1：角色详情页“当前状态”不再使用难看的普通胶囊样式，应改为更精致的状态符签/札记式摘要按钮。
- R2：左侧状态栏不再展示“状态”分区。
- R3：点击角色档案中的真实角色状态时打开状态详情弹窗；弹窗交互应与物品/容器/特质详情保持一致。
- R4：状态详情弹窗应展示玩家可理解的信息：状态名、状态类型/极性、描述；缺失描述时显示明确空态文案。
- R5：状态详情弹窗不得渲染玩家无感的内部状态标记/索引字段。
- R6：`polarity` 必须继续影响摘要与弹窗视觉 tone：正面偏青绿、异常偏血珀、中性/未知偏古金或灰金。
- R7：角色详情页状态摘要中的 `PinButton` 必须保留，点击钉选不得误触发状态详情弹窗。
- R8：组件应保持 Vue `<script setup lang="ts">` 与当前 play 前端代码风格，不引入新的外部依赖。

## Acceptance Criteria

- [ ] A1：角色详情页当前状态显示为新状态札记样式，包含可辨识的状态名、tone 标记和 hover/focus 反馈。
- [ ] A2：左侧状态栏不再渲染“状态”分区。
- [ ] A3：点击角色详情页中的真实状态，会打开统一状态详情弹窗。
- [ ] A4：状态详情弹窗支持遮罩关闭、关闭按钮关闭、Escape 关闭，并带有 `role="dialog"` / `aria-modal="true"`。
- [ ] A5：状态详情弹窗不显示状态 id、索引、档案标记等内部字段。
- [ ] A6：不同 polarity 的状态在摘要和详情弹窗中有不同 tone，并保留缺省/未知 polarity 的合理视觉。
- [ ] A7：点击状态的 `PinButton` 只执行钉选，不打开详情。
- [ ] A8：`play-frontend-dev` 构建通过，或失败原因被确认与本次改动无关并如实记录。

## Out of Scope

- 不修改 `CharacterStatus` 数据结构。
- 不新增状态来源、持续时间、层数、历史记录等字段。
- 不改物品、容器、特质弹窗行为。
- 不调整角色档案页/左侧栏整体布局结构之外的功能。
