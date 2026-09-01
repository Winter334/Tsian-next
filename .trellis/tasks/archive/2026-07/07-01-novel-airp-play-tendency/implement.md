# 小说 AIRP 游玩设定对话 Step 4 — Implementation Plan

## 执行清单

### Phase 1: platform-web 后端（skill + 脚本 + 种子）

- [ ] 1.1 移除 mode.json
  - workspace-templates.ts:29 移除文件列表引用
  - workspace-templates.ts:1579 移除 README 中 mode.json 行
  - workspace-templates.ts:1583 移除 mode.json 种子模板对象
  - 验证：无残留引用（rg "mode.json" apps/platform-web/src 确认无命中）

- [ ] 1.2 新增 setup-summary.json + opening-narrative.json 种子
  - workspace-templates.ts 文件列表区域（:12-30）添加两个路径
  - 种子模板区域（:1582 附近）添加：
    - `setup-summary.json`: `{ status: "pending", summary: null }`
    - `opening-narrative.json`: `{ narrative: null, createdAt: null }`
  - README（:1579 附近）补充这两个文件说明

- [ ] 1.3 创建 play-setup-dialog skill SKILL.md
  - workspace-templates.ts 新增 `PLAY_SETUP_DIALOG_SKILL_MD` 常量
  - YAML frontmatter：name/description/appliesTo: [world-architect]
  - 正文：何时使用 → 对话原则 → 基础 checklist → 收尾阶段 → 落点写入指引 → spoiler-safe
  - tsian-actions 块：定义 commit_play_setup action
  - 参考 opening-initialization skill 结构（:547-698）

- [ ] 1.4 创建 commit-play-setup.js 脚本
  - workspace-templates.ts 新增脚本内容常量（参考 OPENING_SCRIPT_COMMON :700+ 的 isRecord/fail/parseJson 模式）
  - 脚本逻辑：
    1. 校验 openingNarrative 非空
    2. 读现有 master context.json（若存在），追加 recentTurns `{ turn:1, role:"assistant", content:openingNarrative }`
    3. 写 save/agents/master/context.json（schema tsian.agent.context.v1）
    4. 写 save/playthrough/opening-narrative.json（{ narrative, createdAt }）
    5. 写 save/playthrough/setup-summary.json（{ status:"complete", summary, createdAt }）
    6. 返回 { status:"ok" }

- [ ] 1.5 注册 skill 到 world-architect
  - workspace-templates.ts:1482 world-architect skills.enabled 添加 "skills/play-setup-dialog/SKILL.md"
  - workspace-templates.ts skill 文件写入区域（:1513-1524）添加 play-setup-dialog skill 文件 + 脚本文件

- [ ] 1.6 验证后端
  - `pnpm --filter platform-web build` 或 typecheck
  - 确认 skill 注册无冲突

### Phase 2: play-frontend-dev 前端（对话 UI + 状态）

- [ ] 2.1 新增类型定义
  - source.ts 或新文件：PlaySetupStatus、DialogMessage 类型
  - setup-summary.json / opening-narrative.json 的路径常量和读取类型

- [ ] 2.2 useSetupState 状态 + 函数
  - 新增 playSetupStatus / playSetupMessages / playSetupError ref
  - SetupSubView 类型添加 "play-setup"
  - startPlaySetupDialog()：构造初始 prompt（读 understanding-summary + runtime.json player.character）→ invokeAgent → parseStoryOptions → push agent message → 读 setup-summary 判断完成
  - sendPlaySetupMessage(input)：push user message → invokeAgent → parseStoryOptions → push agent message → 读 setup-summary
  - loadSetupSummary()：读 setup-summary.json 判断 status
  - resetPlaySetupDialog()：清空状态
  - 心跳监听：play-setup scope 的 onAgentActivity（复用 startHeartbeat 模式 :73-89）
  - goToStep(4) 改为 subView="play-setup"，idle 时自动 startPlaySetupDialog
  - goToStep(5) 保持 stub
  - completedUntil 更新

