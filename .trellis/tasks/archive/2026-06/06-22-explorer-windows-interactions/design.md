# Design — 资源管理器对齐 Windows 交互

## 范围

单文件改动：`apps/platform-web/src/views/WorkspaceExplorerView.vue`。不改 `platform-host/workspace-ops.ts`、`agent-runtime/workspace-operations.ts`、`@tsian/contracts`、路由、Dexie。

## 后端能力盘点（已具备，无需改动）

| 能力 | 前端入口 | 后端实现 |
|------|---------|---------|
| 列目录 | `listPlatformWorkspaceDirectory({cardId?, path})` | `executeWorkspaceOperation list` |
| 读单文件 | `readPlatformWorkspaceFile({cardId?, path})` | `executeWorkspaceOperation read` |
| 写/创建文件 | `writePlatformWorkspaceFile({cardId?, path, content, mediaType})` | `writeWorkspaceFile` |
| 移动（文件+目录级） | `movePlatformWorkspacePath({cardId?, path, targetPath})` | `moveWorkspacePath`：前缀匹配所有子文件 → 逐个 write 到新路径 → delete 旧前缀 |
| 删除（文件+目录级） | `deletePlatformWorkspacePath({cardId?, path})` | `deleteWorkspacePath` |

复制 = read 源 → write 目标（递归处理目录）。剪切 = move。**后端零改动**。

## 关键设计决策

### D1 空文件夹持久化：`.keep` 持久锚点

工作区是文件式存储（IndexedDB 按文件路径存），"空文件夹"不存在。Windows 风格新建文件夹后立即看到一个空文件夹，且删光内部其它文件后文件夹仍在——但这里目录的存在完全依赖"有没有文件以该目录为前缀"。

**方案**：`.keep` 是目录的**持久锚点**，不是一次性占位：
- 新建文件夹时写入 `<dir>/.keep`（空内容, `text/plain`）。
- `.keep` **只随「删除整个目录」或「重命名/移动整个目录」消失**——后端 `deletePlatformWorkspacePath`/`movePlatformWorkspacePath` 目录级操作按前缀匹配,会连 `.keep` 一起处理。
- **删除目录内单个文件、把单个文件移出目录,都不影响 `.keep`**——后端按精确 path 删/移,删一个文件只删那一个,不会动 `.keep`。因此"移除某个目录下所有其它文件,目录仍保留"天然满足。
- 资源管理器列表渲染时 **过滤掉名为 `.keep` 的 entry**，使文件夹显示为空。
- 复制/剪切文件夹时连同 `.keep` 一起处理（`listPlatformWorkspaceDirectory` 递归带出,`move` 前缀匹配带出,前端递归复制带出），用户无感知。
- 边界：用户通过编辑器手动删 `.keep` 且目录无其它文件 → 目录消失。属高级边缘操作（`.keep` 在资源管理器不可见,无法通过资源管理器删）,可接受。

**`.keep` 不对 agent 工具隐藏**：隐藏是资源管理器视图层（`visibleEntries` computed）的渲染约定,不是存储/workspace 操作层语义。agent 的 `workspace.list`/`read`/`write`/`move`/`delete` 看见的是真实存储,`.keep` 是普通文件,对 agent 完全可见可操作。理由：
- 保持分层干净：UI 约定不污染通用 workspace 操作 API（不改 `workspace-operations.ts` 的过滤逻辑）。
- agent 看见 `.keep` 无害：读到空内容、写入业务文件不影响它、删业务文件它仍在（持久锚点对 agent 也成立）。
- 避免双重语义 bug：若 agent `list` 过滤 `.keep`,则"目录空"和"目录不存在"无法区分,`workspace.write .keep` 的允许性也模糊。
- agent 不会主动操作 `.keep`：prompt 不告知它,agent 按业务逻辑操作真实数据文件。

**前端无需额外守护逻辑**：现有后端按精确 path 删/移的行为已天然满足"持久锚点"语义,只要新建时写 `.keep`、列表过滤 `.keep`、不在单文件操作时主动清理 `.keep`（现有逻辑本就不会动它）。

**为什么不新建非空占位**：
- 与 Windows 体验最接近（文件夹是"空"的）。
- `.keep` 是常见约定（git、空目录占位），语义清晰。
- 列表过滤是单点逻辑，不污染存储。

**过滤实现**：在 `directoryEntries` 的渲染处用 `computed` 派生 `visibleEntries`，过滤 `entry.name === ".keep"`。所有交互（选中、重命名、右键）都基于 `visibleEntries`，避免用户对 `.keep` 产生任何操作。

### D2 默认名与数字递增冲突解决

```
新建文件.txt → 新建文件(1).txt → 新建文件(2).txt ...
新文件夹    → 新建文件夹(1)  → 新建文件夹(2)  ...
```

