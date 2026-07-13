# Design：消息序列编辑 UI

## 架构概述

在 StudioView 的 tab 系统中新增第 5 tab“消息序列”，包含一个 `MessageSequenceEditor` 组件。编辑器不再按 4 个 position 平铺分区，而是展示一个从上到下等于最终发送顺序的纵向 timeline：固定不可编辑运行时层（AGENT.md / SOUL.md / history / player input 等）与可编辑 contextPaths 插入区混排。可编辑区仍映射到底层 4 个 `position`（before-history / workspace-context / after-input / tail），支持拖拽排序（vuedraggable-plus）、条目编辑（FloatingWindow 桌面级浮窗）、模块开关整合。说明信息用 `ParamTip` 承载，避免主 UI 文案拥挤。消息序列采用草稿 + 显式保存，避免拖拽时刷新导致滚动重置。

## 组件结构

```
StudioView.vue
  └─ sections[4] = { id: "sequence", label: "消息序列", icon: ... }
      └─ MessageSequenceEditor.vue（新增）
          ├─ TimelineFixedRow.vue × N
          │   └─ 锁定层：system prompt / history / workspace meta / player input 等
          ├─ PositionBucket.vue × 4（嵌在 timeline 中的可编辑落点）
          │   ├─ 行内标题 + ParamTip 说明
          │   ├─ draggable（vuedraggable-plus）— 条目列表，支持跨 bucket 拖拽
          │   │   └─ ContextPathRow.vue — 每条目：role badge + 内容摘要 + 铅笔编辑 + 删除
          │   └─ "添加条目"按钮
          ├─ EntryEditDialog.vue（新增，FloatingWindow slot 模式）
          │   ├─ 类型切换：path / template
          │   ├─ path 模式：路径输入 + WorkspaceCodeEditor（文件正文编辑）
          │   ├─ template 模式：多行文本输入
          │   ├─ role Select + position Select
          │   └─ 模块开关列表（当 template 是 {{file:modules/*.md?enabled}} 时显示）
          └─ （不再需要独立 SequencePreview；主 timeline 即预览）
```

## 数据流

```
用户操作（拖拽/编辑/添加/删除/模块开关）
  ↓ MessageSequenceEditor 本地草稿 state（contextPaths 数组 + enabledModules 数组）
  ↓ 点击“保存序列”：updatePlatformStudioAgentContextPaths（studio-agents.ts）
  ↓ writeAgentConfigRecord → agent.json 更新
  ↓ 轻量刷新 snapshot 状态（不强制重载 agent context，避免滚动跳动）

预览：
  getPlatformStudioAgentContext（studio-agents.ts:274）
  → assembleAgentContext → contextInjectionsByPosition
  → expandMacros 展开宏
  → SequencePreview 按骨架顺序渲染
```

## 后端改动

### studio-agents.ts — 新增 updatePlatformStudioAgentContextPaths

```ts
async function updatePlatformStudioAgentContextPaths(
  cardId: string,
  agentId: string,
  contextPaths: ContextPathEntry[],
  enabledModules?: string[],
): Promise<void> {
  // 读 agent.json → parseAgentConfigFile → 替换 contextPaths（和 enabledModules）→ writeAgentConfigRecord
}
```

- 接收完整 contextPaths 数组替换（不是增量操作）
- enabledModules 可选参数：当用户在编辑器里切换模块开关时一并更新
- 遵循现有 update handler 模式（parse → mutate → write → reload）

### studio-agents.ts — 预览数据

`getPlatformStudioAgentContext` 已返回 `contextInjectionsByPosition`，可直接用于预览。需要额外调用 `expandMacros` 展开宏内容（如果预览需要显示展开后的内容而非原始宏语法）。

## 前端组件设计

### MessageSequenceEditor.vue

- props: `agentId`, `contextPaths: ContextPathEntry[]`, `enabledModules: string[]`
- 本地维护一个按 position 分组的结构（从 contextPaths 数组派生）
- 拖拽时更新本地结构 → 即时调用 `updatePlatformStudioAgentContextPaths` 保存
- 4 个 PositionBucket 组件，用 `vuedraggable-plus` 的 `VueDraggable` 组件实现跨列表拖拽

### 拖拽实现（vuedraggable-plus）

