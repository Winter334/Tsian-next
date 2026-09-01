# Implement — 资源管理器对齐 Windows 交互

全部改动在 `apps/platform-web/src/views/WorkspaceExplorerView.vue`。

## 前置：阅读上下文

- `prd.md`：需求与验收标准。
- `design.md`：技术设计、关键决策 D1-D7、数据流。
- 现有代码：已通读 `WorkspaceExplorerView.vue`（997 行）。

## 执行清单

### 1. 导入与类型

- [ ] 1.1 从 `lucide-vue-next` 补充图标：`FolderPlus`（新建文件夹）、`Copy`、`Scissors`、`ClipboardPaste`。现有 `FilePlus2`/`RefreshCw` 保留。
- [ ] 1.2 新增 `ClipboardEntry` interface（`kind: "copy"|"cut"`, `sourcePath`, `sourceName`, `isDirectory`）。

### 2. 状态

- [ ] 2.1 新增 `const clipboard = ref<ClipboardEntry | null>(null)`。
- [ ] 2.2 新增 `const visibleEntries = computed(() => directoryEntries.value.filter(e => e.name !== ".keep"))`。
- [ ] 2.3 新增 `const clipboardContextKey = computed(() => { if (selectedCardId.value) return \`card:\${selectedCardId.value}\`; if (currentPath.value === ".tsian" || currentPath.value.startsWith(".tsian/")) return "local"; return "" })`。
- [ ] 2.4 新增 `watch(clipboardContextKey, () => { clipboard.value = null })`——只跨卡/跨根/回根选择界面清空,同卡内跨目录保留。
- [ ] 2.5 把模板里 `v-for="entry in directoryEntries"` 改为 `v-for="entry in visibleEntries"`。

### 3. 冲突命名 helper

- [ ] 3.1 新增 `splitNameExt(name): { base: string; ext: string }`——按最后一个 `.` 拆分；无 `.` 或以 `.` 开头（隐藏文件）则 `ext=""`、`base=name`。
- [ ] 3.2 新增 `uniqueName(base, ext, existing: Set<string>): string`——`base+ext` 不冲突直接用；否则 `base(1)+ext`、`base(2)+ext`... 递增。
- [ ] 3.3 新增 `currentEntryNames(): Set<string>` = `new Set(visibleEntries.value.map(e => e.name))`。

### 4. 新建文件

- [ ] 4.1 新增 `async function createNewFile()`：
  - 守卫 `isBrowsing` 且 `currentPath` 不以 `save` 开头。
  - `const base = "新建文件", ext = ".txt"`
  - `const name = uniqueName(base, ext, currentEntryNames())`
  - `const path = currentPath ? \`${currentPath}/${name}\` : name`
  - `await writePlatformWorkspaceFile({cardId?, path, content: "", mediaType: "text/plain"})`
  - `emitWorkspaceContentChanged`、`await refreshDirectory()`
  - 找到新 entry → `enterRenameForNewEntry(entry)`
  - 失败 → `feedback`/`errorMessage`
- [ ] 4.2 删除/替换 `openCreateEditor`、`openCreateEditorFromContextMenu`、`defaultNewFileName`、`openEditorRoute` 中 create 分支相关死代码（保留 edit 分支；`openEditorRoute` 仍被 `openEditorForFile` 用）。确认 `prompt` 导入若无其他用途则移除。

### 5. 新建文件夹

- [ ] 5.1 新增 `async function createNewFolder()`：
  - 同守卫。
  - `const name = uniqueName("新文件夹", "", currentEntryNames())`
  - `const dirPath = currentPath ? \`${currentPath}/${name}\` : name`
  - 写占位：`await writePlatformWorkspaceFile({cardId?, path: \`${dirPath}/.keep\`, content: "", mediaType: "text/plain"})`
  - `emitWorkspaceContentChanged`、`await refreshDirectory()`
  - 找到新文件夹 entry → `enterRenameForNewEntry(entry)`
- [ ] 5.2 重命名文件夹后若用户把名字改成与 `.keep` 冲突？无需特殊处理——`.keep` 在子目录里，重命名的是目录本身。

