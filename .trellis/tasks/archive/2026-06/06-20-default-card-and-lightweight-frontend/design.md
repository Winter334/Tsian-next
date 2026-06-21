# Design: Default Card and Lightweight Frontend

## Boundaries

本任务改 3 处代码 + 1 处新文件：

1. **新文件** `apps/platform-web/src/storage/default-frontend-files.ts` —— 3 前端文件内容常量 + 导出 `DEFAULT_FRONTEND_BINDING` + `defaultFrontendFiles()` 工厂。
2. **`apps/platform-web/src/platform-host/index.ts`** —— 新增 `createDefaultPlatformGameCard(input?: { name?: string })` 组合函数。
3. **`apps/platform-web/src/views/GameCardLibraryView.vue`** —— 加"创建"入口（空状态主按钮 + 右键菜单项）。
4. **`apps/platform-web/src/views/GameCardDetailView.vue`** —— builtin 卡 UI 语义微调（文案"模板" + 引导创建）。

不碰：contracts、SW、agent-runtime、bridge 实现路由、`bridge.ts`。

## Frontend Architecture (app.js)

纯 postMessage，无全局 API。状态机：

```
connecting ──hello──▶ waiting-ready ──ready──▶ idle
idle ──send──▶ sending ──turn-delta──▶ streaming ──turn-completed──▶ idle
```

### RPC 封装

```js
const CHANNEL = "tsian.play-bridge.v1"
let sessionId = null, nextReqId = 1
const pending = new Map()  // id → {resolve, reject}

window.addEventListener("message", (e) => {
  const msg = e.data
  if (msg?.channel !== CHANNEL) return
  if (msg.kind === "ready") { sessionId = msg.sessionId; onReady(msg.methods); return }
  if (msg.kind === "response") {
    const cb = pending.get(msg.id); pending.delete(msg.id)
    msg.ok ? cb.resolve(msg.result) : cb.reject(msg.error)
    return
  }
  if (msg.kind === "event") { onEvent(msg.event, msg.payload); return }
})

function call(method, params) {
  const id = String(nextReqId++)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    window.parent.postMessage({ channel: CHANNEL, kind: "request", sessionId, id, method, params }, "*")
  })
}
```

启动：`window.parent.postMessage({ channel: CHANNEL, kind: "hello" }, "*")`。

### 渲染层

- `renderSnapshot(snapshot)`：`snapshot.state.messages` → 消息列表（role `assistant`/`user` 区分左右/样式），`state.turn` → 回合计数。
- `turn-delta` payload `{ agentId, delta, turn, round, kind: "reasoning"|"content" }`：`content` 增量追加到流式缓冲并实时渲染；`reasoning` 折叠为"思考"节点（可后续展开）。
- `turn-tool` payload `{ callId, name, status, output? }`：工具节点按 callId 去重，状态 glyph（loading/running → …，success → ✓，failed → ✗）。
- `turn-completed` payload `{ snapshot }`：重渲染完整 snapshot，清流式缓冲。
- `turn-round-end`：标记一轮结束（折叠思考节点）。

### markdown 渲染决策

**内联轻量 markdown→HTML**，不引 marked/CDN。理由：前端是无模块系统的静态文件，引外部依赖要么 CDN（离线/网络依赖、CSP 风险）要么内联整库（增重）。AIRP 叙述主要用标题/段落/强调/列表/代码块，手写 ~60 行正则转换足够。`dangerouslySetInnerHTML` 风险用最小转义（先 escape HTML 再套规则）控制。

## Create Card Data Flow

```
GameCardLibraryView.createDefault()
  → createDefaultPlatformGameCard({ name })
      1. copyPlatformGameCardAsLocal(BUILTIN_BLANK_GAME_CARD_ID, { name: name ?? "我的游戏" })
         → 得 copy（content + 新 id，无 frontend 文件）
      2. putLocalGameCard({
           manifest: { ...copy.manifest, frontend: DEFAULT_FRONTEND_BINDING },
           contentFiles: copy.contentFiles,
           frontendFiles: defaultFrontendFiles(),  // [{path:"frontend/index.html",...},...]
           source: "local",
         })
         → 得 record（含前端文件 + 绑定）
      3. setPlatformActiveGameCard(record.id)
      4. return record
  → refreshCards() + openCard(record.id) 或 toast
```

