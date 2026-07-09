# 前端 SDK 发布准备与在线构建验证

## Goal

完成 Tsian 游戏前端 SDK 的 npm 发布准备，并让平台在线构建器使用经过验证的 SDK 版本映射，为后续把重型 Vue 游戏前端上传创意工坊、玩家下载并在线编辑/构建做好基础。

## Requirements

### R1. SDK 包发布元数据

- 准备 `@tsian/contracts` 与 `@tsian/play-bridge` 的 npm 发布 metadata。
- 两个包使用同一初始版本 `0.1.0`。
- 两个包不再标记为 `private`。
- 两个包只发布必要产物（`dist`、必要 README），避免源码/缓存/工作区杂物进入 npm 包。
- `@tsian/play-bridge` 需要声明对 `@tsian/contracts@0.1.0` 的依赖，保证本地 TypeScript SDK 体验完整。

### R2. 平台在线构建版本固定

- 平台在线构建器对游戏前端源码中的 `@tsian/play-bridge` bare import 生成固定版本 import map。
- 固定到当前验证版本 `https://esm.sh/@tsian/play-bridge@0.1.0`，避免使用 floating latest 导致旧构建产物不可复现。
- 保持作者源码写法简单：仍使用 `import { createTsian } from "@tsian/play-bridge"`。

### R3. 发布前本地验证

- `npm run build --workspace @tsian/contracts` 通过。
- `npm run build --workspace @tsian/play-bridge` 通过。
- `npm pack --workspace @tsian/contracts --dry-run` 输出内容合理。
- `npm pack --workspace @tsian/play-bridge --dry-run` 输出内容合理。
- 不执行真实 `npm publish`，发布命令由用户最终确认后手动执行或单独授权执行。

### R4. 在线构建验证准备

- 发布准备完成后，下一步验证平台在线构建 Vue 前端：`vue` + `@tsian/play-bridge` import 能构建并在 iframe 中完成 bridge handshake。
- 若发现 Vue 在线构建能力缺口，优先修平台 `frontend-build`，不扩大 SDK 发布范围。

## Acceptance Criteria

- [x] `@tsian/contracts` package metadata 可公开发布，版本为 `0.1.0`，包内容受 `files` 限制。
- [x] `@tsian/play-bridge` package metadata 可公开发布，版本为 `0.1.0`，声明 `@tsian/contracts@0.1.0` 依赖。
- [x] `@tsian/play-bridge` 暴露 ESM `exports` 与类型入口。
- [x] 平台在线构建器将 `@tsian/play-bridge` 映射到 `https://esm.sh/@tsian/play-bridge@0.1.0`。
- [x] contracts / play-bridge build 均通过。
- [x] 两个包的 `npm pack --dry-run` 内容符合预期。
- [x] 真实 npm publish 未被自动执行，需用户明确确认。

## Out of Scope

- 真实执行 `npm publish`。
- 立即把重型本地游戏前端迁入默认卡。
- 完整改造 Vue 在线构建器；本任务只为后续验证做必要 pin 与 SDK 发布准备，发现问题再单独修。
