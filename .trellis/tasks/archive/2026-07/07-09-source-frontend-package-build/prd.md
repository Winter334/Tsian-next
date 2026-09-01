# 源码型前端包上传与在线构建

## Goal

让平台“上传前端包”支持源码型游戏前端：前端包可以只携带 `src/**` 源码，声明 `framework: "vue"`，导入后由平台在线构建生成 `frontend/dist/**` 并绑定为 packaged frontend。用于验证并支持将较重的本地开发前端通过创意工坊/前端包分发，同时保留玩家在线编辑与重构建能力。

## Requirements

### R1. frontend.json 支持 framework

- `FrontendPackageManifest` 支持可选 `framework` 字段，类型沿用 `FrontendFramework`。
- 导入前端包时校验 `framework` 必须属于 `FRONTEND_FRAMEWORKS`。
- 导出前端包时，如果卡片 packaged frontend binding 带 `framework`，写回 `frontend.json`。

### R2. 支持源码型前端包

- 前端包可以只包含 `src/**` 源码文件，不必预先包含 `dist/index.html`。
- `frontend.json.entry` 仍表示运行入口，通常为 `dist/index.html`；如果 entry 文件不在 zip 中，但存在 `src/**`，导入后允许由平台在线构建生成。
- 如果既没有 entry 文件也没有可构建源码，应继续失败，避免导入不可运行前端。

### R3. 导入后自动在线构建

- 上传源码型前端包后，平台保存为 `frontend/src/**`。
- 卡片 frontend binding 写入：
  - `kind: "packaged"`
  - `entry: "frontend/dist/index.html"`（或 `frontend/${manifest.entry}`）
  - `framework: manifest.framework`（若提供）
  - `bridgeVersion: "tsian.play-bridge.v1"`
- 若前端包包含 `src/**`，导入完成后调用平台构建器执行一次 `buildFrontend(cardId)`。
- 构建失败时应抛出明确错误或保留可诊断信息，不静默宣称导入成功但没有 dist。

### R4. 保持已构建前端包兼容

- 现有只包含 `dist/**` 的前端包仍可上传并直接绑定。
- 现有导出/导入 dist 前端包行为不被破坏。
- 不修改 play bridge 协议版本。

### R5. 后续验证目标

- 能将一个最小 Vue 源码前端包上传到卡片，平台在线构建生成 dist，并在 `/play` 中完成 bridge handshake。
- 后续再用 `apps/play-frontend-dev/src` 作为较重源码包测试真实复杂前端。

## Acceptance Criteria

- [x] `FrontendPackageManifest` 支持 `framework?: FrontendFramework`。
- [x] 前端包导入校验接受源码型包：entry 缺失但存在 `src/**` 时允许导入并构建。
- [x] 源码型包导入后自动执行 `buildFrontend(cardId)`，生成 `frontend/dist/index.html`。
- [x] 导入后的卡片 frontend binding 保留 `framework: "vue"`。
- [x] dist-only 前端包仍可上传使用。
- [x] 前端包导出会携带已有 packaged frontend 的 `framework` 字段。
- [x] `npm run build:contracts` 通过。
- [x] `npm run build:web` 通过。

## Completion Notes

- `frontend.json` 新增可选 `framework`，导入时校验在 `FRONTEND_FRAMEWORKS` 内。
- 导入前端包时，若 entry 不在 zip 但存在 `src/**`，允许导入并由平台构建生成 dist。
- 含 `.vue` 源码的包必须声明 `framework: "vue"`，否则给出明确错误。
- platform-host 在导入源码包后同步调用 `buildFrontend(cardId)`，构建成功后刷新卡片/active card 事件；构建失败时抛出“源码包已导入，但在线构建失败”的明确错误。

## Out of Scope

- 真实上传创意工坊市场流程。
- 把 `apps/play-frontend-dev` 设为默认内置前端。
- 完整支持 Vite 所有能力；本任务只打通平台已有 esbuild-wasm/Vue SFC 构建链路所需的前端包导入入口。