`copyPlatformGameCardAsLocal` 已存在（`platform-host:2216`），复制 content + 现有 frontend 文件（builtin 无 frontend 文件，故 frontendFiles 为空）+ 新 id。第 2 步用 `putLocalGameCard` 把 3 前端文件 + 绑定补上。`setPlatformActiveGameCard` 切活跃。

### `default-frontend-files.ts` 结构

```ts
import type { GameCardFrontendBinding, PutLocalGameCardFrontendFileInput } from ...
import { BUILTIN_BLANK_GAME_CARD_ID } from "./game-cards"

export const DEFAULT_FRONTEND_BINDING = {
  kind: "packaged" as const,
  entry: "frontend/index.html",
  bridgeVersion: "tsian.play-bridge.v1" as const,
}

const FRONTEND_INDEX_HTML = `<…骨架…>`
const FRONTEND_STYLE_CSS = `<…暗金 brutalist…>`
const FRONTEND_APP_JS = `<…握手+RPC+渲染…>`

export function defaultFrontendFiles(): PutLocalGameCardFrontendFileInput[] {
  return [
    { path: "frontend/index.html", data: FRONTEND_INDEX_HTML, mediaType: "text/html" },
    { path: "frontend/style.css", data: FRONTEND_STYLE_CSS, mediaType: "text/css" },
    { path: "frontend/app.js", data: FRONTEND_APP_JS, mediaType: "text/javascript" },
  ]
}
```

文件内容用字符串数组 `.join("\n")` 模式（同 `workspace.ts` 的 `MEMORY_MAINTENANCE_SCRIPT_JS`），避免模板字符串里大量转义。

## Handshake Sequence

```
frontend                platform (remote-iframe-bridge.ts)
   │ ──hello──────────▶ │
   │                    │ source === iframe.contentWindow? yes
   │ ◀────ready───────── │ { sessionId, methods:[5] }
   │                    │
   │ ──request─────────▶ │ runtime.getRuntimeSnapshot
   │ ◀──response────── │ { state: {turn, messages[]} }
   │ render             │
   │                    │
   │ ──request─────────▶ │ interaction.sendMessage {content}
   │ ◀──response────── │ { snapshot }
   │ ◀──event turn-delta─ │ (多次, 流式)
   │ ◀──event turn-tool── │ (工具节点)
   │ ◀──event turn-round-end │
   │ ◀──event turn-completed │ { snapshot }
   │ render             │
```

## Builtin Card UI Semantic

`GameCardDetailView.vue` 现有 6 处 `source === "builtin"` 判断（行 613/635/655/755/890/931）禁用编辑/改名/前端/封面等操作。改造：

- 卡片标题旁加"模板"标签（类似库视图的 `loaded` 标签样式）。
- 禁用操作的提示从"内置卡不能 X"改为"模板卡不能直接 X，请先创建副本"，并把"创建副本"作为可点操作（调 `copyPlatformGameCardAsLocal` 或新创建函数）。
- 库视图 builtin 卡 tile 上加"模板"角标。

兜底逻辑（`getBuiltinBlankGameCard` 作为 fallback）不动。

## Tradeoffs

- **内联 markdown vs marked**：选内联，牺牲完整 markdown 支持（表格/脚注等）换零依赖 + 离线可用。后续组件化富前端可换 marked。
- **copy + put 两步 vs 单步**：选两步复用现有 `copyPlatformGameCardAsLocal`，不重写复制逻辑。多一次 `putLocalGameCard`（同 id upsert），开销可忽略。
- **前端文件放 storage 常量 vs public/**：放 storage 常量，避免 vite 把它们当平台静态资源 build 进 dist；它们是卡内容，存 Dexie。

## Compatibility / Rollback

- 新增函数/文件，不改现有行为。builtin 卡兜底不动。
- 回滚：删 `default-frontend-files.ts` + 移除 `createDefaultPlatformGameCard` + 还原 UI 入口。已创建的本地卡保留（用户数据）。