### 6. 新建后进入重命名

- [ ] 6.1 新增 `function enterRenameForNewEntry(entry: WorkspaceEntry)`：
  - `contextMenu.value = null`
  - `selectedEntryPath.value = entry.path`
  - `renamingEntryPath.value = entry.path`
  - `renameDraft.value = entry.name`
  - `nextTick` → focus input → `select` 文件名主干：
    - `const { base } = splitNameExt(entry.name)`
    - `input.setSelectionRange(0, base.length)`（文件夹 `ext=""` → 全选，与主干等价）

### 7. 复制 / 剪切

- [ ] 7.1 新增 `function canModifyEntry(entry): boolean` = `canDeleteEntry(entry)`（复用守卫，排除 save 虚拟槽）。
- [ ] 7.2 新增 `function copyEntry(entry)`：
  - 守卫 `canModifyEntry`。
  - `clipboard.value = { kind: "copy", sourcePath: entry.path, sourceName: entry.name, isDirectory: entry.kind === "directory" }`
  - `feedback.value = \`已复制：${entry.name}\``
- [ ] 7.3 新增 `function cutEntry(entry)`：
  - 守卫 `canModifyEntry`。
  - `clipboard.value = { kind: "cut", sourcePath: entry.path, sourceName: entry.name, isDirectory: entry.kind === "directory" }`
  - `feedback.value = \`已剪切：${entry.name}\``
- [ ] 7.4 模板：剪切项加 `:class` → `clipboard?.kind === "cut" && clipboard.sourcePath === entry.path ? "opacity-50" : ""`。

### 8. 粘贴

- [ ] 8.1 新增 `function canPasteHere(): boolean` = `clipboard.value !== null && isBrowsing.value && !currentPath.value.startsWith("save")`。
- [ ] 8.2 新增 `async function pasteFromClipboard()`：
  - 守卫 `canPasteHere`。
  - `const cb = clipboard.value!`
  - 计算 `targetBaseName`：
    - 复制：`const { base, ext } = splitNameExt(cb.sourceName); const copyBase = \`\${base} - 副本\`; const targetName = uniqueName(copyBase, ext, currentEntryNames())`
    - 剪切：同目录同名则跳过重命名（`if (siblingPath(cb.sourcePath, cb.sourceName) === \`${currentPath}/${cb.sourceName}\` && name 不冲突)` 直接用原名）；否则 `uniqueName(base, ext, ...)`。
  - `const targetPath = currentPath.value ? \`${currentPath.value}/${targetName}\` : targetName`
  - 剪切且 targetPath === sourcePath → no-op，清空 clipboard，return。
  - 执行：
    - 剪切（文件或文件夹）：`await movePlatformWorkspacePath({cardId?, path: cb.sourcePath, targetPath})`
    - 复制文件：`const f = await readPlatformWorkspaceFile({cardId?, path: cb.sourcePath}); await writePlatformWorkspaceFile({cardId?, path: targetPath, content: f.content, mediaType: f.mediaType})`
    - 复制文件夹：`await copyDirectory(cb.sourcePath, targetPath)`
  - 剪切成功 → `clipboard.value = null`；复制成功 → 保留 clipboard。
  - `emitWorkspaceContentChanged`、`await refreshDirectory()`、`feedback`。
- [ ] 8.3 新增 `async function collectFilesUnder(dirPath): Promise<WorkspaceFile[]>`：
  - 递归 `listPlatformWorkspaceDirectory({cardId?, path: subPath})`。
  - 对每个 `kind === "file"` 的 entry 调 `readPlatformWorkspaceFile` 收集。
  - 对每个 `kind === "directory"` 的 entry 递归。
  - 返回扁平 `WorkspaceFile[]`（含 `.keep`）。
- [ ] 8.4 新增 `async function copyDirectory(srcPath, targetPath)`：
  - `const files = await collectFilesUnder(srcPath)`
  - `for (const file of files) { const rel = file.path.slice(srcPath.length + 1); await writePlatformWorkspaceFile({cardId?, path: \`${targetPath}/${rel}\`, content: file.content, mediaType: file.mediaType}) }`
