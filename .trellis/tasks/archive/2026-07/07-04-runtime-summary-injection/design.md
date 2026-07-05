# design.md — 当前上下文多消息注入 storyteller

对齐 PRD `.trellis/tasks/07-04-runtime-summary-injection/prd.md`。依赖任务已完成：
`07-04-frontend-runtime-render-infra`、`07-05-runtime-scene-character-schema-ui-align`。

## 1. 目标与范围

- 在玩家发送行动前，前端基于 runtime.json 的当前上下文索引，读取 runtime/world
  变量、当前场景、当前视角角色，编译成多条 storyteller 友好的 injection message。
- 使用平台已存在的 `interaction.sendMessage` 通道 `injection?: InjectionMessage[]`
  字段承载，不改动契约、不改动 storyteller 侧逻辑。
- 本任务不负责：schema 维护、剧情推理、递归展开 present、runtime 更新、UI 开关。

## 2. 边界与非目标

- **不**引入新协议、新持久化文件；injection 是发送前的临时派生上下文。
- **不**新增 UI 开关（开关走 runtime.extensions flag）。
- **不**改 useRuntime / useScene / useEntity 的响应式契约（只调用 workspace.read）。
- **不**阻断输入编辑；阻断只在按下发送后触发，输入内容保留。
- **不**递归展开 scene.present、character.containers 指向的实体。

## 3. 涉及模块与依赖

| 层 | 文件 | 作用 |
|---|---|---|
| lib（新增） | `apps/play-frontend-dev/src/lib/context-injection.ts` | 纯函数 `buildContextInjection` |
| composables（改动） | `apps/play-frontend-dev/src/composables/useTsian.ts` | send 时构建 injection、暴露 lastSendError |
| UI（改动） | `apps/play-frontend-dev/src/components/story/StoryView.vue` | 输入区上方渲染 lastSendError banner |
| 类型复用 | `apps/play-frontend-dev/src/lib/runtime-types.ts::Runtime` | runtime 结构 |
| 类型复用 | `apps/play-frontend-dev/src/lib/character-types.ts::CharacterEntity` | 主角字段 |
| 契约复用 | `packages/contracts/src/runtime.ts::InjectionMessage` | 注入消息形状 |
| 桥接复用 | `packages/play-bridge/src/tsian-api.ts::send(text, { injection })` | 已有通道 |

## 4. 关键决策

- **D1（分层）** injection 构建放 `lib/context-injection.ts` 纯函数，无 vue 依赖，
  仅入参 `workspace.read` + `runtime` 快照。理由：与游戏卡完全解耦、可单测、可复用。
- **D2（时机）** 发送时即时构建。理由：轮次预烘缓存会引入状态一致性问题；
  runtime 已在 `useRuntime` 单例常驻，scene/character 每轮读一次开销可接受。
- **D3（消息拆分）** runtime/world 一条 + 每个 activeScene 一条 + protagonist 一条。
  理由：R2 明确要求按信息块拆条以减小 prompt cache 失效范围。
- **D4（role/position）** 全部 `role="system"`、`position="before-input"`。
  理由：storyteller 语义上视为环境提示；出现在玩家输入之前更符合上下文顺序。
- **D5（阻断而非降级）** 依用户决策：runtime.status !== "ready" / scene 或 character
  ref 存在但 load 失败 → 阻断 send。ref 缺省不阻断，跳过该块。理由：
  用户认为降级会导致核心流程弱化、AI 输出变差。
- **D6（开关）** `runtime.extensions.frontendInjection.enabled === false` short-circuit：
  不发 injection，也不阻断。默认开启。无 UI 开关。
- **D7（错误反馈）** 复用 StoryView 已有错误 banner 区（同 sync-failed 区域配色），
  不新增 toast。文本模式："上下文未就绪：<原因>"。
- **D8（present 不展开）** scene block 只列 `present[*].ref`，不去读 character/entity。
  R4 显式要求，且和 R8 分工一致（storyteller 需要时用工具/资料员）。

## 5. 数据流

```
StoryView.onSend(text)
 └─ useTsian.send(text)
     1. 状态检查（ready / streaming / syncPhase）
     2. useRuntime() 快照
     3. buildContextInjection({ workspace: tsian.workspace, runtimeData }):
          - kill-switch: extensions.frontendInjection.enabled === false → { status: "ok", messages: [] }
          - runtime.status !== "ready" 或 runtime === null → { status: "blocked", reason: "runtime-not-ready" }
          - 拼 runtime/world message
          - Promise.all(load scenes) — 有 ref 但 load 失败 → { status: "blocked", reason: "scene-load-failed", detail }
          - load protagonist（如有 ref） — 失败同理阻断
          - 组装 messages
        → { status: "ok", messages } | { status: "blocked", reason, detail }
     4a. ok:
          - 推 user StreamItem
          - turnPhase = "streaming"
          - tsian.send(text, { injection: messages }) （messages 空数组时省略 injection）
     4b. blocked:
          - lastSendError.value = { reason, detail }
          - 不推 user item、不切 turnPhase、不发 tsian.send
```

