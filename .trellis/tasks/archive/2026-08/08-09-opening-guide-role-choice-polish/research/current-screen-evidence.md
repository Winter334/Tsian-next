# 角色类型选择页：现状证据与已定方向

## 当前交互与源码权威

- `apps/play-frontend-dev/src/components/setup/step2/OpeningBranchChoice.vue:8` 是角色类型页的权威组件；`:14` 和 `:19` 的原生 `button` 点击后立即发出 `canon` / `original`。
- `apps/play-frontend-dev/src/components/setup/SetupWizard.vue:123` 将 `select` 直接绑定到 `startOpeningInterview`，因此当前没有需要保留的中间选中态，也不应为美化新增确认步骤。
- `SetupWizard.vue:65` 为该页配置“返回目录”和禁用的“选择上方角色类型”。后者与卡片直接点击重复，是本次同屏文案清理的一部分。
- 上一任务已确定 `apps/play-frontend-dev/src/**` 是游戏卡前端源码权威；不要修改平台内置模板或卡目录中的早期导出前端残留。来源见 `.trellis/tasks/archive/2026-08/08-08-interview-driven-opening-modeling/research/design-resolution.md`。

## 文案问题

当前组件中：

- “这里只决定角色类型。具体人物、身份和本局偏好会在接下来的对话里逐步确认。”在向玩家解释内部流程安排，而不是帮助其做当前选择。
- “通过简短问答创建角色，不需要预先填写完整表单。”在解释被移除的旧表单与新实现方式，是开发决策残留。
- “选择上方角色类型”重复描述页面布局，而且作为禁用主按钮没有独立动作。

已确认采用普通系统界面文案：

- 区域标签：“角色设置”
- 标题：“选择角色类型”
- 说明：“选择使用小说中的已有角色，或创建一个原创角色。”
- 原著角色：“从小说已有角色中选择。”
- 原创角色：“创建一个新的原创角色。”

不使用“承接命运”“闯入世界”等风格化叙事表达。

## 视觉证据与方向

- 当前 `OpeningBranchChoice.vue:60` 只有单层暗底、细边框、编号、标题和说明，hover 仅改变边框、位移和阴影。
- `apps/play-frontend-dev/src/components/setup/step1/MethodChoose.vue:73` 已有同一向导可参考的视觉语言：暗色渐变、内阴影、标记字、四角装饰和温和微光。
- 本次允许卡片“华丽一点点”，但应保持同等权重与暗金主题；用“原 / 创”标记、层叠表面、装饰边角和克制高光增强完成度，不引入插画、外部图片或新主题。
- 必须保留原生按钮语义、可见键盘焦点、按下反馈、窄屏单列和 reduced-motion 兼容。

## 范围决定

- 只修当前角色类型页及同屏操作文案。
- 新增项目级玩家可见产品文案指南并加入 spec 索引。
- 不审计完整开局向导或全仓 UI；后续按实际发现的问题单独修正。
