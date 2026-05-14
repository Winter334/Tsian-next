# @tsian/runtime-core — 模块 CLAUDE.md

[根目录](../../CLAUDE.md) > [packages](../) > **runtime-core**

---

## 1. 模块职责

定义 `RuntimeEngine` 抽象接口。任何运行时实现（当前为浏览器侧 `LocalRuntimeEngine`）都需满足该契约。

包名：`@tsian/runtime-core`，依赖 `@tsian/contracts`。

---

## 2. 入口与启动

| 入口 | 路径 |
|------|------|
| 包入口 | `src/index.ts` → `export * from "./engine"` |
| 接口定义 | `src/engine.ts` |
| 构建命令 | `npm run build:runtime-core` |

---

## 3. 对外接口

```ts
export interface RuntimeEngine {
  getSnapshot(): Promise<RuntimeSnapshotShell>
  sendMessage(input: MessageInteractionRequest): Promise<MessageInteractionResult>
  query<T = unknown>(request: DeepQueryRequest): Promise<DeepQueryResult<T>>
  getPlatformContext(): Promise<PlatformContextShell>
}
```

---

## 4. 关键依赖与配置

- `@tsian/contracts`（workspace）
- TS 5.7

---

## 5. 数据模型

无（仅接口）。所有数据形状来自 `@tsian/contracts`。

---

## 6. 测试与质量

`npm run build:runtime-core` 必须通过。

---

## 7. 常见问题 (FAQ)

**Q：为什么不把 `LocalRuntimeEngine` 也放进这里？**
A：原型期实现强依赖浏览器（Dexie / fetch / OpenAI 兼容协议），放在 `apps/platform-web` 更合适；这里只保留协议。

---

## 8. 相关文件清单

- `src/index.ts`、`src/engine.ts`
- `package.json`、`tsconfig.json`

---

## 9. 变更记录 (Changelog)

| 时间 | 变更 |
|------|------|
| 2026-05-05 17:52:53 | 初始化架构师首次生成模块文档 |
| 2026-05-11 | I 阶段确认：`RuntimeEngine` 接口在 H9 已扩展 `appendUserMessage / appendAssistantMessage`（append 例外，不递增 `state.turn`），I 阶段桥 API 通过 platform-host 转调；接口形态稳定，无破坏性变更 |

---

_文档生成时间：2026-05-05 17:52:53_
