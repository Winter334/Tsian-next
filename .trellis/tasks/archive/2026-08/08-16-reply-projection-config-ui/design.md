# 正文处理桌面应用 Design

## 1. Scope and Boundaries

新增一个名为“正文处理”的独立平台桌面应用，专门编辑当前游戏卡的 `config/reply-projection.json`。应用只提供有序规则列表和结构化规则详情；原始文件编辑继续由资源管理器/Workspace 编辑器负责。

本任务不修改 `tsian.reply-projection.v1`、`projectAssistantReply`、正式回合/旁路/开局投影数据流、共享 contracts 或存储 schema。配置仍是 card-content Workspace 文件，现有 projector 仍是唯一运行时解释器。

## 2. Application Architecture

```text
platformAppRegistry
  └─ reply-projection / “正文处理” / singleton route
       ├─ retro: views/ReplyProjectionView.vue
       └─ spatial: spatial/apps/reply-projection/SpatialReplyProjectionView.vue
                    │
                    └─ controllers/reply-projection/use-reply-projection-controller.ts
                         ├─ active card lifecycle
                         ├─ Workspace read/write + expectedContent
                         ├─ dirty/close/conflict state
                         └─ structured draft + lossless serialization
                              └─ reply-projection-draft.ts
```

- `platform-apps.ts` 注册 launcher 图标、`/reply-projection` 路由、singleton 窗口和两套 presentation。
- 两套 view 只负责各自视觉原语与响应式布局；加载、保存、规则操作和模式切换全部来自共享 controller。
- `reply-projection-draft.ts` 只负责配置文件与 UI 草稿的无损转换，不执行正则、不模拟 projector、不提供行为预览。
- 复用现有 confirm、close guard、平台事件和 Workspace API；需要原文编辑时路由到既有 Workspace 编辑器，不在本应用嵌入代码编辑器。

## 3. Configuration Draft Contract

结构化草稿需要表达 v1 的“字段是否存在”，不能把缺失字段与空字符串混为一谈。

```ts
interface ReplyProjectionRuleDraft {
  clientKey: string
  extras: Record<string, unknown>
  idPresent: boolean
  id: string
  match: string
  replacementMode: "none" | "text" | "split"
  text: string
  contentPresent: boolean
  content: string
  displayPresent: boolean
  display: string
  projectPresent: boolean
  projectRows: Array<{ clientKey: string; key: string; expression: string }>
}

interface ReplyProjectionDraft {
  topLevelExtras: Record<string, unknown>
  rules: ReplyProjectionRuleDraft[]
}
```

转换规则：

- `clientKey` 仅服务 Vue identity，不写入配置；重复/缺失 `id` 不影响列表稳定性。
- 已知字段之外的顶层和 rule 字段保存在 `extras`，结构化保存时原样合并。
- `text` 与 `content`/`display` 同时存在、`project` 不是 string map、rule 不是 object、schema/rules 结构无法表达时，配置进入 unsupported 状态；界面阻止结构化保存并提供“在资源管理器中编辑配置文件”，不做猜测性归一化。
- `idPresent`、`contentPresent`、`displayPresent`、`projectPresent` 保证空字符串、空对象和字段缺失可无损往返。
- project 在 UI 中以 key/expression 行直接呈现。key 保留正式 `key` / `key[]` 字符串，expression 保留完整 `$1|lines|stripList`；UI 只配简短用途说明，不解析或生成另一套表达方式。
- 载入时仅检查 JSON 可解析且结构可无损表示；不编译正则、不运行样本文本、不调用 projector。
- 结构化保存使用稳定两空格 JSON 格式和末尾换行。JSON 属性顺序可规范化，但所有字段和值必须保留。

## 4. Controller State and Data Flow

### Load

1. 等待 platform host ready，读取当前 active card。
2. 无 active card：显示空状态和“去我的应用”。
3. 用显式 `cardId` 读取 `config/reply-projection.json`。
4. 仅把精确 `WORKSPACE_FILE_NOT_FOUND` 当作“尚未配置”；其他错误原样显示。
5. 文件存在时保存 `baselineContent`、`readOnly` 并生成 structured draft；无法无损表示时进入 unsupported 状态。
6. 文件不存在时显示创建空状态；点击“创建配置”只创建未保存草稿 `{ schema: "tsian.reply-projection.v1", rules: [] }`。

### Edit

- 规则列表支持新增、复制、删除、上移、下移；上/下移是键盘可达的排序基线，拖拽不是必需依赖。
- 选择规则后编辑完整 regex literal、替换模式和 project rows。
- 替换模式：
  - `none`：不写 `text/content/display`。
  - `text`：只写 `text`，空字符串是合法显式值。
  - `split`：分别用 presence 开关控制 `content` / `display`；至少一个开启后才产生替换字段。
- unsupported 状态不提供局部表单，避免在未知配置上产生有损保存；作者可直接打开既有 Workspace 编辑器处理文件。

