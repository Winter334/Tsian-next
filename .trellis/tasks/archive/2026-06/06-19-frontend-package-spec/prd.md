# 前端包打包规范与平台内替换

## Goal

让游戏卡的前端（Packaged 模式）成为一个有规范、可独立打包上传/导出的分发单位，而不是只能随整张卡包导入的散文件。平台内应能对任意已存在游戏卡独立替换其前端包，无需重导整张卡。

同时修复阻塞 packaged 前端加载与音视频 serve 的两个前置缺陷。

## Parent

- `.trellis/tasks/06-15-platform-ui-development-phase`

## Confirmed Facts（调研已确认）

- `gameCardFrontendFiles` 表的 `data` 字段是 `Blob`，原生支持二进制（图片/字体/wasm/音视频均可存储）。
- packaged 前端通过 Service Worker 拦截 `/__tsian_game_card_frontends/{cardId}/{path}`，从 IndexedDB 读 Blob 并以存储时的 `mediaType` 作为 `Content-Type` 返回。serve 机制对任意 mediaType 成立。
- 现有卡包格式 `.tsian-card.zip`：根目录 `game-card.json` 清单（schema `tsian.game-card.package.v1`），内部路径前缀 `workspace/`、`frontend/`、`cover/`，含 `manifest` + 三类文件区。前端文件随整卡导入落地到 `gameCardFrontendFiles`。
- `manifest.frontend` 为 `GameCardFrontendBinding`，packaged 模式带 `entry`（须在 `frontend/` 下）与 `bridgeVersion: "tsian.play-bridge.v1"`。
- platform-host 现有 `updatePlatformGameCardFrontend` 只能绑定已有 packaged 文件的 entry，**不能写入/替换 packaged 文件本身**。这是"本地前端包配置不友好"的根因。
- `putLocalGameCard` 的 `frontendFiles` 入参接受 `{ path, data: Blob|ArrayBuffer|Uint8Array|string, mediaType? }`，底层已具备写入能力，只是 host 层未暴露增量替换接口。

### 前置缺陷（必须在本任务修复）

1. **Service Worker 数据库名不匹配（阻塞所有 packaged 前端加载）**
   - `apps/platform-web/src/storage/db.ts` 实际 DB 名为 `tsian-agent-runtime-v6`。
   - `apps/platform-web/public/tsian-game-card-frontend-sw.js` 硬编码 `tsian-agent-runtime-v5`。
   - 后果：SW 打开空旧库，packaged 前端 serve 全部 404，任何前端包都无法加载。
2. **mediaType 推断缺失音视频映射（音视频 serve 出来无法播放）**
   - `apps/platform-web/src/storage/game-card-packages.ts` 的 `inferMediaType` 只覆盖 html/css/js/json/md/svg/png/jpg/webp/gif/woff/woff2/wasm。
   - `.mp3/.ogg/.wav/.m4a/.flac/.mp4/.webm/.mov/.avif` 等全部落到 `application/octet-stream`，浏览器 `<audio>`/`<video>` 会拒绝解码或当下载处理。

## Requirements

### 前端包格式规范

- 定义独立的前端包格式 `.tsian-frontend.zip`，作为卡包 `.tsian-card.zip` 的专注前端的子集，二者并存：
  - 卡包仍是"整张卡"的分发单位（manifest + workspace + frontend + cover），导入流程不变。
  - 前端包是"仅前端"的替换/分发单位，只作用于已存在游戏卡的前端部分。
- 前端包结构：
  - 根目录清单文件 `frontend.json`，schema `tsian.frontend-package.v1`，含 `entry`、`bridgeVersion: "tsian.play-bridge.v1"`、`files: [{path, mediaType, size}]`。
  - 构建产物文件按清单 `files` 中的 `path` 排列（path 为相对根的路径，不含 `frontend/` 前缀，由平台侧写入时统一加前缀，与现有 `gameCardFrontendFiles` 路径约定对齐）。
  - **强制要求清单文件**：上传时若缺失 `frontend.json` 或 schema 不符，直接报错，不自动推断。
- 清单 `entry` 必须存在于 `files` 列表中，否则报错。

### 平台内上传/导出/清除