复制粘贴冲突：
```
foo.txt 粘贴到含 foo.txt 的目录 → foo - 副本.txt → foo - 副本(1).txt
```

**统一实现**：一个 `uniqueName(baseName, ext, existingNames)` helper：
- 拆分 `baseName` + `ext`（含点号，无扩展名则 `ext = ""`）。
- 若 `baseName + ext` 不在 `existingNames` 中，直接用。
- 否则尝试 `baseName(N) + ext`，N 从 1 递增直到不冲突。

新建文件/文件夹与复制粘贴**共用同一冲突逻辑**，只是 `baseName` 来源不同：
- 新建文件：`baseName = "新建文件"`, `ext = ".txt"`。
- 新建文件夹：`baseName = "新文件夹"`, `ext = ""`。
- 复制：`baseName = 原名去扩展名 + " - 副本"`, `ext = 原扩展名`；第二次粘贴同一项到同目录则 `baseName = 原名去扩展名 + " - 副本(1)"`...

**existingNames 来源**：当前 `directoryEntries` 的 `entry.name` 集合（不异步查重，用已加载列表，避免多一次 IO；粘贴后刷新会同步）。

### D3 剪贴板状态（视图内 ref）

```ts
interface ClipboardEntry {
  kind: "copy" | "cut"
  sourcePath: string        // 相对当前 cardId 的完整路径
  sourceName: string        // 显示用
  isDirectory: boolean
}
const clipboard = ref<ClipboardEntry | null>(null)
```

- 复制/剪切：写入 `clipboard`。
- 粘贴：读 `clipboard`，在当前目录执行 copy/cut 逻辑。
- 剪切粘贴成功后清空 `clipboard`。
- 复制粘贴后**保留** `clipboard`（允许重复粘贴，Windows 行为）。
- **跨目录保留 `clipboard`**（跨目录移动是剪切的核心用途）。
- **跨游戏卡 / 跨本地根（.tsian vs card）清空 `clipboard`**（路径空间不同,跨卡粘贴无意义）；回到根目录选择界面清空（无粘贴目标）。
- 用 `clipboardContextKey` computed 标识当前上下文,只 watch 它：
  ```ts
  const clipboardContextKey = computed(() => {
    if (selectedCardId.value) return `card:${selectedCardId.value}`
    if (currentPath.value === ".tsian" || currentPath.value.startsWith(".tsian/")) return "local"
    return ""  // 根目录选择界面
  })
  watch(clipboardContextKey, () => { clipboard.value = null })
  ```
- 剪切项视觉反馈：`directoryEntries` 渲染时若 `entry.path === clipboard?.sourcePath && clipboard.kind === "cut"`，加 `opacity-50`。仅在源目录可见（导航走当前列表不含源 entry,半透明自然不显示；回到源目录若未粘贴仍半透明提示）。

### D4 新建后自动进入重命名

新建文件/文件夹的 write 成功后：
1. `await refreshDirectory()` 刷新列表。
2. 找到新建的 entry（按目标 path 匹配）。
3. `selectedEntryPath.value = entry.path`。
4. 复用现有 `renamingEntryPath` / `renameDraft` 机制进入重命名。
5. `renameDraft.value = entry.name`。
6. `nextTick` 后 focus input 并 **select 文件名主干（不含扩展名）**：用 `input.setSelectionRange(0, baseName.length)`。

现有 `startRenameEntry` 已 focus+select 全名；新建路径需要一个变体只选主干。抽一个 `enterRenameForNewEntry(entry)`：
- 复制 `startRenameEntry` 的 focus 逻辑。
- select 范围改为 `0..baseNameLength`（文件夹则全选）。

### D5 递归复制/剪切文件夹

`listPlatformWorkspaceDirectory` 只列一层。复制文件夹需要递归拿到所有子文件。

**复制文件夹 `copyDirectory(srcPath, targetPath)`**：
```
async function collectAllFilesUnder(path): Promise<WorkspaceFile[]>
  // 递归 list，收集所有 kind === "file" 的 entry path
  // 对每个 path 调 readPlatformWorkspaceFile 拿 content
  // 返回完整文件列表（含 .keep）

const files = await collectAllFilesUnder(srcPath)
for (const file of files) {
  const relPath = file.path.slice(srcPath.length + 1) // 去掉 srcPath/
  const targetFilePath = `${targetPath}/${relPath}`
  await writePlatformWorkspaceFile({cardId, path: targetFilePath, content: file.content, mediaType: file.mediaType})
}
```

**剪切文件夹**：直接 `movePlatformWorkspacePath({cardId, path: srcPath, targetPath})`——后端 `moveWorkspacePath` 已做前缀匹配+逐文件迁移+删旧前缀。无需前端递归。

