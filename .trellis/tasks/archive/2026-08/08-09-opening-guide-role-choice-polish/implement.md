# 角色类型选择体验优化：实施计划

## 1. 规范落地（主会话）

- [x] 新增 `.trellis/spec/guides/player-facing-product-copy.md`，写入受众边界、禁止项、必要例外、判断清单和正反例。
- [x] 将新指南加入 `.trellis/spec/guides/index.md`，不扩展为全向导或全仓审计。
- [x] 将新 spec 补入 implementation/check 上下文清单。

## 2. 页面实现（`trellis-implement`）

- [x] 按 PRD 确认文本重写 `OpeningBranchChoice.vue`，保持 `canon` / `original` emit 契约不变。
- [x] 重构两张卡片的局部结构与样式：标记字、层叠暗金表面、装饰边角、功能性选择提示和完整交互状态。
- [x] 保持原生按钮、同等权重、双列/窄屏单列、可见 `:focus-visible` 与 reduced-motion。
- [x] 调整 `SetupWizard.vue` 动作配置，使角色类型页不显示冗余禁用主按钮，同时保留“返回目录”；其他页面行为不变。
- [x] 不新增图片资源、依赖、选中确认步骤、状态字段或访谈逻辑。

## 3. 验证

- [x] 运行 `npm run build:play-frontend`。
- [x] 运行 `git diff --check`。
- [x] 按用户要求将平台挂载态的桌面/窄屏视觉验收交由用户手动执行；自动浏览器检查已停止。
- [x] 搜索被移除的开发侧文案，确认运行源码中无残留。
- [x] 运行 `npm run package:frontend`，核对生成包包含最新 `OpeningBranchChoice.vue` 与 `SetupWizard.vue`。

## 4. 质量检查（`trellis-check`）

- [x] 检查 PRD/设计/新文案规范与实现一致。
- [x] 检查无流程、状态机、Agent、存档或非目标页面回归。
- [x] 检查视觉状态、窄屏、键盘焦点、对比度与 reduced-motion。
- [x] 检查工作区既有 `.trellis/.template-hashes.json` 和 `cards/沉浸阅读器.tsian-card.zip` 未被覆盖或纳入任务变更。

## 5. 回滚点

- UI 回滚：恢复 `OpeningBranchChoice.vue` 与 `SetupWizard.vue`。
- 规范回滚：移除新增指南及其索引行。
- 本任务没有数据迁移，回滚不触碰存档、卡 workspace 或用户产物。
