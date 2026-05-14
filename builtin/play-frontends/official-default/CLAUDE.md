# official-default (play-frontend) — 模块 CLAUDE.md

[根目录](../../../CLAUDE.md) > [builtin](../../) > [play-frontends](../) > **official-default**

---

## 1. 模块职责

官方默认游玩前端。作为 Tsian 原型期"最小可玩 + 最齐全调试观测"的参考实现。

包名：`@tsian/play-frontend-official-default`，workspace 私有，被 `apps/platform-web/src/package-loader/official-default.ts` 直接 import。

主要能力：

- 主线视图：渲染对话历史 + 玩家输入
- 顶部状态条：渲染章节 / 当前位置 / 时间 / 天气等 globals
- 顶部 demo 区（I5）：桥写 API 演示按钮（`+1` / `重置`），调 `bridge.runtime.updateGlobals("demo.counter", n)`，下一轮工作流可读 `{{globals.demo.counter}}`
- 多个调试面板：AI / 检索 / 事件 / 档案 / 回溯 / 快照 / 工作流
- 通过 `PlayFrontendBridge` 完成所有运行时读写

---

## 2. 入口与启动

| 入口 | 路径 |
|------|------|
| 包入口 | `src/index.ts`（导出 `manifest` 与 `mount`） |
| Manifest | `id="official-default"`, `entry="src/index.ts"`, `runtimeVersion="0.0.0"` |

集成位置：`apps/platform-web/src/package-loader/official-default.ts`。

---

## 3. 对外接口

### Manifest

```ts
const manifest: PlayFrontendManifest = {
  id: "official-default",
  name: "官方默认前端",
  version: "0.1.0",
  entry: "src/index.ts",
  runtimeVersion: "0.0.0"
}
```

### `mount(options)`

`options` 形态：

```ts
{
  container: HTMLElement
  bridge: PlayFrontendBridge
}
```

返回 `{ unmount(): Promise<void> }`。

挂载后：

1. 通过 `bridge.runtime.getRuntimeSnapshot` 读取当前 snapshot
2. 通过 `bridge.query` 拉取 `history / events / archives / mod-static / ai-debug / retrieval-debug / checkpoints / workflow-debug`
3. 渲染 6 个面板 + 主线视图
4. 玩家提交输入 → `bridge.interaction.sendMessage` → 重新拉取 snapshot 与各资源

---

## 4. 关键依赖与配置

- `@tsian/contracts` — 类型契约
- 无运行时第三方依赖（纯 DOM）

---

## 5. 数据模型

不持有数据；所有数据走 Bridge，从平台运行时按需查询。

---

## 6. 测试与质量

随 `apps/platform-web` 构建做类型校验；功能验证依靠浏览器手动 smoke。

---

## 7. 常见问题 (FAQ)

**Q：能换成 Vue / React 吗？**
A：原型期为了避免重复打包 framework 与简化 mount 协议，刻意只用原生 DOM。前端框架化是后续话题。

**Q：调试面板多到看不过来？**
A：故意为之 —— 原型期最重要的事是看清主链每一段在做什么。

---

## 8. `src/index.ts` 分区导览（≈864 行）

整个游玩前端是单文件、零运行时第三方依赖。文件结构按「类型声明 → 样式注入 → 通用渲染工具 → 6 个面板渲染器 → mount 主流程」排布：

| 区域 | 行号 | 关键符号 | 职责 |
|------|------|---------|------|
| **本地调试类型** | `11–86` | `RetrievalCandidateDebugRecord`、`RetrievalSemanticDebugRecord`、`RetrievalDebugRecord`、`AiDebugRecord`、`CheckpointSummary`、`InspectorTab` | 与平台 `query.query` 返回结构对齐的本地副本（避免对契约包做强依赖） |
| **样式注入** | `103–175` | `ensureStyles`、`STYLE_ID` | 单例 `<style id="tsian-official-default-style">` 注入；只在 mount 时执行一次 |
| **通用渲染工具** | `177–250` | `empty`、`turn`、`currentTime`、`formatTime`、`formatGlobalValue`、`runtimeGlobals` | 把 snapshot / `globals` 抹平成可显示的字符串；时间统一格式 `YYYY-MM-DD HH:mm` |
| **顶部 mod 概览 / 场景状态** | `251–328` | `renderModOverview`、`renderSceneStatus`、`renderSnapshot` | 顶部 hero 区与"快照"面板共享底层结构 |
| **7 个面板渲染器** | `330–678` | 见下表 | 每个面板独立函数，参数固定为 `(target, items[, onAction])` |
| **mount 主流程** | `680–864` | `mountOfficialDefaultFrontend` | DOM 结构 + tab 切换 + `refresh()` 编排 + 输入提交 + cleanup |

### 7 个调试面板（按 tab 顺序）

