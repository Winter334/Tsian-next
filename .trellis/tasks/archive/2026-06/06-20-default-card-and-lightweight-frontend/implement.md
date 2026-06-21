# Implement: Default Card and Lightweight Frontend

## Execution Checklist

### Step 1: 前端文件常量
- [ ] 新建 `apps/platform-web/src/storage/default-frontend-files.ts`。
- [ ] 导出 `DEFAULT_FRONTEND_BINDING`（packaged, entry `frontend/index.html`, bridgeVersion `tsian.play-bridge.v1`）。
- [ ] 导出 `defaultFrontendFiles()` 返回 3 个 `PutLocalGameCardFrontendFileInput`（index.html / style.css / app.js）。
- [ ] `index.html`：骨架，`<link rel="stylesheet" href="style.css">` + `<script src="app.js" defer></script>`，消息列表容器 + 输入框 + 发送按钮 + 状态栏（回合计数/连接状态）。
- [ ] `style.css`：暗金 brutalist 取色（void 背景、neon 强调、elevated 面板、直角边框、mono 字体），对齐 `apps/platform-web/src/style.css` 的 CSS 变量值（硬编码而非引用，前端独立）。
- [ ] `app.js`：postMessage 握手（hello→ready）+ `call(method, params)` RPC + 事件处理（turn-delta/tool/round-end/completed）+ snapshot 渲染 + 流式缓冲 + 工具节点 UI + 内联 markdown 渲染 + 输入发送。
- [ ] **验证**：`vue-tsc` 不报（纯字符串常量，无类型依赖问题）。

### Step 2: 创建卡函数
- [ ] `apps/platform-web/src/platform-host/index.ts` 加 `createDefaultPlatformGameCard(input?: { name?: string })`。
- [ ] 实现：`copyPlatformGameCardAsLocal(BUILTIN_BLANK_GAME_CARD_ID, { name: input?.name ?? "我的游戏" })` → `putLocalGameCard({ manifest: {...copy.manifest, frontend: DEFAULT_FRONTEND_BINDING}, contentFiles: copy.contentFiles, frontendFiles: defaultFrontendFiles(), source: "local" })` → `setPlatformActiveGameCard(record.id)` → return record。
- [ ] 导入 `DEFAULT_FRONTEND_BINDING`, `defaultFrontendFiles` from `../storage/default-frontend-files`。
- [ ] 导出 `createDefaultPlatformGameCard`。
- [ ] **验证**：`build:contracts && build:runtime-core` 通过。

### Step 3: 卡库创建入口
- [ ] `GameCardLibraryView.vue` 空状态：把"打开应用市场"按钮旁加主按钮"创建游戏"（或替换空状态主操作），调 `createDefaultPlatformGameCard()` → refreshCards + openCard + toast。
- [ ] 右键空白菜单（`openBlankContextMenu`）加"创建游戏"项（与"导入卡包"并列）。
- [ ] 导入 `createDefaultPlatformGameCard` from `../platform-host`。
- [ ] loading 状态反馈（creating ref）。
- [ ] **验证**：dev server `/library` 空状态见"创建游戏"按钮，点击生成卡并切活跃。

### Step 4: builtin 卡 UI 语义微调
- [ ] `GameCardDetailView.vue`：builtin 卡标题旁加"模板"标签。
- [ ] builtin 卡禁用操作提示改为"模板卡不能直接 X，请先创建副本"，加"创建副本"操作按钮（调 `copyPlatformGameCardAsLocal` 或 `createDefaultPlatformGameCard`）。
- [ ] `GameCardLibraryView.vue`：builtin 卡 tile 加"模板"角标。
- [ ] **验证**：dev server 打开 builtin 卡详情见"模板"标签 + 引导创建。

### Step 5: 前端 JS 实现完整性
- [ ] `app.js` 实现完整握手 + RPC + 渲染 + 事件（如 Step 1 已写完整则仅 review）。
- [ ] 内联 markdown：escape HTML → 标题/段落/强调/列表/代码块转换。
- [ ] 错误处理：`response.ok === false` 显示 error；超时/断连兜底。
- [ ] **验证**：dev server `/play`（创建的卡）见前端加载、握手 ready、snapshot 渲染（无 key 时 messages 空，显示空状态）。

### Step 6: 构建全绿
- [ ] `npm run build:contracts` 通过。
- [ ] `npm run build:runtime-core` 通过。
- [ ] `npm run build:web` 通过（`vue-tsc -b && vite build`）。
- [ ] **验证**：三绿。

### Step 7: dev server 冒烟
- [ ] `npm run dev:web`，浏览器开 `/#/library`。
- [ ] 空状态点"创建游戏" → 生成卡 + 切活跃 + 跳详情。
- [ ] `/#/play` → 前端加载（不报"未配置"）、握手、空状态渲染。
- [ ] `/#/workspace` → 见 `frontend/` 目录下 3 文件。
- [ ] 右键库空白 → "创建游戏"项可用。
- [ ] builtin 卡详情 → "模板"标签 + 创建副本引导。
- [ ] **验证**：无 key 路径全过。

### Step 8: 收口
- [ ] spec 更新（`trellis-update-spec`：state-management / type-safety 记 packaged 前端 + 模板卡创建路由）。
- [ ] commit（用户确认后）。
- [ ] 登记真实 LLM 往返 PV（待 provider + key）。

## Validation Commands

```bash
npm run build:contracts
npm run build:runtime-core
npm run build:web
npm run dev:web   # 冒烟，手动浏览器验证
```

## Rollback Points

- Step 1 后：删 `default-frontend-files.ts`。
- Step 2 后：移除 `createDefaultPlatformGameCard`。
- Step 3/4 后：还原 UI（git checkout 对应文件）。
- 已创建的本地卡是用户数据，不回滚。

## Review Gates

- Step 2 后 review 创建函数数据流正确性（copy + put + setActive 三步）。
- Step 5 后 review 前端 JS 握手与事件处理完整性。
- Step 6 构建三绿是硬 gate。
