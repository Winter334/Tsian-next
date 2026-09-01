# 角色类型选择体验优化：技术设计

## 1. 边界

本次只改动游戏卡开发前端的角色类型选择页和 `.trellis/spec/guides/`。不改变 `CharacterBranch`、`startOpeningInterview`、开局状态机、Agent 访谈、存档协议或卡 workspace。

权威文件：

- `apps/play-frontend-dev/src/components/setup/step2/OpeningBranchChoice.vue`
- `apps/play-frontend-dev/src/components/setup/SetupWizard.vue`
- `.trellis/spec/guides/player-facing-product-copy.md`（新增）
- `.trellis/spec/guides/index.md`

## 2. 页面内容

`OpeningBranchChoice.vue` 使用 PRD 中确认的直接系统文案。文本只回答“当前要选什么”和“两个选项是什么”，不解释问答、表单、后续步骤或内部建模。

卡片继续使用原生 `button`，点击即发出既有 `canon` / `original`；不增加本地 selected 状态、确认按钮或异步逻辑。

## 3. 卡片结构与视觉

每张卡片由四层信息组成：

1. 功能标记：`原` / `创`，作为视觉锚点；
2. 类型标题：`原著角色` / `原创角色`；
3. 一句直接说明；
4. 功能性选择提示，用于强化整卡可点击性，但不引入叙事文案。

CSS 保持局部 scoped，不新增图片资源或依赖：

- 使用现有 `--void-deep`、`--line*`、`--ember*`、`--prose*` 和字体 token；
- 通过多层暗色渐变、内外阴影、伪元素边角/高光和低透明度背景标记增加层次；
- 两卡使用同一强调色和同等尺寸，不制造推荐态；
- hover 提升边框、高光和轻微位移；`:focus-visible` 使用清晰外轮廓；`:active` 回收位移；
- `prefers-reduced-motion: reduce` 关闭非必要过渡；
- 桌面保持双列，窄屏改为单列并收紧高度/间距，避免动作栏遮挡。

不新增 GSAP 入场动画；现有 `SetupWizard` 页面过渡已足够，避免装饰动画增加维护和 reduced-motion 负担。

## 4. 同屏动作栏

`SetupWizard` 的动作配置允许主操作标签为空；角色类型页不渲染禁用的“选择上方角色类型”按钮，只保留“返回目录”。其他子页面的动作栏行为不变。

该调整仅移除冗余提示，不改变卡片点击后立即进入访谈的时机。

## 5. 玩家可见文案规范

新增 `player-facing-product-copy.md`，至少包含：

- 受众边界：UI 文案服务于用户当前理解、行动、状态与风险判断；
- 禁止项：开发决策、历史方案对比、内部阶段、实现机制、无行动价值的技术术语；
- 必要例外：当机制直接影响等待、成本、不可逆结果、权限、隐私或故障恢复时，应以用户结果而非技术因果解释；
- 判断清单：删除该句是否影响正确操作，信息是否稳定，是否能改写成用户可观察结果；
- 当前页面对应的正反例；
- 与 AI-facing `prompt-self-contained-and-tone.md` 的职责区分。

指南加入 `.trellis/spec/guides/index.md`，作为后续产品 UI 开发和审查的按需指南。本任务不据此批量审计其他页面。

## 6. 验证与回滚

验证：

- `npm run build:play-frontend`
- `git diff --check`
- 本地浏览器检查桌面与窄屏：文案、双列/单列、hover、键盘焦点、按下反馈、返回入口和卡片直接进入访谈；
- `npm run package:frontend`，确认源码包仍能生成且包含改动后的两个 Vue 文件；
- 搜索旧文案，确认只在任务记录中保留，不再出现在运行源码。

回滚只需恢复两个 Vue 文件和新增/索引的 spec 文档；没有数据迁移或运行时状态兼容问题。