| Tab | 渲染函数 | 行号 | 数据源 (`bridge.query.query` resource) | 关键展示字段 |
|-----|----------|------|---------------------------------------|-------------|
| **AI** | `renderAiDebug` | `635–678` | `ai-debug` (`AiDebugRecord[]`) | `label · kind · model · createdAt`；逐条列出 `messages`（按 role 标注）和响应文本 / `error` / embedding 的 `vectorCount × dimensions` |
| **检索** | `renderRetrieval` | `479–633` | `retrieval-debug` (`RetrievalDebugRecord[]`，仅取 `[0]`) | 玩家输入 / 直接命中实体 / 当前在场实体 / 预设事件钩子（`selected/候选`） / 桥接关联实体 / 注入档案（带 `source · presence`） / AI 增强（关键词、事件 ID、档案 ID）/ 本轮参数；下方逐条展示候选事件，含 `final / structure / semantic` 分数与状态标签 |
| **事件** | `renderEvents` | `381–418` | `events` (`EventRecord[]`) | 状态徽章（`ongoing` / `done`）、`time · id`、`entityTags` chips、`entityArchiveIds` 强绑定、正文 |
| **档案** | `renderArchives` | `420–477` | `archives` (`ArchiveRecord[]`) | `name · type`、`presence · id`、`aliases`、`linkedNames` 关联实体、`linkedArchiveIds`、`background / situation / focus` 三段式 |
| **回溯** | `renderCheckpoints` | `330–363` | `checkpoints` (`CheckpointSummary[]`) | `label`、`createdAt · reason`、`回合 N · M 条对话 · K 个事件 · J 个档案`；按钮回调 `onRestore(checkpointId)` 由 mount 主流程接到 `bridge.platform.runAction({ action: "restore-checkpoint", params: { checkpointId } })` |
| **快照** | `renderSnapshot` | `321–328` | `bridge.runtime.getRuntimeSnapshot()` | 复用 `renderSceneStatus` 的 globals 表 + 当前 `turn / currentTime` |
| **工作流** | `renderWorkflow` | — | `workflow-debug` (`WorkflowOutputsSnapshot` JSON) | 展示各节点状态机（pending / running / succeeded / failed / aborted）+ 节点输出 JSON |

### mount 主流程要点

- **DOM 模板**：`mountOfficialDefaultFrontend` 顶层一次性 `innerHTML` 出整个 `od-hero + od-layout`，左右双栏（对话主线 + Inspector 标签页）
- **tab 切换**：`syncTabs()` 用 `is-active` class 切；默认 `activeTab = "ai"`
- **`refresh()` 编排**：一次轮询调用 8 个查询（snapshot、history、events、archives、mod-static、ai-debug、retrieval-debug、checkpoints、workflow-debug），把结果分发给对应渲染器
- **轮次提交**：`onSubmit` 读 `currentTime(snapshot)` → `bridge.interaction.sendMessage({ content, narrativeTimeText })` → `refresh()` → 滚动到底
- **回溯 hook**：`renderCheckpoints` 的 `onRestore` 失败时 `window.alert`，成功后立即 `refresh()` + 滚动到底
- **cleanup**：返回的函数解绑 submit 监听并清空 container

### 几个值得记住的不变量

1. **零运行时第三方依赖** — 刻意只用原生 DOM；引入 Vue/React 是后续话题，不要在原型期擅自加
2. **本地类型不抢契约** — `RetrievalDebugRecord` 等本地声明是为了让前端与契约解耦；契约更新后这里允许局部不一致，但 `mount` 入口签名以 `@tsian/contracts` 的 `PlayFrontendBridge` 为准
3. **`refresh()` 是幂等读** — 任何 mutation（发送消息、恢复 checkpoint）后必须调用一次 `refresh()` 重拉全部资源，不要做局部增量更新
4. **`renderRetrieval` 只看 `items[0]`** — 检索调试是按存档单缓冲（见 `platform-host` 的 `retrievalDebugBySave`），UI 上不展示历史检索

---

## 9. 相关文件清单

- `src/index.ts`（864 行，分区导览见 §8）
- `package.json`、`tsconfig.json`

---

## 10. 变更记录 (Changelog)

| 时间 | 变更 |
|------|------|
| 2026-05-05 17:52:53 | 初始化架构师首次生成模块文档 |
| 2026-05-05 18:18:00 | 补扫 `src/index.ts`：新增 §8 分区导览（6 个面板按 tab/行号/数据源/关键字段建表 + mount 主流程要点 + 4 条不变量） |
| 2026-05-11 | I5：顶部新增"桥写 API Demo"区（`+1` / `重置` 按钮调 `bridge.runtime.updateGlobals("demo.counter", n)`，下一轮工作流读 `{{globals.demo.counter}}`）；Inspector 加第 7 个 tab"工作流"展示 `workflow-debug` 资源；`InspectorTab` 扩展 `"workflow"` 字面量 |

---

_文档生成时间：2026-05-05 17:52:53_