## 6. 契约与类型（新增于 `lib/context-injection.ts`）

```ts
import type { Runtime, RuntimeData } from "./runtime-types"
import type { InjectionMessage } from "@tsian/contracts"

export interface BuildInjectionInput {
  workspace: {
    read: (path: string, scope: "save-runtime") => Promise<{ content: string } | null>
  }
  runtimeData: RuntimeData
}

export type BuildInjectionBlockedReason =
  | "runtime-not-ready"
  | "scene-load-failed"
  | "protagonist-load-failed"

export interface BuildInjectionOk {
  status: "ok"
  messages: InjectionMessage[]
}

export interface BuildInjectionBlocked {
  status: "blocked"
  reason: BuildInjectionBlockedReason
  detail?: string
}

export type BuildInjectionResult = BuildInjectionOk | BuildInjectionBlocked

export function buildContextInjection(input: BuildInjectionInput): Promise<BuildInjectionResult>
```

`useTsian` 新增只读 `lastSendError: Ref<{ reason: BuildInjectionBlockedReason; detail?: string } | null>`。

## 7. 三个 block 的格式规范

### 7.1 runtime/world block（必发）

```
【当前上下文·世界】
- 回合：<turn>
- 剧情时间：<worldTime | 未知>
- 天气/环境：<weather | 未知>
- 地点：<location.name>（ref: <location.ref>） | 未指定
- 活跃场景：
  · <ref> <name>
  · ...
  或 "未指定"
- 当前视角角色：<protagonistRef.name>（ref: <protagonistRef.ref>） | 未指定
```

### 7.2 active scene block（每个 activeSceneRef 一条）

从 `save/scenes/<localId>.json` 读，`sceneId="scene:<localId>"`：

```
【当前场景】<name>（ref: scene:<localId>）
- 状态：<status | 未知>
- 地点：<location.ref | 未指定>
- 简介：<brief | (略)>
- 在场者：
  · <ref>
  · ...
  或 "无"
```

不展开 `present[*].ref` 指向的角色（R4）。

### 7.3 protagonist block（若 protagonistRef 有值）

从 `save/entities/character/<localId>.json`：

```
【当前视角角色】<name>（ref: character:<localId>）
- 简述：<brief>
- 身份：年龄 <age> · 性别 <gender> · 身份 <role> · 组织 <affiliation> · 境界 <realm>
  （缺省字段跳过）
- 外貌：<appearance>
- 属性：体魄 <n> · 悟性 <n> · 气运 <n> · 根骨 <n> · 法力 <n> · 魅力 <n>
- 量表：
  · <name>: <value>/<max> <unit> [tone]
- 状态：
  · <name>（<polarity>）— <description>
- 目标：
  · 当前：<current>
  · 近期：<shortTerm>
  · 长期：<longTerm>
```

## 8. 路径工具

复用现有规则（不新加，直接 inline 到 `context-injection.ts`）：

- scene: `sceneRef` 形如 `"scene:<localId>"` → `save/scenes/<localId>.json`
  （见 `useScene.ts:20`）。
- character: `characterRef` 形如 `"character:<localId>"` →
  `save/entities/character/<localId>.json`（见 `useEntity.ts:21`）。

## 9. 阻断策略详解

| 情况 | 处理 |
|---|---|
| runtime.status !== "ready" 或 runtime === null | 阻断 `runtime-not-ready` |
| activeSceneRefs 为空 | 不阻断，跳过 scene 块 |
| activeSceneRefs[i].ref 存在但文件 null 或 JSON 解析失败或 read 抛错 | 阻断 `scene-load-failed`，detail=ref |
| protagonistRef === null | 不阻断，跳过 protagonist 块 |
| protagonistRef.ref 存在但读取失败 | 阻断 `protagonist-load-failed`，detail=ref |
| extensions.frontendInjection.enabled === false | short-circuit 返回 messages=[]（等同不注入） |

阻断态下：
- `useTsian.send` 不推 user StreamItem，不切 turnPhase，不调用 `tsian.send`。
- `lastSendError` 置为 `{ reason, detail }`。
- 用户再次点击发送前保持显示；下次成功 send 前置清空 `lastSendError`。

## 10. 兼容性 / 回滚

- 契约层零改动：`InjectionMessage`、`MessageInteractionRequest.injection` 已存在。
- 平台侧零改动。
- 回滚只需 `useTsian.send` 恢复直接 `tsian.send(text)` 单参调用；
  `context-injection.ts` 与 banner UI 可保留为死代码或直接删除。

## 11. 风险与后续

- 风险：每轮同步读多个文件带来的开销。当前 workspace 是内存实现，可接受。
  若后期换真实存储，可加短期 in-memory cache（不属本任务）。
- 后续可扩展：将 injection block 组扩展到 present 中的关键角色（当前明确不做）。
