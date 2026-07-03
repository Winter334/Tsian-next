# Implementation Plan: 小说 AIRP 角色设定向导 Step 3

## Preconditions

- PRD + design 已审阅
- `trellis-before-dev` 加载 platform-web / play-frontend-dev spec
- `play-frontend-dev` 构建环境可用

## Ordered Checklist

### 1. 扩展 useSetupState 状态机

- [ ] 新增 `characterBranch` / `selectedCharacter` / `characterSetupStatus` 状态
- [ ] 新增 `setCharacterBranch(branch)` 操作（UnderstandingReady select 时调用）
- [ ] 新增 `confirmCanonCharacter(candidate)` 操作（写入 runtime.json）
- [ ] 新增 `confirmOriginalCharacter(formData)` 操作（写实体 + runtime.json）
- [ ] 新增 `resetCharacterSetup()` 操作（返回修改时重置）
- [ ] `initialize()` 扩展：读取 `runtime.json`，player.character 非null → confirmed
- [ ] `goToStep(3)` 时根据 characterBranch + characterSetupStatus 决定子屏

### 2. SetupWizard 路由 + action bar 扩展

- [ ] step 3 的 stage-content 根据 characterBranch + characterSetupStatus 渲染对应组件
- [ ] action bar 配置：CanonCharacterSelect / OriginalCharacterForm / CharacterConfirmed 三种
- [ ] Transition key 用 `step3-${characterBranch}-${characterSetupStatus}` 保证切换动画

### 3. CanonCharacterSelect.vue

- [ ] props: `candidates: OpeningCandidateCharacter[]`
- [ ] emit: `select(candidate)` / `back`
- [ ] 竖向列表，每行标记字 + name + brief + 四角括号
- [ ] 选中高亮（border-color `--ember-bright`）
- [ ] GSAP fromTo 进场动画
- [ ] candidates 为空时显示提示 + 引导回分支
- [ ] 复用 tokens.css 变量，branch-card 视觉模式

### 4. OriginalCharacterForm.vue

- [ ] 必填：角色名（input）、一句话简介（input）
- [ ] 可选折叠：外貌（textarea）、性格（textarea）、背景（textarea）
- [ ] emit: `submit(formData)` / `back`
- [ ] 必填校验 → emit 时传完整 formData
- [ ] 输入框烛火风格（border `--line-strong`，bg 微暖底色）

### 5. CharacterConfirmed.vue

- [ ] props: `character: { ref, name, brief }`
- [ ] emit: `back` / `next`
- [ ] 居中角色名片（branch-card 样式）
- [ ] "已选定角色"提示文案

### 6. workspace 读写实现

- [ ] `readRuntimeJson(tsian)`: 读 `save/playthrough/runtime.json`，返回 parsed object
- [ ] `writePlayerCharacter(tsian, ref, name)`: read-modify-write runtime.json
- [ ] `writeOriginalCharacterEntity(tsian, localId, entity)`: 写实体文件
- [ ] `ensureUniqueLocalId(tsian, name)`: list `save/entities/character/` + 序号后缀

### 7. UnderstandingReady 对接

- [ ] `UnderstandingReady` 的 `select` emit 传递到 `useSetupState.setCharacterBranch`
- [ ] 确保从 Step 3 "返回分支"能回到 UnderstandingReady

### 8. 构建验证

- [ ] `npx vite build` (play-frontend-dev) 通过
- [ ] 手动验证：canon 分支选择流程
- [ ] 手动验证：original 分支创建流程
- [ ] 手动验证：确认屏 → Step 4 stub
- [ ] 手动验证：重载恢复

## Validation Commands

```bash
cd apps/play-frontend-dev && npx vite build
```

## Risky Files

- `useSetupState.ts` — 模块级单例，状态扩展需注意不破坏现有 step 1-2 流程
- `SetupWizard.vue` — action bar 配置已较复杂，新增三种分支配置需仔细
- `UnderstandingReady.vue` — 修改 emit 对接需保持现有分支选择行为不变

## Rollback Points

- 每个 .vue 组件独立，可单独回滚
- useSetupState 扩展是新增字段，不修改现有字段，回滚安全