- platform-host 新增 `importPlatformGameCardFrontendPackage(cardId, input)`：
  - 解压 `.tsian-frontend.zip`，校验 `frontend.json` 清单与文件完整性。
  - **整体替换**：先清空该卡现有 `gameCardFrontendFiles`，再写入新包文件（path 统一加 `frontend/` 前缀），并更新 `manifest.frontend` 为 `{ kind: "packaged", entry, bridgeVersion }`。
  - 内置卡（`source === "builtin"`）禁止直接替换前端，引导另存为本地副本。
- platform-host 新增 `exportPlatformGameCardFrontendPackage(cardId)`：
  - 将该卡现有 packaged 前端文件打包成 `.tsian-frontend.zip`（生成 `frontend.json` + 文件），便于分发/备份。
  - 该卡无 packaged 前端时返回明确错误或空标识，由调用方处理。
- platform-host 扩展前端清除能力：清除 packaged 绑定时连带删除 `gameCardFrontendFiles` 中该卡的全部文件（现有 `clearFrontendBinding` 只清 manifest 绑定，不删文件）。

### 前端标签页 UI 重构

- 应用属性窗口「前端」标签页以"上传前端包 / 导出前端包 / 清除"为主操作：
  - 「上传前端包」按钮 → 文件选择器选 `.tsian-frontend.zip` → 校验 + 整体替换 + 自动设 entry。
  - 「导出前端包」按钮 → 下载当前卡前端为 `.tsian-frontend.zip`。
  - 「清除」按钮 → 移除整个前端包（文件 + manifest 绑定）。
- packaged 文件列表降级为只读预览（展示当前包内文件 path/mediaType/size），不再承担编辑职责。
- Remote URL 模式保持不变（它本就简单）。
- 保留"打开游玩窗口"入口与前端状态标签。

### 前置缺陷修复

- 修复 SW 数据库名 `tsian-agent-runtime-v5` → `tsian-agent-runtime-v6`，并确保 `public/tsian-game-card-frontend-sw.js` 与 `db.ts` 的 DB 名保持单一来源或至少一致（在 design.md 中决定是否抽取常量）。
- 扩展 `inferMediaType` 覆盖常见音视频与 avif 图片格式：`.mp3→audio/mpeg`、`.ogg→audio/ogg`、`.wav→audio/wav`、`.m4a→audio/mp4`、`.flac→audio/flac`、`.mp4→video/mp4`、`.webm→video/webm`、`.mov→video/quicktime`、`.avif→image/avif`。

## Acceptance Criteria

- [ ] 准备一个含 `frontend.json` 清单与 `index.html` + 至少一张图片的 `.tsian-frontend.zip`，在应用属性「前端」标签上传，成功写入并自动设为 packaged 入口。
- [ ] 上传含音视频文件（如 `.mp3`/`.mp4`）的前端包，文件以正确 `Content-Type`（`audio/mpeg`/`video/mp4`）存储；在游玩窗口通过 `<audio>`/`<video>` 能正常播放。
- [ ] 上传缺失 `frontend.json` 或 `entry` 不在 `files` 中的前端包，平台报清晰错误且不破坏该卡现有前端。
- [ ] 对已有前端的卡上传新前端包，旧前端文件被整体清除替换，不残留旧文件。
- [ ] 导出前端包得到 `.tsian-frontend.zip`，重新上传到另一张卡能还原相同前端行为。
- [ ] 清除前端后，`gameCardFrontendFiles` 中该卡文件全部删除，`manifest.frontend` 置空。
- [ ] 内置卡上传/导出/清除前端被拒绝并提示先另存为本地副本。
- [ ] packaged 前端在游玩窗口能正常加载（SW DB 名修复后端到端可用）。
- [ ] 卡包整卡导入（`.tsian-card.zip`）流程不受影响，仍能带入前端文件。
- [ ] Remote URL 前端模式不受影响。
- [ ] `npm run build:web` 通过。

## Out Of Scope

- 前端包内文件的逐个增删编辑（本轮只做整体替换；文件列表只读预览）。
- 拖拽整目录上传（可作后续优化）。
- 前端包的版本化/多版本共存（当前一轮只保留当前生效的前端包）。
- 前端包清单的字段扩展（如作者、构建信息等元数据），本轮只保留最小必要字段。
- 工作区文件（workspaceFiles）的打包/替换（本轮专注前端）。
