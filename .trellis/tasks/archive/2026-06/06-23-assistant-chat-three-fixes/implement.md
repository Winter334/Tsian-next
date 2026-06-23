# Implement: 桌面助手三个 Bug 修复

## 实施清单（按依赖顺序）

### Step 1: R2 — useAssistantTimeline 过渡文本保留

文件：`apps/platform-web/src/composables/useAssistantTimeline.ts`

1. `AssistantTimelineNode` 联合类型新增 `interim` 分支：
   `{ type: "interim"; id: string; round: number; text: string; collapsed: boolean }`
2. `onRoundEnd` 的 `tool_calls` 分支：在处理 reasoning→thought 之前，若
   `streamingText` 非空，`timeline.push({ type: "interim", id: \`interim-r${round}\`,
   round, text: streamingText, collapsed: false })`。保留 streamingText 不丢弃。
3. `finalize()`：折叠循环只处理 `thought`/`tool`，跳过 `interim`（始终展开）。
4. `flushStreaming()`：若 `streamingText` 非空，落为 `interim` 节点（id
   `interim-flush-${timeline.length}`），再清空。保持中止时过渡文本不丢。

### Step 2: R2 — AssistantView 模板渲染 interim 节点

文件：`apps/platform-web/src/views/AssistantView.vue`

5. 模板 `v-for="node in msg.timeline"` 内，在 `thought`/`tool` 分支旁新增
   `v-else-if="node.type === 'interim'"` 分支：用 `prose-chat` 正文样式
   `v-html="renderMarkdown(node.text)"` 渲染，无 Collapsible 包裹、无竖线/淡背景。
   放在 thought/tool 同级平铺（timeline 顺序即渲染顺序）。

### Step 3: R3 — contextUsed 持久化存储层

文件：`apps/platform-web/src/storage/assistant-conversations.ts`

6. 新增 `CONTEXT_USED_KEY_PREFIX = "assistant-context-used:"` + `contextUsedKey(id)`。
7. 新增 `export async function saveContextUsed(id: string, value: number): Promise<void>`
   — `localDb.meta.put({ key, value: String(value) })`。
8. 新增 `export async function loadContextUsed(id: string): Promise<number>` —
   读 meta，`Number(record?.value) || 0`，无则 0。
9. `deleteAssistantSession` 末尾连带 `localDb.meta.delete(contextUsedKey(id))`
   （防孤儿，同附件/context 快照清理）。
10. 在 `apps/platform-web/src/storage/index.ts`（barrel）导出 saveContextUsed /
    loadContextUsed（若 barrel 存在且需要）。

### Step 4: R3 — AssistantView 读写 contextUsed

文件：`apps/platform-web/src/views/AssistantView.vue`

11. import `saveContextUsed`, `loadContextUsed`。
12. `send()` 成功后 `contextUsed.value = result.usage.input` 处，同时
    `void saveContextUsed(sessionId, result.usage.input)`。
13. `loadActiveSession()` 末尾 `await scrollToBottom()` 前加
    `contextUsed.value = await loadContextUsed(session.id)`。
14. `handleSelectSession` 加载目标会话 messages 后加
    `contextUsed.value = await loadContextUsed(id)`。
15. `handleCreateSession` 新会话 `contextUsed.value = 0`。
16. `handleDeleteSessionById` 删除后若切到 nextId，`loadContextUsed(nextId)` 恢复；
    新建会话则 0。

### Step 5: R1 — 焦点切换滚动保存/恢复

文件：`apps/platform-web/src/views/AssistantView.vue`

17. import `useRoute` from `vue-router`。
18. 新增 `const lastScrollTop = ref(0)`。
19. `handleScroll` 内追加：`lastScrollTop.value = el.scrollTop`（记录每次滚动
    最终位置，含用户主动滚到顶→记 0）。
20. `watch(() => route.fullPath, (to, from) => { ... })`：
    - 离开助手路由（from 匹配 `/assistant`，to 不匹配）：若 `messageListRef.value`
      存在，`lastScrollTop.value = messageListRef.value.scrollTop`。
    - 进入助手路由（to 匹配 `/assistant`，from 不匹配或首次）：`nextTick(() =>
      requestAnimationFrame(() => restoreScrollTop()))`。
21. `restoreScrollTop()`：读 `messageListRef.value`，若 `scrollTop === 0 &&
      scrollHeight > clientHeight && lastScrollTop.value > 0`，则
      `scrollTop = lastScrollTop.value`。否则不动（用户真在顶部或内容不足）。
22. 路由匹配用 `route.path`（不含 query）判断是否 `/assistant` 前缀，避免 query
    变化误触发。

### Step 6: 验证

23. `npm run build:web` 通过（type-check + build）。
24. playwright 宽屏验证 AC1：助手对话滚动到中段 → 切设置 → 切回 → scrollTop 保持。
25. playwright 宽屏验证 AC2：触发工具调用轮 → 过渡文本轮结束后仍可见。
26. 验证 AC3：对话若干轮 → 刷新 → 上下文环 used 恢复。
27. 窄屏（resize < 640）验证 AC1 同样保持。

## 验证命令

```bash
npm run build:web          # type-check + vite build
```
playwright 手动验证 AC1/AC2/AC3（连 localhost:5173）。

## 风险文件 / 回滚点

- `useAssistantTimeline.ts` — interim 节点逻辑，回滚恢复 tool_calls 分支丢弃
  streamingText 即可。
- `AssistantView.vue` — 三处改动（模板 interim、contextUsed 读写、scroll 恢复），
  各自独立可单独回滚。
- `assistant-conversations.ts` — 新增函数，不改现有结构，回滚删函数即可。
- `style.css` — R1 不改 CSS（窄屏 display:none 保留，靠 JS 恢复覆盖）。

## task.py start 前检查

- [ ] design.md R1/R2/R3 方案与用户确认一致（R2 平铺正文样式、R1 路由 watch 恢复）
- [ ] 无遗留开放问题