### D6 快捷键

扩展现有 `onGlobalKeydown`（目前只处理 Esc/F2）：

```ts
function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") { /* 已有 */ }
  if (isEditableKeyboardTarget(event.target)) return  // 已有判断，提前到除 Esc 外的所有分支

  // F2（已有）
  // Delete → selectedEntry.value && deleteEntry(selectedEntry.value)
  // Ctrl+C → selectedEntry.value && copyEntry(selectedEntry.value)
  // Ctrl+X → selectedEntry.value && cutEntry(selectedEntry.value)
  // Ctrl+V → clipboard.value && pasteFromClipboard()
}
```

`isEditableKeyboardTarget` 已存在，只需把它提前到非 Esc 分支的开头。

**不做 F5**：保留浏览器原生 F5 刷新页面作为逃生通道。资源管理器已有右键「刷新」+ `WORKSPACE_CONTENT_CHANGED_EVENT` 自动刷新,缺 F5 不影响功能完整度。拦 F5 会剥夺 Web 基础交互,代价大于收益。

### D7 右键菜单项排序与可用性

**条目菜单**（按 Windows 习惯排序）：
1. 打开
2. 编辑（仅文件）
3. ——分隔——（可选,先不加分隔线保持现有极简风）
4. 复制
5. 剪切
6. ——分隔——（可选）
7. 重命名
8. 删除

**空白区菜单**：
1. 新建文件
2. 新建文件夹
3. 粘贴（`clipboard.value` 为空时隐藏或 disabled；选择隐藏,与现有"刷新仅空白显示"风格一致）
4. 刷新

**守卫**：`save/` 虚拟存档槽目录的条目，复制/剪切/粘贴/重命名/删除都禁用——复用现有 `canDeleteEntry`（已排除 `save` 和 `save/save-\d+`）。复制/剪切用 `canDeleteEntry` 守卫；粘贴目标若在 `save/` 下也禁止（`currentPath` 以 `save` 开头时粘贴菜单禁用）。

`menuHeight` 估算需更新：条目菜单现在最多 6 项（打开/编辑/复制/剪切/重命名/删除），每项约 28px + padding，估 `6 * 28 + 8 = 176`；空白区最多 4 项（新建文件/新建文件夹/粘贴/刷新），估 `4 * 28 + 8 = 120`。这只是防溢出估算,精度不关键。

## 数据流

```
右键「新建文件」
  → buildUniqueName("新建文件", ".txt", visibleNames)
  → writePlatformWorkspaceFile({path: `${currentPath}/${unique}`, content: "", mediaType: "text/plain"})
  → refreshDirectory()
  → 找到新 entry → enterRenameForNewEntry(entry)

Ctrl+V（clipboard = {cut, srcPath, isDir}）
  → targetBase = buildUniqueName(srcName 去路径, ext, visibleNames)  // 剪切到同目录且同名则 N=0 直接跳过
  → if isDir: movePlatformWorkspacePath({path: srcPath, targetPath: `${currentPath}/${targetBase}`})
    else: movePlatformWorkspacePath({path: srcPath, targetPath: `${currentPath}/${targetBase}`})
  → clipboard.value = null
  → refreshDirectory()

Ctrl+V（clipboard = {copy, srcPath, isDir}）
  → targetBase = buildUniqueName(srcName, ext, visibleNames)
  → if isDir: copyDirectory(srcPath, `${currentPath}/${targetBase}`)
    else: read srcFile → writePlatformWorkspaceFile({path: target, content, mediaType})
  → refreshDirectory()  // 保留 clipboard，可重复粘贴
```

## 边界与错误处理

- 新建/粘贴操作进行中用 `feedback` 显示"正在..."；失败用 `errorMessage`/`feedback` 提示，不静默。
- `.keep` 文件被用户通过编辑器手动删除/编辑不影响资源管理器（列表过滤是渲染层,存储层 `.keep` 是普通文件；手动删 `.keep` 且目录无其它文件则目录消失,属可接受边缘情况）。
- 剪切后若用户刷新页面，`clipboard` 丢失（视图内 ref，不持久化）——源文件仍在原位（剪切未粘贴=未移动），符合预期。
- 跨目录剪切粘贴：`movePlatformWorkspacePath` 后端已支持跨目录移动（只要同 scope），前端只需给完整 targetPath。剪切后导航到目标目录再粘贴是核心流程。
- 跨游戏卡 / 跨本地根粘贴被阻止（`clipboardContextKey` 变化时清空 clipboard）。

## 回滚

单文件改动，回滚 = `git checkout apps/platform-web/src/views/WorkspaceExplorerView.vue`。无存储/契约/路由变更，无数据迁移风险。