### Save

1. 结构化草稿序列化保证合法 JSON 和互斥字段组合；unsupported 状态不可保存。
2. 已存在文件使用 `writePlatformWorkspaceFile({ cardId, path, content, expectedContent: baselineContent })`；不存在文件按创建写入。
3. 保存成功后更新 baseline/draft/readOnly，先清理 self-conflict 状态，再发出 `WORKSPACE_CONTENT_CHANGED_EVENT`。
4. 并发写冲突保留本地草稿，显示“重新读取”操作，不自动覆盖。
5. Ctrl/Cmd+S 调用同一 save；只读和无变更时不写。

### External Changes

- `ACTIVE_CARD_CHANGED_EVENT`：草稿干净时切换到新 active card；草稿脏时继续绑定旧 cardId，显示“当前加载卡已变化”，让作者先保存或放弃后再切换，绝不静默丢稿。
- 同 card/path 的 `WORKSPACE_CONTENT_CHANGED_EVENT`：干净时重读；脏时标记外部变化，依赖 expectedContent 防止陈旧覆盖。
- close guard 使用当前平台窗口 id。脏草稿提供保存/不保存/取消；保存失败不得关闭。

## 5. UI Structure

### Shared information architecture

```text
Toolbar: 当前游戏卡 · 编辑配置文件 · 保存 · 刷新

┌ 有序规则列表 ─────────┬ 规则详情 ─────────────────────┐
│ + 新增                │ 匹配：名称 · /.../g           │
│ choices               │ 文本替换：无 / 同时 / 分别     │
│ /.../g                │ 数据投影：key → expression    │
│ 同时替换 · 投影 choices│                               │
│ [复制][删除][↑][↓]     │                               │
└───────────────────────┴───────────────────────────────┘

Status bar: 未保存 / 已保存 / 只读 / 外部变化 / 错误
```

- 规则列表仅显示名称、截断 regex 和能力标签，不生成自然语言长摘要。
- 详情固定为“匹配 / 文本替换 / 数据投影”三个区段；标题和字段说明保持一行内可读。
- `text` 对应“同时替换”；`content` 显示为“上下文文本（content）”并解释“后续 Agent 会读取”；`display` 显示为“显示文本（display）”并解释“玩家界面会呈现”。
- `project` 区段直接显示 key 与管道表达式；区段说明“交给游戏界面的结构化数据”，key 说明 `[]` 追加，表达式给出一个短例子。
- 正则与管道面向游戏卡开发者，保持正式语法可见；避免无解释字段，也避免为了隐藏字段再发明一套更复杂的 UI 语法。
- 具体间距、控件密度和窄窗口细节以实现后的浏览器人工验收为准，不在规划阶段继续制作可视化稿。
- 没有规则时解释“回复保持原样”，并提供新增规则。
- “编辑配置文件”打开既有 Workspace 编辑器；专用应用没有第二份代码编辑器状态。
- retro 宽屏使用左右两栏；spatial 或窄窗口使用规则列表/详情的分段切换或纵向堆叠，功能完全一致。
- 不提供样本文本、命中结果、display/content/projections 预览、正则 AST 或效果校验按钮。

## 6. Read-only and Failure Matrix

| Condition | UI behavior |
|---|---|
| No active card | 空状态；链接到“我的应用” |
| Config missing, editable card | “创建配置”；草稿保存后才落盘 |
| Config missing, read-only card | 说明需先复制为本地卡；不可创建 |
| Existing read-only config | 可查看结构化规则；隐藏或禁用写操作 |
| Invalid JSON | unsupported；显示读取原因并提供 Workspace 编辑入口 |
| Valid JSON but not losslessly structural | unsupported；不丢字段、不自动修复 |
| Existing file changed externally | 保留草稿；expectedContent 拒绝陈旧覆盖 |
| Active card changes while dirty | 继续编辑旧 cardId；保存/放弃后切换 |
| Save fails | 保留草稿并显示原错误 |

## 7. Compatibility and Rollback

- 无配置迁移、DB migration、contract change 或历史重投影。
- 现有手写配置和“沉浸阅读器”两条规则必须无损打开与保存。
- 运行时继续直接读取相同 Workspace 文件；应用保存后下一次投影自然生效。
- 回滚只需移除 app registry 条目、新 views/controller/draft helper 和 barrel export；任何已保存配置仍可由资源管理器编辑并继续运行。

## 8. Verification Strategy

按仓库 smoke-only 策略，不新增 UI/controller/unit test 文件。

- `npm run build:web`
- `npm run test:smoke:web`，确认既有 Reply Projection transaction 未回归
- `git diff --check`
- 人工验证 retro + spatial：无卡、缺配置创建、现有两条规则 round-trip、规则 CRUD/排序、空字符串、split presence、project `key[]`、Workspace 编辑入口、unsupported、只读、Ctrl+S、关闭保护、外部冲突、active card 切换、窄窗口。
