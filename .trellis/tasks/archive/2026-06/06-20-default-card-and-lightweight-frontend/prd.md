# Default Card and Lightweight Frontend

## Parent

- `.trellis/tasks/06-20-content-generation-foundation`

## Goal

(a) 做一个通用轻量 AIRP 文字前端（3 文件 packaged，`tsian.play-bridge.v1`）；(b) 把内置空白卡定位为"模板"，卡库加"创建"入口，点即复制模板成一张绑该前端的本地卡并切为活跃。让出厂体验从"内置卡改不了、`/play` 报未配置"变为"一键创建可游玩模板卡"。

继承并取代已归档任务 `06-15-default-packaged-game-frontend` 的意图（packaged 默认前端 + iframe bridge），并扩展模板卡 + 创建入口。

## Requirements

### 轻量通用前端

- 实现 `tsian.play-bridge.v1` postMessage 握手：`hello` → 等 `ready`（拿 sessionId + methods）→ 发 `request`（按 sessionId/id 关联）→ 收 `response`/`event`。
- 3 个静态文件：`frontend/index.html` + `frontend/style.css` + `frontend/app.js`，无构建管线。HTML 用相对引用 `style.css` / `app.js`（SW 按原路径 serve，相对引用自动解析）。
- 渲染：`runtime.getRuntimeSnapshot` 取 `{ turn, messages: [{role, content}], globals? }` 渲染最近叙述 + 历史对话。
- 输入：输入框 `interaction.sendMessage({ content })`。
- 事件订阅：`turn-delta`（流式增量追加）、`turn-tool`（工具节点状态 loading/running/success/failed）、`turn-round-end`、`turn-completed`（刷新 snapshot）。
- 视觉：暗金 brutalist 风呼应平台主题（`style.css` 取色对齐 `apps/platform-web/src/style.css` 的 neon/elevated/void 调色）。
- markdown 渲染：前端独立无模块系统，`app.js` 内联轻量 markdown→HTML（标题/段落/强调/列表/代码），不引外部依赖（决策见 design）。

### 内置卡 = 模板 + 创建入口

- 卡库（`GameCardLibraryView.vue`）加"创建"入口：调新 platform-host 函数 → 复制 builtin 模板卡为本地卡 + 注入 3 前端文件 + 设 `manifest.frontend = { kind: "packaged", entry: "frontend/index.html", bridgeVersion: "tsian.play-bridge.v1" }` + 切活跃。无额外按钮，"创建"即默认模板卡。
- 空状态主按钮 + 右键菜单项都提供创建入口。
- 创建后自动切到该卡，`/play` 立即可用。
- 高级玩家可导出卡包到本地进一步魔改（现有导出路径不动）。

### 内置卡 UI 语义微调

- 保持 builtin 卡作为 fallback 锚（`getBuiltinBlankGameCard` 兜底逻辑不动——28 处引用中 platform-host/saves 的兜底不改）。
- UI 上从"出厂默认游戏"转为"模板"：详情视图 / 库视图对 builtin 的"改不了挺烦"体验改善——至少文案明确"这是模板，请创建副本"，并把"创建副本/创建"作为主操作引导。

## Acceptance Criteria

- [ ] 卡库点"创建"生成一张绑定轻量前端的本地卡，并自动切为活跃卡。
- [ ] 该卡 `/play` 加载前端不报"游戏前端未配置"；完成 postMessage 握手；渲染 snapshot（无 key 验加载 + 空状态 + 握手 ready；有 key 验发消息 → 流式回复）。
- [ ] `frontend/index.html` / `style.css` / `app.js` 存于卡的 `gameCardFrontendFiles`，可在工作区/资源管理器见到。
- [ ] 导出该卡的卡包含 frontend 文件。
- [ ] 内置卡在 UI 上明确为"模板"，主操作引导创建副本。
- [ ] `npm run build:web` 通过（先 `build:contracts` + `build:runtime-core`）。
- [ ] dev server 冒烟：`/library` 创建卡、`/play` 加载前端、`/workspace` 见 frontend 文件。

## Constraints

- 不新增构建管线（前端是静态文件，vite 不参与）。
- 不改 Service Worker（`public/tsian-game-card-frontend-sw.js`）。
- 不动 `@tsian/contracts`（`bridge.ts` / `game-card.ts`）。
- 不扩 `platform.runAction`（创建走 UI + 现有 storage 原语）。
- 不改 builtin 卡兜底逻辑（fallback 锚保留）。
- 前端文件来源用字符串常量（同 `MEMORY_MAINTENANCE_SCRIPT_JS` 模式），不放 `public/`（避免被当平台静态资源）。

## Out Of Scope

- 组件化富前端（本阶段三文件，后续可加组件支持与自定义状态）。
- 平台级 create-card platform action（后续任务）。
- 助手创作 Skills（子2 负责）。
- 真实 LLM 往返验证（需 provider + API key）。

## Dependencies

- 无前置子任务依赖（本任务可独立起步）。
- 是子2 端到端验证的前置（子2 需要可游玩卡测内容生成）。