```vue
<VueDraggable
  v-model="groups[position]"
  :group="{ name: 'contextPaths', pull: true, put: true }"
  @onEnd="handleDragEnd"
>
  <ContextPathRow v-for="entry in groups[position]" :entry="entry" ... />
</VueDraggable>
```

- `group: { name: 'contextPaths' }` 让 4 个 bucket 的 draggable 互相可拖拽
- `@onEnd` 回调时：从 4 个 group 数组重新拼成完整 contextPaths 数组（保留各 group 内顺序），调用保存
- 跨 bucket 拖拽时自动更新被拖条目的 position 值

### ContextPathRow.vue

每行显示：
- role badge（system=蓝 / user=绿 / assistant=橙）
- 内容摘要：path 模式显示文件路径，template 模式显示前 50 字符
- 铅笔图标 → 打开 EntryEditDialog
- 删除图标 → confirm 后删除

### EntryEditDialog.vue（FloatingWindow slot 模式）

```
<FloatingWindow v-if="open" title="编辑条目" width-class="max-w-3xl">
  <!-- 类型切换 -->
  <Select v-model="entryType" :options="['path', 'template']" />
  
  <!-- path 模式 -->
  <template v-if="entryType === 'path'">
    <Input v-model="entry.path" placeholder="workspace 文件路径" />
    <WorkspaceCodeEditor v-if="fileContent" :model-value="fileContent" @update="handleContentChange" />
  </template>
  
  <!-- template 模式 -->
  <template v-else>
    <Textarea v-model="entry.template" :rows="10" />
  </template>
  
  <!-- role + position -->
  <Select v-model="entry.role" :options="['system', 'user', 'assistant']" />
  <Select v-model="entry.position" :options="positions" />
  
  <!-- 模块开关（当 template 含 {{file:modules/*.md?enabled}} 时） -->
  <ModuleSwitchList v-if="isModuleTemplate" :modules="availableModules" :enabled="enabledModules" @toggle="handleModuleToggle" />
</FloatingWindow>
```

### SequencePreview.vue

可折叠面板（Collapsible），展示骨架顺序：
- 固定层用占位条（灰色背景 + 标签，如"system prompt"、"history"、"player input"）
- contextPaths 注入显示 role badge + source + 宏展开后内容（调用 expandMacros）
- 前端 InjectionMessage 层用占位条标注"前端注入（before-input / after-input）"

## 拖拽库引入

- 安装 `vue-draggable-plus`
- 在 MessageSequenceEditor 中导入 `VueDraggable` 组件
- 4 个 PositionBucket 各持有一个 `VueDraggable`，共享 `group: { name: 'contextPaths' }`
- 拖拽结束后 flatten 4 个 group 为完整 contextPaths 数组并保存

## 文件改动列表

| 文件 | 改动 |
|---|---|
| `apps/platform-web/package.json` | 新增 `vue-draggable-plus` 依赖 |
| `apps/platform-web/src/views/StudioView.vue` | sections 数组加第 5 tab，渲染 MessageSequenceEditor |
| `apps/platform-web/src/components/studio/MessageSequenceEditor.vue` | 新增：主编辑器组件 |
| `apps/platform-web/src/components/studio/PositionBucket.vue` | 新增：position 区块组件（含 VueDraggable） |
| `apps/platform-web/src/components/studio/ContextPathRow.vue` | 新增：条目行组件 |
| `apps/platform-web/src/components/studio/EntryEditDialog.vue` | 新增：条目编辑浮窗 |
| `apps/platform-web/src/components/studio/SequencePreview.vue` | 新增：预览面板 |
| `apps/platform-web/src/components/studio/ModuleSwitchList.vue` | 新增：模块开关列表组件 |
| `apps/platform-web/src/platform-host/studio-agents.ts` | 新增 updatePlatformStudioAgentContextPaths handler |

## 风险点

1. **拖拽 + 即时保存**：拖拽过程中可能触发多次保存。需要 debounce 或只在 dragEnd 时保存一次。
2. **文件正文编辑**：path 模式下编辑文件正文需要通过 workspace_write API，与 contextPaths 配置保存是两个不同的写入路径。需要区分"编辑配置"和"编辑文件内容"的保存时机。
3. **宏展开预览性能**：expandMacros 需要读取 workspace 文件，预览面板需要 debounce 或懒加载。
4. **纯字符串条目**：contextPaths 里的纯字符串条目在拖拽时需要转为对象形式（保留向后兼容时需要判断是否可以安全转换）。
