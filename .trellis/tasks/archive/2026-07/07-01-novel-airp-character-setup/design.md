# Design: 小说 AIRP 角色设定向导 Step 3

## Architecture

Step 3 在 `apps/play-frontend-dev` 内实现，遵循现有向导架构：

```
SetupWizard.vue (壳: stepper + stage + action bar)
  └─ stage-fade Transition
       └─ step3 子屏 (新增)
            ├─ CanonCharacterSelect.vue   (原著角色竖向列表)
            ├─ OriginalCharacterForm.vue  (原创角色表单)
            └─ CharacterConfirmed.vue     (已选定角色确认屏)
```

`useSetupState` 扩展：新增 `characterBranch`（canon/original）、`selectedCharacter`（已确认角色 ref）、`characterSetupStatus`（selecting/confirmed）。

## Data Flow

### 进入 Step 3

1. `UnderstandingReady` emit `select("canon"|"original")` → `goToStep(3)`
2. `useSetupState` 存储 `characterBranch`
3. `SetupWizard` 根据 `characterBranch` + `characterSetupStatus` 渲染对应子组件

### 原著角色选择流程

```
candidateCharacters (from understandingSummary)
  → CanonCharacterSelect 竖向列表
  → 玩家选中一行 → 高亮
  → action bar "确认选择" → confirmCharacter(candidate)
  → 写入 runtime.json player.character = { ref: candidate.id, name: candidate.name }
  → characterSetupStatus = "confirmed"
  → 渲染 CharacterConfirmed 确认屏
```

### 原创角色创建流程

```
OriginalCharacterForm 表单
  → 玩家填入 name(必填) + brief(必填) + appearance/personality/background(可选)
  → action bar "创建角色" → createOriginalCharacter(form)
  → 生成 localId = "original-" + name（冲突加序号）
  → 写入 save/entities/character/original-<name>.json（实体文件）
  → 写入 save/playthrough/runtime.json player.character = { ref, name }
  → characterSetupStatus = "confirmed"
  → 渲染 CharacterConfirmed 确认屏
```

### 重载恢复

1. `useSetupState.initialize()` 已读取 `understandingSummary`
2. 新增：读取 `runtime.json`，若 `player.character` 非null → `characterSetupStatus = "confirmed"` → 直接显示确认屏
3. 若 `player.character` 为null 但 `understandingStatus === "ready"` → 显示分支选择（现有 UnderstandingReady 行为不变）

## Workspace 读写

所有读写通过 `tsian.workspace` API（与现有 useSetupState 一致）：

| 操作 | 路径 | scope | 说明 |
|------|------|-------|------|
| 读 runtime | `save/playthrough/runtime.json` | effective | 恢复时判断 player.character |
| 写 runtime | `save/playthrough/runtime.json` | save-runtime | 更新 player.character |
| 写实体 | `save/entities/character/original-<name>.json` | save-runtime | 原创角色实体文件 |

### runtime.json 更新策略

`runtime.json` 已有完整结构（turn/activeSceneIds/activeScene/player/inventory/status/...）。更新时：
1. 先 read 当前完整 runtime.json
2. 只修改 `player.character` 字段
3. write 回完整 JSON（不丢其他字段）

### 原创角色实体文件结构

```json
{
  "id": "character:original-萧玄",
  "name": "萧玄",
  "brief": "青玄门掌门弟子，天赋过人",
  "sourceRefs": [],
  "updatedBy": "player-setup",
  "updatedAt": "<ISO timestamp>",
  "appearance": "可选字段",
  "personality": "可选字段",
  "background": "可选字段"
}
```

可选字段只在玩家填了才包含（不写空字符串）。

### localId 唯一性保障

1. 生成 base localId = `original-<name>`
2. read `save/entities/character/` 目录列表（`tsian.workspace.list`）
3. 若 `original-<name>.json` 已存在 → 尝试 `original-<name>-2`、`-3`... 直到不冲突
4. 最终 localId 用于实体文件路径和 character id

## Component Design

### CanonCharacterSelect.vue

