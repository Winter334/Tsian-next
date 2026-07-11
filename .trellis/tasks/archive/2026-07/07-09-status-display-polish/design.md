# Design: 美化角色状态显示

## Overview

用一个共享的 `StatusDetailModal` 承担角色档案中真实角色状态详情展示。角色详情页 `StatusChips` 维护本地选中状态，点击真实 status 时打开该弹窗。

视觉方向是“暗色档案里的状态札记”：摘要不再是普通胶囊，而是带 tone 标记、暗底渐变、内框和微光反馈的符签；详情弹窗沿用物品/特质弹窗的遮罩与卡面语言，但只展示玩家可理解的信息，不渲染内部索引/标记字段。

左侧状态栏移除“状态”分区，让侧栏只保留场景、玩家概要、个人信息、数值、钉选和关联等更适合快速浏览的内容。

## Component Boundaries

- `apps/play-frontend-dev/src/components/character/StatusDetailModal.vue`
  - 新组件。
  - 输入：`status: CharacterStatus | null`。
  - 输出：`close`。
  - 负责展示状态标题、polarity 标签、描述，并处理 Escape 关闭。
  - 不展示 `status.id`、索引、档案标记等内部字段。

- `apps/play-frontend-dev/src/components/character/StatusChips.vue`
  - 从静态 `span` chip 改为可点击状态摘要按钮。
  - 本地维护 `selectedStatus`。
  - 保留并嵌入 `PinButton`，依赖现有 `@click.stop` 避免冒泡。
  - 挂载 `StatusDetailModal`。

- `apps/play-frontend-dev/src/components/StatusBar.vue`
  - 展开态不再挂载 `StatusBarStatus`。
  - 保留 runtime tag 数据给其它现有分区使用（如 refs/metrics），但状态分区本身移除。

- `apps/play-frontend-dev/src/components/status-bar/StatusBarStatus.vue`
  - 不再由 `StatusBar.vue` 使用；为减少无效 diff，保持/恢复原有组件实现，不在本任务扩展其交互。

## Data Flow

1. 角色详情页父组件传入 `CharacterStatus[]`。
2. 用户点击角色档案中的真实状态摘要。
3. `StatusChips` 将该 `CharacterStatus` 写入本地 `selectedStatus`。
4. `StatusDetailModal` 以该状态渲染玩家可读内容。
5. 遮罩、关闭按钮或 Escape emit `close`，父组件清空 `selectedStatus`。

## Visual / Interaction Rules

- `polarity-positive`：青绿色标记、柔和绿光。
- `polarity-negative`：血珀红标记、异常/伤势语义。
- `polarity-neutral` 或缺失：古金/灰金标记。
- 摘要按钮必须有 hover 与 `:focus-visible` 反馈。
- 详情弹窗 z-index 与现有物品/特质弹窗一致使用 60。
- 不依赖浏览器 `title` 作为主要详情入口。

## Compatibility

- 不改变 `CharacterStatus` 类型和 parse 逻辑。
- 不改变钉选 target 结构。
- 不为 runtime tags 引入新的详情语义，避免错误扩展非 status 数据。

## Validation

- 构建 `play-frontend-dev`。
- 若包管理命令需要先确认，以根 `package.json` / workspace 配置为准。