- [ ] 8.5 `WorkspaceFile` 类型需要从 `@tsian/contracts` 补充导入（`collectFilesUnder` 返回类型用）。

### 9. 快捷键

- [ ] 9.1 重写 `onGlobalKeydown`：
  ```
  Esc → 关菜单 + 取消重命名（已有）
  if (isEditableKeyboardTarget(target)) return  // 非 Esc 分支统一守卫
  F2 + selectedEntry → startRenameEntry（已有）
  Delete + selectedEntry → deleteEntry(selectedEntry)
  Ctrl+C + selectedEntry → copyEntry(selectedEntry)
  Ctrl+X + selectedEntry → cutEntry(selectedEntry)
  Ctrl+V → clipboard && pasteFromClipboard()
  ```
- [ ] 9.2 **不做 F5**：保留浏览器原生 F5 刷新页面。资源管理器刷新走右键「刷新」+变更事件自动刷新。
- [ ] 9.3 `deleteEntry` 已有 `contextMenu.value = null`，快捷键路径无需额外处理。

### 10. 右键菜单模板

- [ ] 10.1 条目菜单新增按钮（在「编辑」后、「重命名」前）：复制、剪切。样式复用现有 `block w-full px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon`。
- [ ] 10.2 空白区菜单新增（在「新建文件」后）：「新建文件夹」（FolderPlus 图标）、「粘贴」（ClipboardPaste 图标，`v-if="canPasteHere()"`）。
- [ ] 10.3 空白区「新建文件」按钮的 `@click` 从 `openCreateEditorFromContextMenu` 改为 `() => { contextMenu.value = null; createNewFile() }`。
- [ ] 10.4 条目菜单的「复制」「剪切」`@click` 调 `copyEntry`/`cutEntry` 并清菜单。
- [ ] 10.5 空白区「粘贴」`@click` 调 `pasteFromClipboard` 并清菜单。
- [ ] 10.6 更新 `contextMenuStateFromMouse` 的 `menuHeight`：entry 菜单 6 项 → ~176；blank 菜单 4 项 → ~120。`selectedCardId.value ? 120 : 48` 改为考虑粘贴可用性。

### 11. 清理

- [ ] 11.1 移除 `prompt` 导入（若 `openCreateEditor` 删除后无其他用处）。`confirm` 仍被 `deleteEntry` 用，保留。
- [ ] 11.2 移除 `openCreateEditor`、`openCreateEditorFromContextMenu`、`defaultNewFileName`。
- [ ] 11.3 `openEditorRoute` 的 `mode: "create"` 分支若不再被调用，简化为仅 edit（或保留以备未来用，但不留死代码——选择删除 create 分支）。

## 验证

- [ ] `npm run build:web` 通过（无 TS/lint 错误）。
- [ ] 手动验证（dev server 或 build 产物）：
  - 空白右键新建文件 → 立即出现 `新建文件.txt` 且进入重命名选中主干。
  - 空白右键新建文件夹 → 立即出现 `新文件夹` 且进入重命名；列表无 `.keep`。
  - 文件复制 → 粘贴生成 `xxx - 副本.txt`；再粘贴 `xxx - 副本(1).txt`。
  - 文件夹复制 → 子文件全部复制。
  - 剪切 → 源半透明 → 粘贴后源消失。剪切后导航到子目录,剪贴板仍保留；粘贴到目标目录。
  - Ctrl+C/X/V、Delete 快捷键；在 input 内按 Ctrl+C 不触发复制操作（只触发浏览器默认文本复制）。
  - 不按 F5 刷新目录（保留浏览器原生 F5）。
  - `save/` 目录右键无新建/粘贴；存档槽条目无复制/剪切/重命名/删除。

## Review Gates

- 每完成一个功能块（新建/剪贴板/快捷键/菜单）后跑一次 `npm run build:web` 确认无类型错误。
- 全部完成后完整跑一次 build + 手动验证清单。

## Rollback Points

- 任何步骤出错 → `git checkout apps/platform-web/src/views/WorkspaceExplorerView.vue`。
- 无存储/契约/路由变更，无数据风险。