竖向列表，每行复用 branch-card 视觉模式：
- 左侧标记字（角色名首字，用 `--font-display`）
- 中间角色名 + brief
- 四角括号（选中时高亮）
- GSAP fromTo 进场动画：`fromTo(rows, {opacity:0, x:-16}, {opacity:1, x:0, duration:0.35, stagger:0.04, ease:"power2.out"})`（照搬 SplitReview 章节列表模式）
- **选中态：标记字点燃 + 粒子上升**
  - 选中行标记字从 `--ember` 升到 `--ember-bright` 发光 + `text-shadow: 0 0 8px rgba(232,169,72,0.4)`
  - 标记字方块 border 升到 `--ember-bright` + `box-shadow: 0 0 12px rgba(232,169,72,0.3)`
  - 标记字方块内出现 2-3 个向上飘升的微粒子（复用 stepper `particle-rise` 3s ease-out infinite）
  - 选中行 border-color 升到 `--ember`（整行有微弱描边，但不抢标记字的视觉焦点）
  - 未选中行保持安静，hover 时标记字微亮（`--ember` → `--ember-bright` 无粒子）
- `candidateCharacters` 为空时显示提示文案 + "返回选择原创角色"按钮（`hint-fade` 0.3s）

### OriginalCharacterForm.vue

竖向表单：
- 必填字段在顶部：角色名（单行输入）、一句话简介（单行输入）
- 可选字段折叠在"展开更多"下方：外貌（多行）、性格（多行）、背景（多行）
- GSAP fromTo 进场：`fromTo(fields, {opacity:0, y:12}, {opacity:1, y:0, duration:0.35, stagger:0.06, ease:"power2.out"})`（纵向表单用 Y 轴，与 stage-fade 方向一致）
- 输入框烛火风格：border `--line-strong`，bg 微暖底色 `rgba(20,14,8,0.6)`
- 聚焦态：border-color → `--ember` + `box-shadow: 0 0 8px rgba(181,137,61,0.1)`，0.25s transition
- "展开更多"折叠：CSS `max-height` transition 0.3s `cubic-bezier(0.22,1,0.36,1)`
- 必填校验：空值时 primary 按钮禁用（opacity 0.35）；校验提示用 blood 系 `error-fade` 0.2s

### CharacterConfirmed.vue

确认屏：
- 居中角色名片（复用 branch-card 样式，标记字 + 名字 + 简介）
- 名片下方提示文案"已选定角色"
- GSAP fromTo 进场：`fromTo(card, {opacity:0, scale:0.92}, {opacity:1, scale:1, duration:0.5, ease:"power2.out", delay:0.1})`（单卡，无 stagger）
- **确认瞬间脉冲**：从选择/表单切到确认屏时，名片上叠一个一次性光环脉冲——`:key` 重挂播 `ring-pulse` 1.2s ease-out（14px→56px 扩散环, opacity 0.7→0），视觉语义="角色被点燃/选定"
- 确认屏的标记字也带粒子上升（与 CanonCharacterSelect 选中态呼应，表示"这个角色已被点燃"）
- "已选定角色"提示：`hint-fade` 0.3s 纯 opacity
- action bar: "返回修改" (secondary) + "下一步" (primary)

## State Machine Extension

`useSetupState` 新增状态：

```typescript
const characterBranch = ref<"canon" | "original" | null>(null)
const selectedCharacter = ref<{ ref: string; name: string; brief: string } | null>(null)
const characterSetupStatus = ref<"selecting" | "confirmed">("selecting")
```

`SetupWizard` 的 subView 路由扩展：
- step 3 + `characterSetupStatus === "selecting"` + `characterBranch === "canon"` → CanonCharacterSelect
- step 3 + `characterSetupStatus === "selecting"` + `characterBranch === "original"` → OriginalCharacterForm
- step 3 + `characterSetupStatus === "confirmed"` → CharacterConfirmed

action bar 配置扩展：
- CanonCharacterSelect: secondary="返回分支", primary="确认选择"(disabled until selected)
- OriginalCharacterForm: secondary="返回分支", primary="创建角色"(disabled until required filled)
- CharacterConfirmed: secondary="返回修改", primary="下一步"→goToStep(4)

## Boundaries

- 不引入新的 bridge 方法——只用 `tsian.workspace.read/write/list`
- 不修改 `UnderstandingReady` 的分支选择行为——只消费它的 emit
- 不修改 commit 脚本——理解包结构不变
- 不引入 Agent 调用——Step 3 纯前端 UI + workspace 读写
- `player.json` 不在本步骤写入——留给 Step 4

## Trade-offs

- runtime.json 读写采用 read-modify-write（先读完整 JSON，改 player.character，写回）。简单但有竞态风险（并发写）。当前向导阶段是单用户单流程，不存在并发，可接受。
- localId 唯一性用 list + 序号后缀，不用随机串。文件名可读优先。
- 可选字段直接放实体文件顶层（appearance/personality/background），不嵌套。Agent 读取时自然可见。