- [ ] 2.3 SetupComposer.vue（简化版 Composer）
  - 基于 Composer.vue 简化：720px 宽，textarea + ember 基线 + 发送按钮
  - 无 stop/streaming 态，disabled 时 opacity 0.5
  - Enter 发送，Shift+Enter 换行
  - emit send(text)

- [ ] 2.4 PlaySetupDialog.vue
  - 消息列表：v-for playSetupMessages → NarrativeMessage（agent）/ UserMessage（user）+ StoryOptions（options）
  - 等待态：playSetupStatus === "running" 时显示心跳 orb + sweep bar
  - 错误态：playSetupStatus === "failed" 时显示 blood-bordered 卡片 + 重试
  - 自动滚动到底部（watch playSetupMessages，post-flush）
  - 布局：720px + 24px padding，flex 滚动

- [ ] 2.5 SetupWizard.vue 接入
  - 模板新增 v-else-if="subView === 'play-setup'" 渲染块（:299-339 区域）
  - 渲染 PlaySetupDialog
  - actions computed 新增 play-setup 分支：
    - secondary "返回" → goToStep(3)
    - primary "下一步" → disabled unless playSetupStatus === "complete" → goToStep(5)

- [ ] 2.6 useTsian.ts 准备 openingNarrative（供 Step 5 使用）
  - 新增模块级 openingNarrative ref
  - 新增 loadOpeningNarrative()：读 save/playthrough/opening-narrative.json
  - 导出 readonly
  - 注：完整 StoryView 渲染 + enterPlay 接线 = Step 5 任务，本步只准备 ref + 函数

- [ ] 2.7 验证前端
  - `pnpm --filter play-frontend-dev build`
  - 确认无类型错误

### Phase 3: 端到端验证

- [ ] 3.1 手动验证对话流程
  - 新建默认游戏卡 → 导入小说 → 初始理解 → 角色设定 → 进入 Step 4
  - 确认 agent 开场白 + 选项出现
  - 点选项 / 自由输入 → agent 回复 → 多轮对话
  - 确认等待态 / 错误态正常
  - agent 补齐 checklist → 展示汇总 → 玩家确认 → commit_play_setup
  - 确认 setup-summary.json status === "complete"
  - "下一步"启用 → 推进 Step 5 stub

- [ ] 3.2 验证重载恢复
  - 对话完成后刷新 → 直接 Step 5（跳过对话）
  - 对话未完成刷新 → 重新开始对话（agent 有 contextSlot 记忆）

- [ ] 3.3 验证 workspace 落点
  - 检查 context.json recentTurns 含开局叙事
  - 检查 opening-narrative.json 含叙事文本
  - 检查 setup-summary.json status complete
  - 检查 mode.json 已移除
  - 检查对话中增量写入的 player.json/entities/schema/brief

## 验证命令

```bash
pnpm --filter platform-web build
pnpm --filter play-frontend-dev build
rg "mode.json" apps/platform-web/src  # 应无命中
```

## 风险文件 / 回滚点

- `workspace-templates.ts`：最大改动文件（skill + 脚本 + 种子 + mode.json 移除）。改动前确认行号，改动后 build 验证。
- `useSetupState.ts`：状态机核心，goToStep 路由改动影响全向导。回滚点：恢复 goToStep(4) 落 stub。
- `SetupWizard.vue`：模板 + actions computed 改动。回滚点：移除 play-setup 渲染块 + actions 分支。

## 后续任务（不在本任务范围）

- Step 5 开局确认 UI
- enterPlay 接线 + mode='play' 翻转
- StoryView 开局特殊渲染完整实现（本任务只准备 useTsian ref + 函数）
- 首回合回路端到端验证（master 读 context.json 开局叙事 → 输出剧情 → post-processing 维护）
